import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

test("quasi-root approval flow requests, approves, and grants session-scoped access", () => {
  const script = `
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = ${JSON.stringify(repoRoot)};
const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-quasi-root-"));
const extPath = path.join(repoRoot, "extensions", "multi-team.ts");
const source = readFileSync(extPath, "utf-8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText
  .replace(
    /^import\\s+\\{\\s*isToolCallEventType\\s*\\}\\s+from\\s+["']@mariozechner\\/pi-coding-agent["'];\\s*$/m,
    'const isToolCallEventType = (kind, event) => event?.toolName === kind;'
  )
  .replace(
    /^import\\s+\\{\\s*Type\\s*\\}\\s+from\\s+["']@sinclair\\/typebox["'];\\s*$/m,
    'const Type = new Proxy({}, { get: () => (...args) => (args.length <= 1 ? args[0] : args) });'
  )
  .replace(
    /^import\\s+\\{\\s*Text,\\s*truncateToWidth,\\s*visibleWidth\\s*\\}\\s+from\\s+["']@mariozechner\\/pi-tui["'];\\s*$/m,
    'class Text { constructor(text = "", x = 0, y = 0) { this.text = text; this.x = x; this.y = y; } setText(v) { this.text = v; } render() { return [this.text]; } invalidate() {} } const truncateToWidth = (s, n) => String(s).slice(0, n); const visibleWidth = (s) => String(s).length;'
  )
  .replace(
    /^import\\s+\\{\\s*applyExtensionDefaults\\s*\\}\\s+from\\s+["']\\.\\/themeMap\\.ts["'];\\s*$/m,
    'const applyExtensionDefaults = () => {};'
  )
  .replace(
    /^import\\s+\\{\\s*loadPiEnv\\s*\\}\\s+from\\s+["']\\.\\/env-loader\\.ts["'];\\s*$/m,
    'const loadPiEnv = () => {};'
  );

const tempModulePath = path.join(tempDir, "multi-team.mjs");
writeFileSync(tempModulePath, compiled, "utf-8");

mkdirSync(path.join(tempDir, ".pi", "crew", "dev"), { recursive: true });
writeFileSync(path.join(tempDir, ".pi", "crew", "dev", "multi-team.yaml"), \`
name: Test Crew
orchestrator:
  name: orchestrator
  prompt: orchestrate
teams:
  - name: Engineering
    lead:
      name: engineering-lead
      prompt: lead
    members:
      - name: worker-one
        prompt: do work
        domain_profile: quasi_root
domain_profiles:
  quasi_root:
    - path: .
      read: true
      upsert: true
      delete: true
      recursive: true
      approval_required: true
      approval_mode: explicit_tui
      grant_scope: single_path
\`.trim() + "\\n");

Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

process.env.MAH_RUNTIME = "pi";
process.env.MAH_ACTIVE_CREW = "dev";
process.env.MAH_MULTI_ROLE = "worker";
process.env.MAH_MULTI_AGENT = "worker-one";
process.env.MAH_MULTI_TEAM = "Engineering";
delete process.env.PI_MULTI_HEADLESS;

const notifications = [];
const handlers = new Map();
const commands = new Map();

const mod = await import(pathToFileURL(tempModulePath).href);
mod.default({
  registerTool() {},
  registerCommand(name, def) { commands.set(name, def); },
  on(name, handler) { handlers.set(name, handler); },
  setActiveTools() {},
});

const ui = {
  notify(message, level) { notifications.push({ message, level }); },
  setWidget() {},
  setFooter() {},
  setStatus() {},
};
const baseCtx = {
  cwd: tempDir,
  hasUI: true,
  ui,
  model: { id: "test-model", provider: "test" },
  getContextUsage() { return { percent: 0 }; },
};

await handlers.get("session_start")({}, baseCtx);

let aborted = false;
const firstGuard = await handlers.get("tool_call")(
  { toolName: "read", input: { path: "secret.txt" } },
  { ...baseCtx, abort() { aborted = true; } }
);

const approve = commands.get("approve-domain");
await approve.handler("latest", baseCtx);

let abortedSecond = false;
const secondGuard = await handlers.get("tool_call")(
  { toolName: "read", input: { path: "secret.txt" } },
  { ...baseCtx, abort() { abortedSecond = true; } }
);

console.log(JSON.stringify({
  firstGuard,
  secondGuard,
  aborted,
  abortedSecond,
  notifications,
}));

rmSync(tempDir, { recursive: true, force: true });
`;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.firstGuard.block, true);
  assert.equal(payload.aborted, true);
  assert.match(payload.firstGuard.reason, /approval required/i);
  assert.ok(payload.notifications.some((item) => String(item.message).includes("Approve in this TUI with: /approve-domain")));
  assert.equal(payload.secondGuard.block, false);
  assert.equal(payload.abortedSecond, false);
});

