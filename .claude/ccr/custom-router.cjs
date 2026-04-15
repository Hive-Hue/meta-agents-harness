const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_MAP_PATH = path.join(os.homedir(), ".claude-code-router", "multi-route-map.json");
const LEGACY_MAP_PATH = path.join(os.homedir(), ".claude-code-router", "pi-multi-route-map.json");
let routeMapCache = null;
let routeMapCacheMtime = 0;
let routeMapCachePath = "";

function readFirstTextBlock(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (!block) continue;
    if (typeof block === "string") return block;
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}

function readSystemText(systemBlocks) {
  if (!Array.isArray(systemBlocks) || systemBlocks.length === 0) return "";
  return systemBlocks
    .map((block) => {
      if (!block) return "";
      if (typeof block === "string") return block;
      if (typeof block.text === "string") return block.text;
      if (Array.isArray(block.content)) return readFirstTextBlock(block.content);
      return readFirstTextBlock(block);
    })
    .filter(Boolean)
    .join("\n");
}

function extractTag(text, tagName) {
  if (!text || typeof text !== "string") return null;
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "m");
  const match = text.match(re);
  return match && match[1] ? match[1].trim() : null;
}

function normalizeModelRef(value) {
  if (!value || typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.includes(",")) return raw;

  const slash = raw.indexOf("/");
  if (slash <= 0 || slash >= raw.length - 1) return null;
  const provider = raw.slice(0, slash).trim();
  const model = raw.slice(slash + 1).trim();
  if (!provider || !model) return null;
  return `${provider},${model}`;
}

function parseRouteHint(text) {
  const raw = extractTag(text, "MULTI-ROUTE") || extractTag(text, "PI-MULTI-ROUTE");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      role: typeof parsed.role === "string" ? parsed.role.trim().toLowerCase() : "",
      team: typeof parsed.team === "string" ? parsed.team.trim().toLowerCase() : "",
      agent: typeof parsed.agent === "string" ? parsed.agent.trim().toLowerCase() : "",
      system: typeof parsed.system === "string" ? parsed.system.trim().toLowerCase() : "",
      intent: typeof parsed.intent === "string" ? parsed.intent.trim().toLowerCase() : "",
      policy: typeof parsed.policy === "string" ? parsed.policy.trim().toLowerCase() : "",
    };
  } catch {
    return null;
  }
}

