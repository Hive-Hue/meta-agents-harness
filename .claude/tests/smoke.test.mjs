import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateRouteMapObject } from "../scripts/lib/route-map.mjs";
import { updateMentalModel } from "../scripts/lib/mental-model.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeRoot, "..");
const ccmhPath = path.join(runtimeRoot, "bin", "ccmh");
const doctorPath = path.join(runtimeRoot, "scripts", "doctor.mjs");
const runCrewPath = path.join(runtimeRoot, "scripts", "run-crew-claude.mjs");
const validateRouteMapPath = path.join(runtimeRoot, "scripts", "validate-ccr-route-map.mjs");
const mentalModelMcpPath = path.join(runtimeRoot, "scripts", "update-mental-model-mcp.mjs");

function createFixture(t) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "ccmh-smoke-"));
  const fixtureRuntimeRoot = path.join(tempRoot, ".claude");
  cpSync(path.join(runtimeRoot, "bin"), path.join(fixtureRuntimeRoot, "bin"), { recursive: true });
  cpSync(path.join(runtimeRoot, "scripts"), path.join(fixtureRuntimeRoot, "scripts"), { recursive: true });
  cpSync(path.join(runtimeRoot, "tests"), path.join(fixtureRuntimeRoot, "tests"), { recursive: true });
  cpSync(path.join(runtimeRoot, "crew"), path.join(fixtureRuntimeRoot, "crew"), { recursive: true });
  cpSync(path.join(runtimeRoot, "ccr"), path.join(fixtureRuntimeRoot, "ccr"), { recursive: true });
  cpSync(path.join(runtimeRoot, "package.json"), path.join(fixtureRuntimeRoot, "package.json"));
  if (existsSync(path.join(runtimeRoot, "package-lock.json"))) {
    cpSync(path.join(runtimeRoot, "package-lock.json"), path.join(fixtureRuntimeRoot, "package-lock.json"));
  }
  cpSync(path.join(runtimeRoot, "settings.json"), path.join(fixtureRuntimeRoot, "settings.json"));
  const yamlModulePath = path.join(runtimeRoot, "node_modules", "yaml");
  if (existsSync(yamlModulePath) && statSync(yamlModulePath).isDirectory()) {
    cpSync(yamlModulePath, path.join(fixtureRuntimeRoot, "node_modules", "yaml"), { recursive: true });
  }
  if (existsSync(path.join(repoRoot, ".mcp.json"))) {
    cpSync(path.join(repoRoot, ".mcp.json"), path.join(tempRoot, ".mcp.json"));
  }

  t.after(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  return {
    tempRoot,
    fixtureRuntimeRoot,
    routeMapPath: path.join(fixtureRuntimeRoot, "ccr", "route-map.example.json"),
  };
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runNode(filePath, args, env = {}, cwd = repoRoot) {
  const captureRoot = mkdtempSync(path.join(os.tmpdir(), "ccmh-run-"));
  const stdoutPath = path.join(captureRoot, "stdout.txt");
  const stderrPath = path.join(captureRoot, "stderr.txt");
  const statusPath = path.join(captureRoot, "status.txt");
  const command = [
    shellEscape(process.execPath),
    shellEscape(filePath),
    ...args.map((arg) => shellEscape(arg)),
  ].join(" ");

  const proc = spawnSync("bash", ["-lc", `${command} >${shellEscape(stdoutPath)} 2>${shellEscape(stderrPath)}; printf '%s' $? >${shellEscape(statusPath)}`], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });

  const result = {
    status: existsSync(statusPath) ? Number(readFileSync(statusPath, "utf-8")) : (proc.status ?? 1),
    stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf-8") : "",
    stderr: existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : "",
  };

  rmSync(captureRoot, { recursive: true, force: true });
  return result;
}

function runCcmh(args, env = {}) {
  return runNode(ccmhPath, args, env);
}

function writeScalarPolicyRouteMap(routeMapPath, policyName = "balanced") {
  const routeMap = JSON.parse(readFileSync(routeMapPath, "utf-8"));
  routeMap.default_policy = policyName;
  routeMap.policies[policyName] = "lmstudio/foo";
  writeFileSync(routeMapPath, `${JSON.stringify(routeMap, null, 2)}\n`, "utf-8");
}

