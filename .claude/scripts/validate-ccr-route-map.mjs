import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAndValidateRouteMap, readJson } from "./lib/route-map.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeScriptsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeScriptsRoot, "..");
const runtimeRoot = resolveRuntimeRoot(repoRoot);

const sourceRouteMapPath = resolveRuntimeAsset("ccr/route-map.example.json");
const defaultCcrRouteMapPath = path.join(os.homedir(), ".claude-code-router", "multi-route-map.json");
const legacyCcrRouteMapPath = path.join(os.homedir(), ".claude-code-router", "pi-multi-route-map.json");

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

function resolveConfiguredCcrRouteMapPath() {
  const configuredPath = process.env.MULTI_CCR_ROUTE_MAP_PATH?.trim() || process.env.PI_MULTI_CCR_ROUTE_MAP_PATH?.trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(repoRoot, configuredPath);
  }
  if (existsSync(defaultCcrRouteMapPath)) return defaultCcrRouteMapPath;
  if (existsSync(legacyCcrRouteMapPath)) return legacyCcrRouteMapPath;
  return defaultCcrRouteMapPath;
}

function parseArgs(argv) {
  const args = {
    json: false,
    path: "",
    checkHome: true,
    strictSync: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--path") {
      args.path = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--no-check-home") {
      args.checkHome = false;
      continue;
    }
    if (token === "--strict-sync") {
      args.strictSync = true;
    }
  }

  return args;
}

function rel(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function resultEntry(label, status, detail) {
  return { label, status, detail };
}

function validateRouteMapFile(filePath) {
  try {
    return loadAndValidateRouteMap(filePath);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)],
      summary: null,
    };
  }
}

function routeMapDiffers(sourcePath, targetPath) {
  const source = JSON.stringify(readJson(sourcePath));
  const target = JSON.stringify(readJson(targetPath));
  return source !== target;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const routeMapPath = args.path ? path.resolve(repoRoot, args.path) : sourceRouteMapPath;
  const ccrHomeRouteMapPath = resolveConfiguredCcrRouteMapPath();
  const results = [];

  if (!existsSync(routeMapPath)) {
    results.push(resultEntry("source", "error", `missing ${rel(routeMapPath)}`));
  } else {
    const validation = validateRouteMapFile(routeMapPath);
    if (!validation.ok) {
      results.push(resultEntry("source", "error", `${rel(routeMapPath)} -> ${validation.issues.join("; ")}`));
    } else {
      const summary = validation.summary;
      results.push(
        resultEntry(
          "source",
          "ok",
          `${rel(routeMapPath)} (default_policy=${summary.defaultPolicy}, policies=${summary.policies.join(", ")})`,
        ),
      );
    }
  }

  if (args.checkHome) {
    if (!existsSync(ccrHomeRouteMapPath)) {
      results.push(
        resultEntry(
          "ccr_home",
          args.strictSync ? "error" : "warn",
          `missing ${rel(ccrHomeRouteMapPath)}; run \`ccmh ccr:sync-route-map\` if you use CCR`,
        ),
      );
    } else {
      const validation = validateRouteMapFile(ccrHomeRouteMapPath);
      if (!validation.ok) {
        results.push(resultEntry("ccr_home", "error", `${rel(ccrHomeRouteMapPath)} -> ${validation.issues.join("; ")}`));
      } else if (existsSync(routeMapPath) && routeMapDiffers(routeMapPath, ccrHomeRouteMapPath)) {
        results.push(
          resultEntry(
            "ccr_home",
            args.strictSync ? "error" : "warn",
            `${rel(ccrHomeRouteMapPath)} differs from ${rel(routeMapPath)}; run \`ccmh ccr:sync-route-map\``,
          ),
        );
      } else {
        const summary = validation.summary;
        results.push(
          resultEntry(
            "ccr_home",
            "ok",
            `${rel(ccrHomeRouteMapPath)} (default_policy=${summary.defaultPolicy}, policies=${summary.policies.join(", ")})`,
          ),
        );
      }
    }
  }

  const errors = results.filter((item) => item.status === "error");
  const warnings = results.filter((item) => item.status === "warn");

  if (args.json) {
    console.log(JSON.stringify({
      ok: errors.length === 0,
      errors: errors.length,
      warnings: warnings.length,
      results,
    }, null, 2));
    process.exitCode = errors.length > 0 ? 1 : 0;
    return;
  }

  console.log("CCR route-map validation");
  for (const item of results) {
    console.log(`- ${item.label}: ${item.status} ${item.detail}`);
  }
  console.log("");
  console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}

main();
