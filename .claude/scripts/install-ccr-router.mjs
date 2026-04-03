import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeScriptsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeScriptsRoot, "..");
const runtimeRoot = resolveRuntimeRoot(repoRoot);

const ccrHome = path.join(os.homedir(), ".claude-code-router");
const ccrConfigPath = path.join(ccrHome, "config.json");
const ccrRouterDir = path.join(ccrHome, "custom-router");
const ccrRouterPath = path.join(ccrRouterDir, "multi-router.cjs");
const ccrRouteMapPath = path.join(ccrHome, "multi-route-map.json");

const sourceRouterPath = resolveRuntimeAsset("ccr/custom-router.cjs");
const sourceRouteMapExample = resolveRuntimeAsset("ccr/route-map.example.json");

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function main() {
  if (!existsSync(ccrConfigPath)) {
    fail(`CCR config not found at ${ccrConfigPath}. Start CCR once first.`);
    return;
  }
  if (!existsSync(sourceRouterPath)) {
    fail(`Source router script missing: ${sourceRouterPath}`);
    return;
  }
  if (!existsSync(sourceRouteMapExample)) {
    fail(`Route map example missing: ${sourceRouteMapExample}`);
    return;
  }

  const backupStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${ccrConfigPath}.bak.${backupStamp}`;
  const config = readJson(ccrConfigPath);

  mkdirSync(ccrRouterDir, { recursive: true });
  copyFileSync(sourceRouterPath, ccrRouterPath);

  if (!existsSync(ccrRouteMapPath)) {
    copyFileSync(sourceRouteMapExample, ccrRouteMapPath);
  }

  const next = {
    ...config,
    CUSTOM_ROUTER_PATH: ccrRouterPath,
    MULTI_CCR_ROUTE_MAP_PATH: ccrRouteMapPath,
    PI_MULTI_CCR_ROUTE_MAP_PATH: ccrRouteMapPath,
  };

  copyFileSync(ccrConfigPath, backupPath);
  writeFileSync(ccrConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");

  console.log("Installed CCR custom router");
  console.log(`- repo: ${repoRoot}`);
  console.log(`- custom router: ${ccrRouterPath}`);
  console.log(`- route map: ${ccrRouteMapPath}`);
  console.log(`- backup: ${backupPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("1) Edit route map if needed");
  console.log("2) Restart CCR: ccr restart");
  console.log("3) Activate shell env: eval \"$(ccr activate)\"");
}

main();
