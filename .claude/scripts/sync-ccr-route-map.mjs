import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeScriptsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeScriptsRoot, "..");
const runtimeRoot = resolveRuntimeRoot(repoRoot);

const ccrHome = path.join(os.homedir(), ".claude-code-router");
const targetRouteMapPath = path.join(ccrHome, "multi-route-map.json");
const sourceRouteMapPath = resolveRuntimeAsset("ccr/route-map.example.json");

function resolveRuntimeRoot(baseRepoRoot) {
  const envPath = process.env.MULTI_HOME?.trim() || process.env.PI_MULTI_HOME?.trim();
  if (envPath) return path.isAbsolute(envPath) ? envPath : path.resolve(baseRepoRoot, envPath);

  const claudeRoot = path.join(baseRepoRoot, ".claude");
  if (
    existsSync(path.join(claudeRoot, "crew")) ||
    existsSync(path.join(claudeRoot, ".active-crew.json")) ||
    existsSync(path.join(claudeRoot, "ccr"))
  ) return claudeRoot;

  return path.join(baseRepoRoot, ".claude");
}

function resolveRuntimeAsset(relativePath) {
  const preferred = path.join(runtimeRoot, relativePath);
  if (existsSync(preferred)) return preferred;
  return path.join(runtimeScriptsRoot, relativePath);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function restartCcr() {
  const restart = spawnSync("ccr", ["restart"], { encoding: "utf-8" });
  if (restart.status === 0) {
    console.log("CCR restarted.");
    return;
  }

  const start = spawnSync("ccr", ["start"], { encoding: "utf-8" });
  if (start.status === 0) {
    console.log("CCR started.");
    return;
  }

  const details = (start.stderr || start.stdout || restart.stderr || restart.stdout || "unknown error").trim();
  console.log("WARNING: route map synced, but CCR restart/start failed.");
  console.log(`- details: ${details}`);
  console.log("- action: run `ccr restart` manually");
}

function main() {
  if (!existsSync(sourceRouteMapPath)) {
    fail(`Source route map not found: ${sourceRouteMapPath}`);
    return;
  }

  mkdirSync(ccrHome, { recursive: true });

  let backupPath = "";
  if (existsSync(targetRouteMapPath)) {
    backupPath = `${targetRouteMapPath}.bak.${timestamp()}`;
    copyFileSync(targetRouteMapPath, backupPath);
  }

  copyFileSync(sourceRouteMapPath, targetRouteMapPath);

  console.log("Synced route map to CCR home");
  console.log(`- source: ${sourceRouteMapPath}`);
  console.log(`- target: ${targetRouteMapPath}`);
  if (backupPath) console.log(`- backup: ${backupPath}`);

  restartCcr();
}

main();
