import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeScriptsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(runtimeScriptsRoot, "..");
const runtimeRoot = resolveRuntimeRoot(repoRoot);
const crewRoot = path.join(runtimeRoot, "crew");
const activeMetaPath = path.join(runtimeRoot, ".active-crew.json");

const DEFAULT_POLICY = "balanced";
const DEFAULT_STRICT_HIERARCHY = parseBooleanEnv(
  process.env.MULTI_STRICT_HIERARCHY ?? process.env.PI_MULTI_STRICT_HIERARCHY,
  true,
);
const defaultCcrRouteMapPath = path.join(process.env.HOME || "", ".claude-code-router", "multi-route-map.json");
const fallbackRouteMapPaths = [
  path.join(runtimeRoot, "ccr", "route-map.example.json"),
  path.join(runtimeScriptsRoot, "ccr", "route-map.example.json"),
];

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

function fail(message) {
	console.error(`ERROR: ${message}`);
	process.exitCode = 1;
}

function parseBooleanEnv(value, fallback) {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return fallback;
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return fallback;
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
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

function parseArgs(argv) {
	const args = {
		crew: undefined,
		config: undefined,
		policy: undefined,
		rootModel: undefined,
		strictHierarchy: DEFAULT_STRICT_HIERARCHY,
		ccrCommand: "ccr",
		claudeCommand: process.env.CLAUDE_PATH || "claude",
		noActivate: false,
    sessionMirror: false,
    dryRun: false,
    fullPrompts: false,
    rootRoute: false,
    showLaunchInfo: false,
    passthrough: [],
  };

  let passthroughMode = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      passthroughMode = true;
      continue;
    }

    if (passthroughMode) {
      args.passthrough.push(token);
      continue;
    }

    if (token === "--crew") {
      args.crew = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--config") {
      args.config = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--ccr-policy" || token === "--policy") {
      args.policy = argv[i + 1] || args.policy;
      i += 1;
      continue;
    }

    if (token === "--ccr-root-model" || token === "--root-model") {
      args.rootModel = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--ccr-command") {
      args.ccrCommand = argv[i + 1] || "ccr";
      i += 1;
      continue;
    }

    if (token === "--claude-command") {
      args.claudeCommand = argv[i + 1] || args.claudeCommand;
      i += 1;
      continue;
    }

    if (token === "--no-ccr-activate") {
      args.noActivate = true;
      continue;
    }

    if (token === "--session-mirror") {
      args.sessionMirror = true;
      continue;
    }

    if (token === "--no-session-mirror") {
      args.sessionMirror = false;
      continue;
    }

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (token === "--full-prompts") {
      args.fullPrompts = true;
      continue;
    }

    if (token === "--root-route") {
      args.rootRoute = true;
      continue;
    }

    if (token === "--show-launch-info") {
      args.showLaunchInfo = true;
      continue;
    }

    if (token === "--hierarchy") {
      args.strictHierarchy = true;
      continue;
    }

    if (token === "--no-hierarchy") {
      args.strictHierarchy = false;
      continue;
    }

    args.passthrough.push(token);
  }

  return args;
}

function printHelp() {
  const routeMapDefault = resolveDefaultPolicyFromRouteMap();
  const effectiveDefault = routeMapDefault || DEFAULT_POLICY;
  console.log("Usage: ccmh run [options] [-- <claude-args>]");
  console.log("");
  console.log("Open Claude Code TUI through CCR, loading crew agents as custom agents.");
  console.log("");
  console.log("Options:");
  console.log("  --crew <name>            Use .claude/crew/<name>/multi-team.yaml");
  console.log("  --config <path>          Explicit config path (overrides active crew)");
  console.log(`  --policy <name>          Route policy tag (default: ${effectiveDefault})`);
  console.log("  --root-model <ref>       Root model tag override (provider,model or provider/model)");
  console.log("  --ccr-command <bin>      Runner command (default: ccr)");
  console.log("  --claude-command <bin>   Claude binary path (default: CLAUDE_PATH or claude)");
  console.log("  --no-ccr-activate        Skip auto-loading env from `ccr activate`");
  console.log("  --session-mirror         Mirror Claude session pointers under .claude/crew/<crew>/sessions");
  console.log("  --full-prompts           Inject full agent markdown prompts (larger context usage)");
  console.log("  --root-route             Route orchestrator/root turn by policy");
  console.log("  --show-launch-info       Print launcher runtime details before opening TUI");
  console.log(`  --hierarchy              Strict hierarchy mode (default: ${DEFAULT_STRICT_HIERARCHY ? "enabled" : "disabled"})`);
  console.log("  --no-hierarchy           Allow orchestrator to delegate directly to workers");
  console.log("  --dry-run                Print generated command and exit");
  console.log("");
  console.log("Examples:");
  console.log("  ccmh run --crew marketing");
  console.log("  ccmh run --crew marketing --policy economy");
  console.log("  ccmh run --crew marketing --root-route --root-model lmstudio,nvidia/nemotron-3-nano-4b");
  console.log("  ccmh run --crew marketing --session-mirror -- -p \"status\"");
  console.log("  ccmh run --crew marketing -- -c");
  console.log("  ccmh run --crew marketing -- --permission-mode bypassPermissions -c");
}