function encodeMcpMessage(message) {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, "utf-8")}\r\n\r\n${payload}`;
}

function parseMcpMessages(raw) {
  const messages = [];
  let offset = 0;
  while (offset < raw.length) {
    const headerEnd = raw.indexOf("\r\n\r\n", offset);
    if (headerEnd === -1) break;
    const headerText = raw.slice(offset, headerEnd);
    const contentLengthHeader = headerText
      .split("\r\n")
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().startsWith("content-length:"));
    assert.ok(contentLengthHeader, "missing Content-Length header in MCP response");
    const contentLength = Number(contentLengthHeader.split(":")[1]?.trim() || NaN);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    messages.push(JSON.parse(raw.slice(bodyStart, bodyEnd)));
    offset = bodyEnd;
  }
  return messages;
}

function runMcpServer(serverPath, messages, env = {}, cwd = repoRoot) {
  const proc = spawnSync(process.execPath, [serverPath], {
    cwd,
    env: { ...process.env, ...env },
    input: messages.map((message) => encodeMcpMessage(message)).join(""),
    encoding: "utf-8",
  });

  return {
    status: proc.status ?? 1,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    messages: parseMcpMessages(proc.stdout || ""),
  };
}

test("validateRouteMapObject rejects scalar policy definitions referenced by default_policy", () => {
  const validation = validateRouteMapObject({
    default_policy: "balanced",
    policies: {
      balanced: "lmstudio/foo",
    },
  });

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join("; "), /policies\.balanced must be an object/);
  assert.match(validation.issues.join("; "), /default_policy "balanced" must reference an object policy definition/);
});

test("ccmh list:crews reports available crews without touching runtime state", (t) => {
  const fixture = createFixture(t);
  const result = runCcmh(["list:crews"], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dev/);
  assert.match(result.stdout, /marketing/);
  assert.match(result.stdout, /No active crew selected\./);
});

test("ccmh use writes active crew metadata into the selected runtime home", (t) => {
  const fixture = createFixture(t);
  const result = runCcmh(["use", "marketing"], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Activated crew: marketing/);

  const activeMetaPath = path.join(fixture.fixtureRuntimeRoot, ".active-crew.json");
  assert.equal(existsSync(activeMetaPath), true);
  const activeMeta = JSON.parse(readFileSync(activeMetaPath, "utf-8"));
  assert.equal(activeMeta.crew, "marketing");
});

test("updateMentalModel writes to the active crew expertise path for the selected agent", (t) => {
  const fixture = createFixture(t);
  const useResult = runCcmh(["use", "marketing"], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });
  assert.equal(useResult.status, 0, useResult.stderr);

  const result = updateMentalModel(
    {
      agent: "planning-lead",
      category: "lessons",
      note: "Use the planning lead to preserve campaign scoping lessons.",
    },
    {
      repoRoot: fixture.tempRoot,
      runtimeRoot: fixture.fixtureRuntimeRoot,
    },
  );

  const expertisePath = path.join(fixture.fixtureRuntimeRoot, "crew", "marketing", "expertise", "planning-lead-mental-model.yaml");
  const expertiseText = readFileSync(expertisePath, "utf-8");

  assert.equal(path.resolve(result.path), expertisePath);
  assert.match(expertiseText, /Use the planning lead to preserve campaign scoping lessons\./);
  assert.match(expertiseText, /lessons:/);
});

test("updateMentalModel rejects ambiguous agent ids when no active crew is selected", (t) => {
  const fixture = createFixture(t);

  assert.throws(
    () =>
      updateMentalModel(
        {
          agent: "planning-lead",
          note: "Ambiguous agent should fail without active crew context.",
        },
        {
          repoRoot: fixture.tempRoot,
          runtimeRoot: fixture.fixtureRuntimeRoot,
        },
      ),
    /ambiguous across multiple crews/,
  );
});

test("updateMentalModel rejects malformed existing expertise YAML", (t) => {
  const fixture = createFixture(t);
  const expertisePath = path.join(fixture.fixtureRuntimeRoot, "crew", "dev", "expertise", "orchestrator-mental-model.yaml");
  writeFileSync(expertisePath, "agent: [broken\n", "utf-8");

  assert.throws(
    () =>
      updateMentalModel(
        {
          expertise_path: path.relative(fixture.tempRoot, expertisePath),
          note: "This should not overwrite malformed YAML.",
        },
        {
          repoRoot: fixture.tempRoot,
          runtimeRoot: fixture.fixtureRuntimeRoot,
        },
      ),
    /failed to parse expertise YAML/,
  );
});

test("mental-model MCP server lists update_mental_model", (t) => {
  const fixture = createFixture(t);
  const result = runMcpServer(
    path.join(fixture.fixtureRuntimeRoot, "scripts", "update-mental-model-mcp.mjs"),
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke-test", version: "0.1.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
    ],
    {
      MULTI_HOME: fixture.fixtureRuntimeRoot,
      PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
    },
    fixture.tempRoot,
  );

  assert.equal(result.status, 0, result.stderr);
  const toolsList = result.messages.find((message) => message.id === 2);
  assert.ok(toolsList);
  assert.equal(toolsList.result.tools[0].name, "update_mental_model");
});

test("mental-model MCP server updates expertise files through tools/call", (t) => {
  const fixture = createFixture(t);
  const useResult = runCcmh(["use", "dev"], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });
  assert.equal(useResult.status, 0, useResult.stderr);

  const result = runMcpServer(
    path.join(fixture.fixtureRuntimeRoot, "scripts", "update-mental-model-mcp.mjs"),
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke-test", version: "0.1.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "update_mental_model",
          arguments: {
            agent: "ceo-orchestrator",
            category: "decisions",
            note: "Route implementation work through leads before escalating.",
          },
        },
      },
    ],
    {
      MULTI_HOME: fixture.fixtureRuntimeRoot,
      PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
    },
    fixture.tempRoot,
  );

  assert.equal(result.status, 0, result.stderr);
  const toolCall = result.messages.find((message) => message.id === 2);
  assert.ok(toolCall);
  assert.equal(toolCall.result.isError, undefined);
  assert.equal(toolCall.result.structuredContent.status, "ok");

  const expertisePath = path.join(fixture.fixtureRuntimeRoot, "crew", "dev", "expertise", "orchestrator-mental-model.yaml");
  const expertiseText = readFileSync(expertisePath, "utf-8");
  assert.match(expertiseText, /Route implementation work through leads before escalating\./);
  assert.match(expertiseText, /decisions:/);
});

test("ccmh doctor reports route-map defaults in ci mode", (t) => {
  const fixture = createFixture(t);
  const result = runNode(doctorPath, ["--ci", "--json"], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
    MULTI_CCR_ROUTE_MAP_PATH: fixture.routeMapPath,
    PI_MULTI_CCR_ROUTE_MAP_PATH: fixture.routeMapPath,
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);

  const sourceRouteMap = payload.results.find((entry) => entry.label === "route_map_source");
  assert.equal(sourceRouteMap.status, "ok");
  assert.match(sourceRouteMap.detail, /default_policy=balanced/);
});

test("ccmh ccr:validate-route-map validates the source route map without requiring CCR home", (t) => {
  const fixture = createFixture(t);
  const result = runNode(validateRouteMapPath, ["--json", "--no-check-home", "--path", fixture.routeMapPath], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].label, "source");
  assert.equal(payload.results[0].status, "ok");
});

test("ccmh ccr:validate-route-map returns structured source error for malformed route map JSON", (t) => {
  const fixture = createFixture(t);
  writeFileSync(fixture.routeMapPath, "{ invalid json\n", "utf-8");

  const result = runNode(validateRouteMapPath, ["--json", "--no-check-home", "--path", fixture.routeMapPath], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.results[0].label, "source");
  assert.equal(payload.results[0].status, "error");
});

test("ccmh ccr:validate-route-map rejects scalar policy definitions", (t) => {
  const fixture = createFixture(t);
  writeScalarPolicyRouteMap(fixture.routeMapPath);

  const result = runNode(validateRouteMapPath, ["--json", "--no-check-home", "--path", fixture.routeMapPath], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.results[0].label, "source");
  assert.equal(payload.results[0].status, "error");
  assert.match(payload.results[0].detail, /policies\.balanced must be an object/);
  assert.match(payload.results[0].detail, /default_policy "balanced" must reference an object policy definition/);
});

test("ccmh ccr:validate-route-map returns structured ccr_home error for malformed synced route map", (t) => {
  const fixture = createFixture(t);
  const fakeHome = path.join(fixture.tempRoot, "home");
  const fakeCcrHome = path.join(fakeHome, ".claude-code-router");
  mkdirSync(fakeCcrHome, { recursive: true });
  writeFileSync(path.join(fakeCcrHome, "multi-route-map.json"), "{ invalid json\n", "utf-8");

  const result = runNode(validateRouteMapPath, ["--json", "--path", fixture.routeMapPath], {
    HOME: fakeHome,
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);

  const source = payload.results.find((entry) => entry.label === "source");
  const ccrHome = payload.results.find((entry) => entry.label === "ccr_home");
  assert.equal(source.status, "ok");
  assert.equal(ccrHome.status, "error");
});

test("ccmh ccr:validate-route-map respects MULTI_CCR_ROUTE_MAP_PATH during sync checks", (t) => {
  const fixture = createFixture(t);
  const fakeHome = path.join(fixture.tempRoot, "home");
  const customMapDir = path.join(fixture.tempRoot, "custom-router");
  const customMapPath = path.join(customMapDir, "multi-route-map.json");
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(customMapDir, { recursive: true });
  cpSync(fixture.routeMapPath, customMapPath);

  const result = runNode(validateRouteMapPath, ["--json", "--strict-sync", "--path", fixture.routeMapPath], {
    HOME: fakeHome,
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
    MULTI_CCR_ROUTE_MAP_PATH: customMapPath,
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);

  const ccrHome = payload.results.find((entry) => entry.label === "ccr_home");
  assert.equal(ccrHome.status, "ok");
  assert.match(ccrHome.detail, /custom-router/);
});

test("ccmh doctor rejects scalar policy definitions in ci mode", (t) => {
  const fixture = createFixture(t);
  writeScalarPolicyRouteMap(fixture.routeMapPath);

  const result = runNode(doctorPath, ["--ci", "--json"], {
    MULTI_HOME: fixture.fixtureRuntimeRoot,
    PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
  });

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);

  const sourceRouteMap = payload.results.find((entry) => entry.label === "route_map_source");
  assert.equal(sourceRouteMap.status, "error");
  assert.match(sourceRouteMap.detail, /policies\.balanced must be an object/);
  assert.match(sourceRouteMap.detail, /default_policy "balanced" must reference an object policy definition/);
});

test("check-runtime rejects scalar policy definitions in the runtime route map", (t) => {
  const fixture = createFixture(t);
  writeScalarPolicyRouteMap(fixture.routeMapPath);

  const result = runNode(path.join(fixture.fixtureRuntimeRoot, "scripts", "check-runtime.mjs"), []);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /route-map\.example\.json -> .*policies\.balanced must be an object/);
  assert.match(result.stderr, /default_policy "balanced" must reference an object policy definition/);
});

test("run-crew dry-run prefers route-map default policy over env policy", (t) => {
  const fixture = createFixture(t);
  const result = runNode(
    runCrewPath,
    ["--crew", "dev", "--no-ccr-activate", "--claude-command", "/bin/true", "--dry-run", "--show-launch-info"],
    {
      MULTI_HOME: fixture.fixtureRuntimeRoot,
      PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
      MULTI_CCR_ROUTE_MAP_PATH: fixture.routeMapPath,
      PI_MULTI_CCR_ROUTE_MAP_PATH: fixture.routeMapPath,
      MULTI_CCR_POLICY: "local",
      PI_MULTI_CCR_POLICY: "local",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /policy=balanced/);
  assert.doesNotMatch(result.stdout, /policy=local/);
});

test("run-crew dry-run respects explicit policy overrides", (t) => {
  const fixture = createFixture(t);
  const result = runNode(
    runCrewPath,
    ["--crew", "dev", "--policy", "quality", "--no-ccr-activate", "--claude-command", "/bin/true", "--dry-run", "--show-launch-info"],
    {
      MULTI_HOME: fixture.fixtureRuntimeRoot,
      PI_MULTI_HOME: fixture.fixtureRuntimeRoot,
      MULTI_CCR_ROUTE_MAP_PATH: fixture.routeMapPath,
      PI_MULTI_CCR_ROUTE_MAP_PATH: fixture.routeMapPath,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /policy=quality/);
});