test("quasi-root approvals fail closed in headless mode", () => {
  const script = `
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = ${JSON.stringify(repoRoot)};
const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-quasi-root-headless-"));
const extPath = path.join(repoRoot, "extensions", "multi-team.ts");
const source = readFileSync(extPath, "utf-8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText
  .replace(
    /^import\\s+\\{\\s*isToolCallEventType\\s*\\}\\s+from\\s+["']@mariozechner\\/pi-coding-agent["'];\\s*$/m,
    'const isToolCallEventType = (kind, event) => event?.toolName === kind;'
  )
  .replace(
    /^import\\s+\\{\\s*Type\\s*\\}\\s+from\\s+["']@sinclair\\/typebox["'];\\s*$/m,
    'const Type = new Proxy({}, { get: () => (...args) => (args.length <= 1 ? args[0] : args) });'
  )
  .replace(
    /^import\\s+\\{\\s*Text,\\s*truncateToWidth,\\s*visibleWidth\\s*\\}\\s+from\\s+["']@mariozechner\\/pi-tui["'];\\s*$/m,
    'class Text { constructor(text = "", x = 0, y = 0) { this.text = text; this.x = x; this.y = y; } setText(v) { this.text = v; } render() { return [this.text]; } invalidate() {} } const truncateToWidth = (s, n) => String(s).slice(0, n); const visibleWidth = (s) => String(s).length;'
  )
  .replace(
    /^import\\s+\\{\\s*applyExtensionDefaults\\s*\\}\\s+from\\s+["']\\.\\/themeMap\\.ts["'];\\s*$/m,
    'const applyExtensionDefaults = () => {};'
  )
  .replace(
    /^import\\s+\\{\\s*loadPiEnv\\s*\\}\\s+from\\s+["']\\.\\/env-loader\\.ts["'];\\s*$/m,
    'const loadPiEnv = () => {};'
  );

const tempModulePath = path.join(tempDir, "multi-team.mjs");
writeFileSync(tempModulePath, compiled, "utf-8");
mkdirSync(path.join(tempDir, ".pi", "crew", "dev"), { recursive: true });
writeFileSync(path.join(tempDir, ".pi", "crew", "dev", "multi-team.yaml"), \`
name: Test Crew
orchestrator:
  name: orchestrator
  prompt: orchestrate
teams:
  - name: Engineering
    lead:
      name: engineering-lead
      prompt: lead
    members:
      - name: worker-one
        prompt: do work
        domain_profile: quasi_root
domain_profiles:
  quasi_root:
    - path: .
      read: true
      recursive: true
      approval_required: true
      approval_mode: explicit_tui
      grant_scope: single_path
\`.trim() + "\\n");

Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

process.env.MAH_RUNTIME = "pi";
process.env.MAH_ACTIVE_CREW = "dev";
process.env.MAH_MULTI_ROLE = "worker";
process.env.MAH_MULTI_AGENT = "worker-one";
process.env.MAH_MULTI_TEAM = "Engineering";
process.env.PI_MULTI_HEADLESS = "1";

const notifications = [];
const handlers = new Map();
const commands = new Map();
const mod = await import(pathToFileURL(tempModulePath).href);
mod.default({
  registerTool() {},
  registerCommand(name, def) { commands.set(name, def); },
  on(name, handler) { handlers.set(name, handler); },
  setActiveTools() {},
});

const ui = {
  notify(message, level) { notifications.push({ message, level }); },
  setWidget() {},
  setFooter() {},
  setStatus() {},
};
const baseCtx = {
  cwd: tempDir,
  hasUI: true,
  ui,
  model: { id: "test-model", provider: "test" },
  getContextUsage() { return { percent: 0 }; },
};

await handlers.get("session_start")({}, baseCtx);
let aborted = false;
const guard = await handlers.get("tool_call")(
  { toolName: "read", input: { path: "secret.txt" } },
  { ...baseCtx, abort() { aborted = true; } }
);

console.log(JSON.stringify({ guard, aborted, notifications }));
rmSync(tempDir, { recursive: true, force: true });
`;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.guard.block, true);
  assert.equal(payload.aborted, true);
  assert.match(payload.guard.reason, /headless|non-interactive/i);
  assert.equal(payload.notifications.some((item) => /approve-domain/.test(item.message)), false);
});