function stripYamlComments(line) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i).trimEnd();
      }
    }
  }

  return line.trimEnd();
}

function preprocessYaml(raw) {
  return raw
    .replace(/\t/g, "    ")
    .split("\n")
    .map((line) => stripYamlComments(line))
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      indent: line.match(/^ */)?.[0].length || 0,
      content: line.trim(),
    }));
}

function parseInlineArray(token) {
  const body = token.slice(1, -1).trim();
  if (!body) return [];
  return body
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function parseScalarToken(token) {
  if (token === "[]") return [];
  if (token === "{}") return {};
  if (token.startsWith("[") && token.endsWith("]")) return parseInlineArray(token);
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  if (token === "true") return true;
  if (token === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  return token;
}

function nextRelevantLine(lines, index) {
  for (let i = index; i < lines.length; i += 1) {
    if (lines[i]) return lines[i];
  }
  return null;
}

function parseYamlBlock(lines, startIndex, indent) {
  if (startIndex >= lines.length) return { value: null, index: startIndex };

  const first = lines[startIndex];
  if (first.content.startsWith("- ")) {
    const items = [];
    let index = startIndex;

    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) break;
      if (line.indent !== indent || !line.content.startsWith("- ")) break;

      const rest = line.content.slice(2).trim();
      if (!rest) {
        const next = nextRelevantLine(lines, index + 1);
        if (next && next.indent > indent) {
          const child = parseYamlBlock(lines, index + 1, next.indent);
          items.push(child.value);
          index = child.index;
        } else {
          items.push("");
          index += 1;
        }
        continue;
      }

      const colonIndex = rest.indexOf(":");
      if (colonIndex === -1) {
        items.push(parseScalarToken(rest));
        index += 1;
        continue;
      }

      const item = {};
      const key = rest.slice(0, colonIndex).trim();
      const valueToken = rest.slice(colonIndex + 1).trim();

      if (valueToken) {
        item[key] = parseScalarToken(valueToken);
        index += 1;
      } else {
        const next = nextRelevantLine(lines, index + 1);
        if (next && next.indent > indent) {
          const child = parseYamlBlock(lines, index + 1, next.indent);
          item[key] = child.value;
          index = child.index;
        } else {
          item[key] = "";
          index += 1;
        }
      }

      while (index < lines.length) {
        const sibling = lines[index];
        if (sibling.indent <= indent) break;
        if (sibling.indent !== indent + 2) break;
        if (sibling.content.startsWith("- ")) break;

        const siblingColon = sibling.content.indexOf(":");
        if (siblingColon === -1) {
          index += 1;
          continue;
        }

        const siblingKey = sibling.content.slice(0, siblingColon).trim();
        const siblingValueToken = sibling.content.slice(siblingColon + 1).trim();

        if (siblingValueToken) {
          item[siblingKey] = parseScalarToken(siblingValueToken);
          index += 1;
          continue;
        }

        const next = nextRelevantLine(lines, index + 1);
        if (next && next.indent > sibling.indent) {
          const child = parseYamlBlock(lines, index + 1, next.indent);
          item[siblingKey] = child.value;
          index = child.index;
        } else {
          item[siblingKey] = "";
          index += 1;
        }
      }

      items.push(item);
    }

    return { value: items, index };
  }

  const object = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent !== indent) break;
    if (line.content.startsWith("- ")) break;

    const colonIndex = line.content.indexOf(":");
    if (colonIndex === -1) {
      index += 1;
      continue;
    }

    const key = line.content.slice(0, colonIndex).trim();
    const valueToken = line.content.slice(colonIndex + 1).trim();

    if (valueToken) {
      object[key] = parseScalarToken(valueToken);
      index += 1;
      continue;
    }

    const next = nextRelevantLine(lines, index + 1);
    if (next && next.indent > indent) {
      const child = parseYamlBlock(lines, index + 1, next.indent);
      object[key] = child.value;
      index = child.index;
    } else {
      object[key] = "";
      index += 1;
    }
  }

  return { value: object, index };
}

