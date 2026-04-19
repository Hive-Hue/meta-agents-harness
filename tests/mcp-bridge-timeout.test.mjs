import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

test("mcp bridge surfaces MCP timeouts as tool errors without crashing", () => {
  const script = `
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = ${JSON.stringify(repoRoot)};
const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-mcp-bridge-"));
const piDir = path.join(tempDir, ".pi");
const tempExtDir = path.join(tempDir, "extensions");
mkdirSync(tempExtDir, { recursive: true });
mkdirSync(piDir, { recursive: true });

function transpileToTempMjs(sourcePath, targetName) {
  const source = readFileSync(sourcePath, "utf-8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  }).outputText;
  const targetPath = path.join(tempExtDir, targetName);
  writeFileSync(targetPath, compiled, "utf-8");
  return targetPath;
}

const themeMapPath = transpileToTempMjs(path.join(repoRoot, "extensions", "themeMap.ts"), "themeMap.mjs");
const envLoaderPath = transpileToTempMjs(path.join(repoRoot, "extensions", "env-loader.ts"), "env-loader.mjs");

const bridgeSourcePath = path.join(repoRoot, "extensions", "mcp-bridge.ts");
const bridgeSource = readFileSync(bridgeSourcePath, "utf-8");
let compiled = ts.transpileModule(bridgeSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;

compiled = compiled
  .replace(
    /^import\\s+\\{\\s*Type\\s*\\}\\s+from\\s+["']@sinclair\\/typebox["'];\\s*$/m,
    'const Type = new Proxy({}, { get: () => (...args) => (args.length <= 1 ? args[0] : args) });'
  )
  .replace(
    /^import\\s+\\{\\s*Text\\s*\\}\\s+from\\s+["']@mariozechner\\/pi-tui["'];\\s*$/m,
    'class Text { constructor(text = "", x = 0, y = 0) { this.text = text; this.x = x; this.y = y; } toString() { return this.text; } }'
  )
  .replace("./themeMap.ts", pathToFileURL(themeMapPath).href)
  .replace("./env-loader.ts", pathToFileURL(envLoaderPath).href);

const tempBridgePath = path.join(tempExtDir, \`.mcp-bridge-timeout-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}.mjs\`);
writeFileSync(tempBridgePath, compiled, "utf-8");

let sessionStart = null;
const tools = new Map();
const notifications = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks).toString("utf-8");
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const method = payload.method;

    res.setHeader("mcp-session-id", "test-session");

    if (method === "tools/call") {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (method === "initialize") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "test", version: "1" },
        },
      }));
      return;
    }

    if (method === "tools/list") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { tools: [] },
      }));
      return;
    }

    res.statusCode = 202;
    res.end();
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind test server");

  writeFileSync(path.join(piDir, "mcp-servers.json"), JSON.stringify({
    servers: {
      stitch: {
        url: \`http://127.0.0.1:\${address.port}/mcp\`,
        type: "http",
        timeout_ms: 25,
        headers: {
          Accept: "application/json",
        },
      },
    },
  }, null, 2));

  const mod = await import(pathToFileURL(tempBridgePath).href);
  const bridge = mod.default;

  bridge({
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    registerCommand() {},
    on(event, handler) {
      if (event === "session_start") sessionStart = handler;
    },
  });

  if (!sessionStart) throw new Error("session_start handler was not registered");

  await sessionStart({}, {
    cwd: tempDir,
    hasUI: false,
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      setWidget() {},
      setFooter() {},
      setStatus() {},
    },
  });

  const mcpCall = tools.get("mcp_call");
  const mcpServers = tools.get("mcp_servers");
  if (!mcpCall || !mcpServers) throw new Error("bridge tools were not registered");

  const callResult = await mcpCall.execute("tool-1", {
    server: "stitch",
    tool: "tools/call",
    arguments_json: "{}",
  });
  const statusResult = await mcpServers.execute("tool-2", {});

  console.log(JSON.stringify({ call: callResult, status: statusResult, notifications }));
} finally {
  server.close();
  rmSync(tempBridgePath, { force: true });
  rmSync(tempDir, { recursive: true, force: true });
}
`;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.call.content[0].text, /Timed out waiting for MCP response from "stitch" for tools\/call/);
  const statusRows = JSON.parse(payload.status.content[0].text);
  assert.equal(statusRows[0].lastError, 'Timed out waiting for MCP response from "stitch" for tools/call');
  assert.ok(Array.isArray(payload.notifications));
});
