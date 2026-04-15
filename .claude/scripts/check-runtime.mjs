import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadAndValidateRouteMap } from "./lib/route-map.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeRoot, "..");

function collectFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const files = [];

  for (const entry of readdirSync(rootPath)) {
    const abs = path.join(rootPath, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      files.push(...collectFiles(abs));
      continue;
    }
    files.push(abs);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function rel(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function checkSyntax(filePath) {
  const proc = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf-8" });
  if (proc.status !== 0) {
    const detail = (proc.stderr || proc.stdout || "unknown syntax error").trim();
    throw new Error(detail);
  }
}

function main() {
  const scriptFiles = [
    ...collectFiles(path.join(runtimeRoot, "bin")),
    ...collectFiles(path.join(runtimeRoot, "scripts")),
    ...collectFiles(path.join(runtimeRoot, "tests")),
  ].filter((filePath) => {
    return [".mjs", ".cjs", ".js", ""].includes(path.extname(filePath));
  });

  const mcpConfigPath = path.join(repoRoot, ".mcp.json");

  const jsonFiles = [
    mcpConfigPath,
    path.join(runtimeRoot, "package.json"),
    path.join(runtimeRoot, "settings.json"),
    path.join(runtimeRoot, "ccr", "route-map.example.json"),
  ];

  const yamlFiles = collectFiles(path.join(runtimeRoot, "crew")).filter((filePath) => {
    return path.basename(filePath) === "multi-team.yaml";
  });

  let failures = 0;

  for (const filePath of scriptFiles) {
    try {
      checkSyntax(filePath);
      console.log(`ok: syntax ${rel(filePath)}`);
    } catch (error) {
      failures += 1;
      console.error(`ERROR: syntax ${rel(filePath)} -> ${error.message}`);
    }
  }

  for (const filePath of jsonFiles) {
    if (!existsSync(filePath)) {
      failures += 1;
      if (filePath === mcpConfigPath) {
        console.error(`ERROR: missing ${rel(filePath)} (copy from .mcp.example.json)`);
      } else {
        console.error(`ERROR: missing ${rel(filePath)}`);
      }
      continue;
    }

    try {
      if (filePath.endsWith("route-map.example.json")) {
        const validation = loadAndValidateRouteMap(filePath);
        if (!validation.ok) {
          throw new Error(validation.issues.join("; "));
        }
      } else {
        readJson(filePath);
      }
      console.log(`ok: json ${rel(filePath)}`);
    } catch (error) {
      failures += 1;
      console.error(`ERROR: json ${rel(filePath)} -> ${error.message}`);
    }
  }

  if (yamlFiles.length === 0) {
    failures += 1;
    console.error(`ERROR: no multi-team configs found under ${rel(path.join(runtimeRoot, "crew"))}`);
  } else {
    for (const filePath of yamlFiles) {
      console.log(`ok: config ${rel(filePath)}`);
    }
  }

  process.exitCode = failures > 0 ? 1 : 0;
}

main();