function parseYamlSubset(raw) {
  const lines = preprocessYaml(raw);
  if (lines.length === 0) return {};
  return parseYamlBlock(lines, 0, lines[0].indent).value;
}

function stripFrontmatter(raw) {
  const match = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  return match ? match[1].trim() : raw.trim();
}

function normalizeRouteKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeCcrModelRef(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const ccrRaw = lower.startsWith("ccr:") ? raw.slice(4).trim() : raw;
  if (!ccrRaw) return "";
  if (ccrRaw.includes(",")) return ccrRaw;
  const slash = ccrRaw.indexOf("/");
  if (slash <= 0 || slash >= ccrRaw.length - 1) return "";
  const provider = ccrRaw.slice(0, slash).trim();
  const model = ccrRaw.slice(slash + 1).trim();
  if (!provider || !model) return "";
  return `${provider},${model}`;
}

function resolveRouteMapPath() {
  const fromEnv = process.env.MULTI_CCR_ROUTE_MAP_PATH?.trim() || process.env.PI_MULTI_CCR_ROUTE_MAP_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(defaultCcrRouteMapPath)) return defaultCcrRouteMapPath;
  for (const fallback of fallbackRouteMapPaths) {
    if (existsSync(fallback)) return fallback;
  }
  return null;
}

function resolveDefaultPolicyFromRouteMap() {
  const mapPath = resolveRouteMapPath();
  if (!mapPath) return "";
  const routeMap = readJson(mapPath);
  if (!routeMap || typeof routeMap !== "object") return "";
  const policy = normalizeRouteKey(routeMap.default_policy);
  return policy || "";
}