function parseRuntimeHint(text) {
  if (!text || typeof text !== "string") return null;
  const roleMatch = text.match(/Current role:\s*([A-Za-z_-]+)/i);
  if (!roleMatch || !roleMatch[1]) return null;
  const role = roleMatch[1].trim().toLowerCase();
  const teamMatch = text.match(/Current team:\s*([^\n.]+)/i);
  const teamRaw = teamMatch && teamMatch[1] ? teamMatch[1].trim().toLowerCase() : "";
  const team = teamRaw.includes("global orchestrator") ? "" : teamRaw;
  const agentMatch = text.match(/Current agent:\s*([^\n.]+)/i);
  const agent = agentMatch && agentMatch[1] ? agentMatch[1].trim().toLowerCase().replace(/\s+/g, "-") : "";
  const systemMatch = text.match(/inside the \"([^\"]+)\" multi-agent runtime/i);
  const system = systemMatch && systemMatch[1] ? systemMatch[1].trim().toLowerCase() : "";
  return { role, team, agent, system, intent: "", policy: "" };
}

function inferIntent(text) {
  if (!text || typeof text !== "string") return "general";
  const lower = text.toLowerCase();
  const has = (...tokens) => tokens.some((token) => lower.includes(token));

  if (has("1-line status", "one-line status", "quick status", "stand by", "standby")) return "status";
  if (has("research", "benchmark", "investigate", "analyze", "analyse", "compare", "market scan")) return "research";
  if (has("plan", "planning", "roadmap", "strategy", "proposal", "outline")) return "planning";
  if (has("implement", "implementation", "code", "patch", "refactor", "fix", "bug", "feature")) return "coding";
  if (has("validate", "validation", "verify", "verification", "test", "qa", "check")) return "validation";
  return "general";
}

function getRouteMap(config) {
  const configuredPath = typeof config?.MULTI_CCR_ROUTE_MAP_PATH === "string"
    ? config.MULTI_CCR_ROUTE_MAP_PATH.trim()
    : (typeof config?.PI_MULTI_CCR_ROUTE_MAP_PATH === "string" ? config.PI_MULTI_CCR_ROUTE_MAP_PATH.trim() : "");
  const mapPath = configuredPath || (fs.existsSync(DEFAULT_MAP_PATH) ? DEFAULT_MAP_PATH : LEGACY_MAP_PATH);
  if (!fs.existsSync(mapPath)) return null;

  const stat = fs.statSync(mapPath);
  if (routeMapCache && routeMapCachePath === mapPath && routeMapCacheMtime === stat.mtimeMs) {
    return routeMapCache;
  }

  try {
    const raw = fs.readFileSync(mapPath, "utf-8");
    const parsed = JSON.parse(raw);
    routeMapCache = parsed && typeof parsed === "object" ? parsed : null;
    routeMapCacheMtime = stat.mtimeMs;
    routeMapCachePath = mapPath;
    return routeMapCache;
  } catch {
    return null;
  }
}

function resolveFromScope(scope, hint, intent) {
  if (!scope || typeof scope !== "object") return null;

  const byAgent = scope.agents && hint.agent ? normalizeModelRef(scope.agents[hint.agent]) : null;
  if (byAgent) return byAgent;

  const byTeamRole = scope.team_roles && hint.team && hint.role
    ? normalizeModelRef(scope.team_roles[`${hint.team}:${hint.role}`])
    : null;
  if (byTeamRole) return byTeamRole;

  const byIntent = scope.intents && intent ? normalizeModelRef(scope.intents[intent]) : null;
  if (byIntent) return byIntent;

  const byTeam = scope.teams && hint.team ? normalizeModelRef(scope.teams[hint.team]) : null;
  if (byTeam) return byTeam;

  const byRole = scope.roles && hint.role ? normalizeModelRef(scope.roles[hint.role]) : null;
  if (byRole) return byRole;

  const bySystem = scope.systems && hint.system ? normalizeModelRef(scope.systems[hint.system]) : null;
  if (bySystem) return bySystem;

  return null;
}

function resolveFromRouteMap(routeMap, hint, text) {
  if (!routeMap || !hint) return null;
  const intent = hint.intent || inferIntent(text);
  const policy = hint.policy || "";

  if (policy && routeMap.policies && typeof routeMap.policies === "object") {
    const policyScope = routeMap.policies[policy];
    const fromPolicy = resolveFromScope(policyScope, hint, intent);
    if (fromPolicy) return fromPolicy;
  }

  const fromBase = resolveFromScope(routeMap, hint, intent);
  if (fromBase) return fromBase;

  const defaultPolicy = typeof routeMap.default_policy === "string" ? routeMap.default_policy.trim().toLowerCase() : "";
  if (defaultPolicy && defaultPolicy !== policy && routeMap.policies && typeof routeMap.policies === "object") {
    const defaultPolicyScope = routeMap.policies[defaultPolicy];
    const fromDefaultPolicy = resolveFromScope(defaultPolicyScope, hint, intent);
    if (fromDefaultPolicy) return fromDefaultPolicy;
  }

  return null;
}

module.exports = async function router(req, config) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  const systemBlocks = Array.isArray(req?.body?.system) ? req.body.system : [];

  const userText = messages.length > 0 ? readFirstTextBlock(messages[messages.length - 1]?.content) : "";
  const systemText = readSystemText(systemBlocks);
  const mergedText = `${systemText}\n${userText}`;

  // 1) Explicit subagent model override via tag.
  const explicit = normalizeModelRef(extractTag(mergedText, "CCR-SUBAGENT-MODEL"));
  if (explicit) return explicit;

  // 1.5) Explicit root/orchestrator model override via tag.
  const rootExplicit = normalizeModelRef(extractTag(mergedText, "CCR-ROOT-MODEL"));
  if (rootExplicit) return rootExplicit;

  // 2) Role/team/agent based routing via route map.
  const hint = parseRouteHint(mergedText) || parseRuntimeHint(mergedText);
  if (hint) {
    const routeMap = getRouteMap(config);
    const routed = resolveFromRouteMap(routeMap, hint, mergedText);
    if (routed) return routed;
  }

  // 3) Fallback to default CCR behavior.
  return null;
};
