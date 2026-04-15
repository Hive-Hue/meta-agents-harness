import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadAndValidateRouteMap } from "./lib/route-map.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeScriptsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeScriptsRoot, "..");
const runtimeRoot = resolveRuntimeRoot(repoRoot);
const crewRoot = path.join(runtimeRoot, "crew");
const activeMetaPath = path.join(runtimeRoot, ".active-crew.json");
const settingsPath = path.join(runtimeRoot, "settings.json");
const packagePath = path.join(runtimeRoot, "package.json");
const mcpPath = path.join(repoRoot, ".mcp.json");
const sourceRouteMapPath = path.join(runtimeRoot, "ccr", "route-map.example.json");
const ccrHomeRouteMapPath = path.join(os.homedir(), ".claude-code-router", "multi-route-map.json");

function resolveRuntimeRoot(baseRepoRoot) {
  const envPath = process.env.MULTI_HOME?.trim() || process.env.PI_MULTI_HOME?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(baseRepoRoot, envPath);
  }

  const claudeRoot = path.join(baseRepoRoot, ".claude");
  if (
    existsSync(path.join(claudeRoot, "crew")) ||
    existsSync(path.join(claudeRoot, ".active-crew.json")) ||
    existsSync(path.join(claudeRoot, "ccr"))
  ) {
    return claudeRoot;
  }

  return path.join(baseRepoRoot, ".claude");
}

function parseArgs(argv) {
  const args = {
    ci: false,
    json: false,
    claudeCommand: process.env.CLAUDE_PATH || "claude",
    ccrCommand: "ccr",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--ci") {
      args.ci = true;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--claude-command") {
      args.claudeCommand = argv[i + 1] || args.claudeCommand;
      i += 1;
      continue;
    }
    if (token === "--ccr-command") {
      args.ccrCommand = argv[i + 1] || args.ccrCommand;
      i += 1;
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function listCrews() {
  if (!existsSync(crewRoot)) return [];
  return readdirSync(crewRoot)
    .filter((entry) => {
      const abs = path.join(crewRoot, entry);
      return statSync(abs).isDirectory() && existsSync(path.join(abs, "multi-team.yaml"));
    })
    .sort((a, b) => a.localeCompare(b));
}

function resolveCommand(binary) {
  const checker = process.platform === "win32" ? "where" : "which";
  const proc = spawnSync(checker, [binary], { encoding: "utf-8" });
  if (proc.status !== 0) return "";
  return (proc.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || "";
}

function rel(filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? path.relative(repoRoot, filePath) || "." : filePath;
}

function pushResult(results, label, status, detail, blocking = false) {
  results.push({ label, status, detail, blocking });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];

  if (existsSync(runtimeRoot)) {
    pushResult(results, "runtime_root", "ok", rel(runtimeRoot));
  } else {
    pushResult(results, "runtime_root", "error", `missing ${rel(runtimeRoot)}`, true);
  }

  const crews = listCrews();
  if (crews.length > 0) {
    pushResult(results, "crews", "ok", `${crews.length} found (${crews.join(", ")})`);
  } else {
    pushResult(results, "crews", "error", `no crews found under ${rel(crewRoot)}`, true);
  }

  if (existsSync(activeMetaPath)) {
    try {
      const active = readJson(activeMetaPath);
      const sourceConfig = active?.source_config ? path.resolve(repoRoot, active.source_config) : "";
      if (!active?.crew || !sourceConfig || !existsSync(sourceConfig)) {
        pushResult(results, "active_crew", "error", `invalid active crew metadata in ${rel(activeMetaPath)}`, true);
      } else {
        pushResult(results, "active_crew", "ok", `${active.crew} -> ${rel(sourceConfig)}`);
      }
    } catch (error) {
      pushResult(results, "active_crew", "error", `failed to parse ${rel(activeMetaPath)}: ${error.message}`, true);
    }
  } else {
    pushResult(results, "active_crew", "ok", "none selected");
  }

  for (const [label, filePath] of [
    ["package_json", packagePath],
    ["settings_json", settingsPath],
    ["mcp_json", mcpPath],
  ]) {
    if (!existsSync(filePath)) {
      pushResult(results, label, "error", `missing ${rel(filePath)}`, true);
      continue;
    }

    try {
      const parsed = readJson(filePath);
      if (label === "mcp_json") {
        const servers = parsed?.mcpServers && typeof parsed.mcpServers === "object" ? Object.keys(parsed.mcpServers) : [];
        if (servers.length === 0) {
          pushResult(results, label, "error", `${rel(filePath)} has no mcpServers`, true);
        } else {
          pushResult(results, label, "ok", `${rel(filePath)} (${servers.length} servers)`);
        }
      } else {
        pushResult(results, label, "ok", rel(filePath));
      }
    } catch (error) {
      pushResult(results, label, "error", `failed to parse ${rel(filePath)}: ${error.message}`, true);
    }
  }

  if (!existsSync(sourceRouteMapPath)) {
    pushResult(results, "route_map_source", "error", `missing ${rel(sourceRouteMapPath)}`, true);
  } else {
    try {
      const validation = loadAndValidateRouteMap(sourceRouteMapPath);
      if (!validation.ok) {
        throw new Error(validation.issues.join("; "));
      }
      const summary = validation.summary;
      pushResult(
        results,
        "route_map_source",
        "ok",
        `${rel(sourceRouteMapPath)} (default_policy=${summary.defaultPolicy}, policies=${summary.policyCount})`,
      );

      if (existsSync(ccrHomeRouteMapPath)) {
        try {
          const homeValidation = loadAndValidateRouteMap(ccrHomeRouteMapPath);
          if (!homeValidation.ok) {
            throw new Error(homeValidation.issues.join("; "));
          }
          const homeSummary = homeValidation.summary;
          const status = homeSummary.defaultPolicy === summary.defaultPolicy ? "ok" : "warn";
          const detail = `${rel(ccrHomeRouteMapPath)} (default_policy=${homeSummary.defaultPolicy})`;
          pushResult(results, "route_map_ccr_home", status, detail, false);
        } catch (error) {
          pushResult(results, "route_map_ccr_home", "warn", `invalid ${rel(ccrHomeRouteMapPath)}: ${error.message}`);
        }
      } else {
        pushResult(
          results,
          "route_map_ccr_home",
          "warn",
          `missing ${rel(ccrHomeRouteMapPath)}; run \`ccmh ccr:sync-route-map\` if you use CCR`,
        );
      }
    } catch (error) {
      pushResult(results, "route_map_source", "error", `invalid ${rel(sourceRouteMapPath)}: ${error.message}`, true);
    }
  }

  if (args.ci) {
    pushResult(results, "claude_binary", "skip", "skipped in --ci mode");
    pushResult(results, "ccr_binary", "skip", "skipped in --ci mode");
  } else {
    const claudePath = resolveCommand(args.claudeCommand);
    if (claudePath) {
      pushResult(results, "claude_binary", "ok", `${args.claudeCommand} -> ${claudePath}`);
    } else {
      pushResult(results, "claude_binary", "error", `command not found: ${args.claudeCommand}`, true);
    }

    const ccrPath = resolveCommand(args.ccrCommand);
    if (ccrPath) {
      pushResult(results, "ccr_binary", "ok", `${args.ccrCommand} -> ${ccrPath}`);
    } else {
      pushResult(results, "ccr_binary", "error", `command not found: ${args.ccrCommand}`, true);
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

  console.log("Harness doctor");
  for (const item of results) {
    console.log(`- ${item.label}: ${item.status} ${item.detail}`);
  }
  console.log("");
  console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}

main();