function resolveRootModelFromRoutePolicy(policyName) {
  const mapPath = resolveRouteMapPath();
  if (!mapPath) return null;
  const routeMap = readJson(mapPath);
  if (!routeMap || typeof routeMap !== "object") return null;

  const policy = normalizeRouteKey(policyName);
  const fromPolicy = policy && routeMap.policies && typeof routeMap.policies === "object"
    ? routeMap.policies[policy]
    : null;

  const candidates = [];
  if (fromPolicy && typeof fromPolicy === "object") {
    candidates.push(fromPolicy.roles?.orchestrator);
    candidates.push(fromPolicy.systems?.orchestrator);
  }
  candidates.push(routeMap.roles?.orchestrator);
  candidates.push(routeMap.systems?.orchestrator);

  for (const candidate of candidates) {
    const normalized = normalizeCcrModelRef(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function resolveFromRepo(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(repoRoot, filePath);
}

function readActiveMeta() {
  if (!existsSync(activeMetaPath)) return null;
  try {
    return JSON.parse(readFileSync(activeMetaPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveConfigPath(args) {
  const active = readActiveMeta();

  if (args.config) {
    return resolveFromRepo(args.config);
  }

  if (args.crew) {
    const crews = listCrews();
    if (!crews.includes(args.crew)) {
      fail(`crew not found: ${args.crew}`);
      console.log("Available crews:");
      for (const crew of crews) console.log(`- ${crew}`);
      return null;
    }
    return path.join(crewRoot, args.crew, "multi-team.yaml");
  }

  if (active?.source_config) {
    return resolveFromRepo(active.source_config);
  }

  const crews = listCrews();
  if (crews.length === 1) {
    return path.join(crewRoot, crews[0], "multi-team.yaml");
  }

  fail("no crew selected. Use --crew <name> or activate one with ccmh use <crew>.");
  if (crews.length > 0) {
    console.log("Available crews:");
    for (const crew of crews) console.log(`- ${crew}`);
  }
  return null;
}

function safeReadText(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function routeHintTag({ role, team, agent, system, intent = "general", policy = "" }) {
  return `<MULTI-ROUTE>${JSON.stringify({ role, team, agent, system, intent, policy })}</MULTI-ROUTE>`;
}

function buildRootPrompt(
  config,
  policy,
  rootModelTag,
  includeRootRouteTag,
  strictHierarchy,
  orchestratorPromptPath,
  orchestratorPromptBody,
  fullPrompts
) {
  const teamLines = [];
  const workerNames = [];
  for (const team of config.teams || []) {
    const lead = team?.lead?.name || "(missing-lead)";
    const members = Array.isArray(team?.members) ? team.members.map((m) => m?.name).filter(Boolean) : [];
    workerNames.push(...members);
    if (strictHierarchy) {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}`);
    } else {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}${members.length > 0 ? ` -> ${members.join(", ")}` : ""}`);
    }
  }

  const blocks = [
    includeRootRouteTag
      ? routeHintTag({
          role: "orchestrator",
          team: "",
          agent: config?.orchestrator?.name || "orchestrator",
          system: config?.name || "multiteam",
          intent: "planning",
          policy,
        })
      : "",
    includeRootRouteTag && rootModelTag ? `<CCR-ROOT-MODEL>${rootModelTag}</CCR-ROOT-MODEL>` : "",
    `Current role: orchestrator`,
    `Current team: Global Orchestrator`,
    `Current agent: ${config?.orchestrator?.name || "orchestrator"}`,
    `You are inside the "${config?.name || "MultiTeam"}" multi-agent runtime.`,
    `Routing policy: ${policy || "none"}`,
    `Hierarchy mode: ${strictHierarchy ? "strict" : "relaxed"}`,
    ``,
    `Topology:`,
    ...teamLines,
    ``,
    `Hard rules:`,
    strictHierarchy ? `- Delegate only to team leads listed in Topology.` : `- You may delegate to leads and workers listed in Topology.`,
    strictHierarchy && workerNames.length > 0
      ? `- Never delegate directly to workers (${workerNames.join(", ")}). Delegate to the corresponding lead instead.`
      : "",
    `- For each delegated task, include explicit deliverables and stop conditions.`,
    `- Ask for concise status first when context is missing.`,
    ``,
    `Primary playbook file: ${orchestratorPromptPath}`,
    `Read that file when you need detailed orchestration rules and response contract.`,
    fullPrompts ? `Agent operating prompt:\n${orchestratorPromptBody}` : "",
  ].filter(Boolean);

  return blocks.join("\n");
}

function buildCustomAgentPrompt({
  role,
  teamName,
  agentName,
  systemName,
  policy,
  promptPath,
  promptBody,
  fullPrompts,
  delegateTargets,
}) {
  const canDelegate = role === "lead" && delegateTargets.length > 0;

  const blocks = [
    routeHintTag({
      role,
      team: (teamName || "").toLowerCase(),
      agent: agentName,
      system: (systemName || "").toLowerCase(),
      intent: role === "worker" ? "coding" : "planning",
      policy,
    }),
    `Current role: ${role}`,
    `Current team: ${teamName || ""}`,
    `Current agent: ${agentName}`,
    `You are inside the "${systemName || "MultiTeam"}" multi-agent runtime.`,
    `Routing policy: ${policy || "none"}`,
    ``,
    `Hard rules:`,
    canDelegate
      ? `- You may delegate only to: ${delegateTargets.join(", ")}.`
      : `- Do not delegate to other agents unless explicitly instructed by orchestrator.`,
    `- Keep responses concise and execution-oriented.`,
    ``,
    `Primary playbook file: ${promptPath}`,
    `Read that file when you need detailed role policy and output contract.`,
    fullPrompts ? `Agent operating prompt:\n${promptBody}` : "",
  ];

  return blocks.join("\n");
}

function parseCrewConfig(configPath) {
  const raw = safeReadText(configPath);
  const parsed = parseYamlSubset(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config format: ${configPath}`);
  }
  if (!parsed.orchestrator || typeof parsed.orchestrator !== "object") {
    throw new Error(`Config missing orchestrator block: ${configPath}`);
  }
  if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) {
    throw new Error(`Config missing teams array: ${configPath}`);
  }

  return parsed;
}

function loadPromptBody(configPath, promptPath) {
  const candidates = [
    resolveFromRepo(promptPath),
    path.resolve(path.dirname(configPath), promptPath),
  ];

  let abs = candidates[0];
  let raw = "";
  for (const candidate of candidates) {
    const content = safeReadText(candidate);
    if (content) {
      abs = candidate;
      raw = content;
      break;
    }
  }

  const body = stripFrontmatter(raw);
  if (!body) {
    throw new Error(`Prompt file missing or empty: ${abs}`);
  }
  return body;
}

function buildAgentsJson(config, configPath, policy, fullPrompts, strictHierarchy) {
  const agents = {};
  const systemName = config?.name || "MultiTeam";
  const includeWorkers = !strictHierarchy;

  for (const team of config.teams) {
    const teamName = team?.name || "unknown-team";
    const lead = team?.lead;
    if (!lead?.name || !lead?.prompt) continue;

    const memberNames = Array.isArray(team.members)
      ? team.members.map((member) => member?.name).filter(Boolean)
      : [];

    const leadPromptBody = fullPrompts ? loadPromptBody(configPath, lead.prompt) : "";
    agents[lead.name] = {
      description: lead.description || `Lead agent for team ${teamName}`,
      prompt: buildCustomAgentPrompt({
        role: "lead",
        teamName,
        agentName: lead.name,
        systemName,
        policy,
        promptPath: lead.prompt,
        promptBody: leadPromptBody,
        fullPrompts,
        delegateTargets: memberNames,
      }),
    };

    if (includeWorkers) {
      for (const member of team.members || []) {
        if (!member?.name || !member?.prompt) continue;
        const memberPromptBody = fullPrompts ? loadPromptBody(configPath, member.prompt) : "";
        agents[member.name] = {
          description: member.description || `Worker agent for team ${teamName}`,
          prompt: buildCustomAgentPrompt({
            role: "worker",
            teamName,
            agentName: member.name,
            systemName,
            policy,
            promptPath: member.prompt,
            promptBody: memberPromptBody,
            fullPrompts,
            delegateTargets: [],
          }),
        };
      }
    }
  }

  return agents;
}

function parseExportLines(raw) {
  const env = {};
  for (const line of (raw || "").split("\n")) {
    const match = line.trim().match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadCcrActivateEnv(ccrCommand) {
  const proc = spawnSync(ccrCommand, ["activate"], { encoding: "utf-8" });
  if (proc.status !== 0) {
    const stderr = (proc.stderr || "").trim();
    const stdout = (proc.stdout || "").trim();
    const details = stderr || stdout || "unknown error";
    throw new Error(`ccr activate failed: ${details}`);
  }
  return parseExportLines(proc.stdout || "");
}

function normalizeUuid(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return "";
  }
  return raw.toLowerCase();
}

function parseSessionIdFromPassthrough(passthrough) {
  for (let i = 0; i < passthrough.length; i += 1) {
    const token = passthrough[i];
    if (token === "--session-id") {
      return normalizeUuid(passthrough[i + 1] || "");
    }
    if (token.startsWith("--session-id=")) {
      return normalizeUuid(token.slice("--session-id=".length));
    }
  }
  return "";
}

function hasResumeLikeArgs(passthrough) {
  for (let i = 0; i < passthrough.length; i += 1) {
    const token = passthrough[i];
    if (
      token === "-c" ||
      token === "--continue" ||
      token === "-r" ||
      token === "--resume" ||
      token.startsWith("--resume=") ||
      token === "--from-pr" ||
      token.startsWith("--from-pr=")
    ) {
      return true;
    }
  }
  return false;
}

function toSessionStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function writeJsonFile(filePath, payload) {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function appendJsonl(filePath, payload) {
  writeFileSync(filePath, `${JSON.stringify(payload)}\n`, { encoding: "utf-8", flag: "a" });
}

function resolveClaudeProjectSlug(absolutePath) {
  return absolutePath.replace(/[\\/]/g, "-");
}

function initSessionMirror({
  configPath,
  policy,
  rootModel,
  strictHierarchy,
  claudeSessionId,
  command,
  commandArgs,
}) {
  const sessionBase = path.join(path.dirname(configPath), "sessions");
  mkdirSync(sessionBase, { recursive: true });

  const mirrorSessionId = `${toSessionStamp()}-${claudeSessionId.slice(0, 8)}`;
  const mirrorRoot = path.join(sessionBase, mirrorSessionId);
  mkdirSync(mirrorRoot, { recursive: true });

  const claudeProjectsRoot = path.join(process.env.HOME || "", ".claude", "projects");
  const projectSlug = resolveClaudeProjectSlug(repoRoot);
  const claudeProjectDir = path.join(claudeProjectsRoot, projectSlug);
  const claudeConversationPath = path.join(claudeProjectDir, `${claudeSessionId}.jsonl`);

  const manifestPath = path.join(mirrorRoot, "manifest.json");
  const indexPath = path.join(mirrorRoot, "session_index.json");
  const eventsPath = path.join(mirrorRoot, "events.jsonl");
  const convoPath = path.join(mirrorRoot, "conversation.jsonl");
  const pointerPath = path.join(mirrorRoot, "conversation.pointer");

  const createdAt = new Date().toISOString();

  const manifest = {
    sessionId: mirrorSessionId,
    type: "claude_ccr_session_mirror",
    crewConfigPath: configPath,
    root: mirrorRoot,
    createdAt,
    claude: {
      sessionId: claudeSessionId,
      projectDir: claudeProjectDir,
      conversationJsonl: claudeConversationPath,
    },
    runtime: {
      policy,
      strictHierarchy,
      rootModel: rootModel || null,
      command,
      args: commandArgs,
    },
    files: {
      index: "session_index.json",
      events: "events.jsonl",
      conversation: "conversation.jsonl",
      pointer: "conversation.pointer",
    },
  };

  const sessionIndex = {
    sessionId: mirrorSessionId,
    type: "claude_ccr_session_mirror",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    crewConfigPath: configPath,
    claudeSessionId,
    claudeConversationPath,
    policy,
    strictHierarchy,
    rootModel: rootModel || null,
  };

  writeJsonFile(manifestPath, manifest);
  writeJsonFile(indexPath, sessionIndex);
  appendJsonl(eventsPath, {
    type: "session_mirror_start",
    at: createdAt,
    sessionId: mirrorSessionId,
    claudeSessionId,
    policy,
    strictHierarchy,
    rootModel: rootModel || null,
  });

  writeFileSync(pointerPath, `${claudeConversationPath}\n`, "utf-8");
  try {
    symlinkSync(claudeConversationPath, convoPath);
  } catch {
    // keep pointer-only mode when symlink cannot be created
  }

  return {
    mirrorSessionId,
    mirrorRoot,
    indexPath,
    eventsPath,
    claudeSessionId,
    claudeConversationPath,
  };
}

function finalizeSessionMirror(mirror, status, exitCode, errorMessage) {
  if (!mirror) return;
  const now = new Date().toISOString();
  const index = readJson(mirror.indexPath) || {};
  index.status = status;
  index.updatedAt = now;
  if (typeof exitCode === "number") index.exitCode = exitCode;
  if (errorMessage) index.error = errorMessage;
  writeJsonFile(mirror.indexPath, index);

  appendJsonl(mirror.eventsPath, {
    type: "session_mirror_end",
    at: now,
    sessionId: mirror.mirrorSessionId,
    claudeSessionId: mirror.claudeSessionId,
    status,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    error: errorMessage || null,
  });
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const configPath = resolveConfigPath(args);
  if (!configPath) return;

  if (!existsSync(configPath)) {
    fail(`config not found: ${configPath}`);
    return;
  }

  let config;
  try {
    config = parseCrewConfig(configPath);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const envPolicy = normalizeRouteKey(process.env.MULTI_CCR_POLICY?.trim() || process.env.PI_MULTI_CCR_POLICY?.trim() || "");
  const routeMapDefaultPolicy = resolveDefaultPolicyFromRouteMap();
  const policy = normalizeRouteKey(args.policy) || routeMapDefaultPolicy || envPolicy || DEFAULT_POLICY;
  const includeRootRouteTag = args.rootRoute || !!args.rootModel;
  const derivedRoot = args.rootModel ? normalizeCcrModelRef(args.rootModel) : null;
  const routeRoot = includeRootRouteTag && !derivedRoot ? resolveRootModelFromRoutePolicy(policy) : null;
  const rootModel = derivedRoot || routeRoot || "";

  let orchestratorPromptBody = "";
  if (args.fullPrompts) {
    try {
      orchestratorPromptBody = loadPromptBody(configPath, config.orchestrator.prompt);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  let agents;
  try {
    agents = buildAgentsJson(config, configPath, policy, args.fullPrompts, args.strictHierarchy);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const rootPrompt = buildRootPrompt(
    config,
    policy,
    rootModel,
    includeRootRouteTag,
    args.strictHierarchy,
    config.orchestrator.prompt,
    orchestratorPromptBody,
    args.fullPrompts
  );
  const agentsJson = JSON.stringify(agents);

  let activatedEnv = {};
  if (!args.noActivate) {
    try {
      activatedEnv = loadCcrActivateEnv(args.ccrCommand);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  const command = args.claudeCommand;
  const requestedSessionId = parseSessionIdFromPassthrough(args.passthrough);
  const resumeLike = hasResumeLikeArgs(args.passthrough);
  let claudeSessionId = requestedSessionId;
  let sessionMirrorReason = "";

  if (args.sessionMirror && !claudeSessionId && !resumeLike) {
    claudeSessionId = randomUUID();
  } else if (args.sessionMirror && !claudeSessionId && resumeLike) {
    sessionMirrorReason = "resume_or_continue_mode_without_explicit_session_id";
  }

  const commandArgs = [
    "--append-system-prompt",
    rootPrompt,
    "--agents",
    agentsJson,
    ...(claudeSessionId ? ["--session-id", claudeSessionId] : []),
    ...args.passthrough,
  ];

  const env = {
    ...process.env,
    ...activatedEnv,
    MULTI_CCR_POLICY: policy,
    PI_MULTI_CCR_POLICY: policy,
  };

  if (rootModel) {
    env.MULTI_CCR_ROOT_MODEL = rootModel;
    env.PI_MULTI_CCR_ROOT_MODEL = rootModel;
  }

  if (!env.ANTHROPIC_API_KEY && typeof env.ANTHROPIC_AUTH_TOKEN === "string" && env.ANTHROPIC_AUTH_TOKEN.trim()) {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN.trim();
  }

  if (args.showLaunchInfo || args.dryRun) {
    console.log("Running Claude Code TUI via CCR with multi-agent crew config");
    console.log(`- config=${path.relative(repoRoot, configPath)}`);
    console.log(`- system=${config.name || "MultiTeam"}`);
    console.log(`- policy=${policy}`);
    console.log(`- root_route=${includeRootRouteTag ? "enabled" : "disabled"}`);
    console.log(`- hierarchy=${args.strictHierarchy ? "strict" : "relaxed"}`);
    console.log(`- root_model=${rootModel || "(default CCR routing)"}`);
    console.log(`- custom_agents=${Object.keys(agents).length}`);
    console.log(`- prompt_mode=${args.fullPrompts ? "full" : "compact"}`);
    console.log(`- runner=${command}`);
    if (args.sessionMirror) console.log(`- session_mirror=${sessionMirrorReason ? `disabled (${sessionMirrorReason})` : "enabled"}`);
    if (claudeSessionId) console.log(`- claude_session_id=${claudeSessionId}`);
    if (!args.noActivate) console.log("- ccr_activate=enabled");
    if (env.ANTHROPIC_BASE_URL) console.log(`- ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`);
    if (env.ANTHROPIC_API_KEY) console.log("- ANTHROPIC_API_KEY=***");
    if (args.passthrough.length > 0) console.log(`- args=${args.passthrough.join(" ")}`);
    console.log("");
  }

  if (args.dryRun) {
    console.log(`[dry-run] ${command} ${commandArgs.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ")}`);
    return;
  }

  const mirror = args.sessionMirror && claudeSessionId
    ? initSessionMirror({
        configPath,
        policy,
        rootModel,
        strictHierarchy: args.strictHierarchy,
        claudeSessionId,
        command,
        commandArgs,
      })
    : null;

  if (mirror && (args.showLaunchInfo || args.dryRun)) {
    console.log(`- mirror_root=${path.relative(repoRoot, mirror.mirrorRoot)}`);
    console.log(`- mirror_conversation=${mirror.claudeConversationPath}`);
    console.log("");
  }

  const child = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  if (typeof child.status === "number") {
    finalizeSessionMirror(mirror, child.status === 0 ? "done" : "failed", child.status, "");
    process.exitCode = child.status;
    return;
  }
  if (child.error) {
    finalizeSessionMirror(mirror, "failed", null, child.error.message);
    fail(`failed to start ${command}: ${child.error.message}`);
    return;
  }
  finalizeSessionMirror(mirror, "unknown", null, "");
}

main();
