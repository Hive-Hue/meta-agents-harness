import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const DEFAULT_MAX_LINES = 10000;
const NOTE_MAX_CHARS = 1000;
const DEFAULT_CATEGORY = "lessons";
const DEFAULT_ARRAY_SECTIONS = ["patterns", "workflows", "risks", "tools", "decisions", "lessons", "open_questions"];

export function normalizeAgentName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}

export function resolveRuntimeRoot(repoRoot) {
  const envPath = process.env.MULTI_HOME?.trim() || process.env.PI_MULTI_HOME?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(repoRoot, envPath);
  }
  return path.join(repoRoot, ".claude");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shortText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function toCategoryKey(category) {
  const normalized = String(category || DEFAULT_CATEGORY)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");

  if (!normalized) return DEFAULT_CATEGORY;
  if (normalized === "question") return "open_questions";
  if (normalized === "observation") return "observations";
  if (normalized.endsWith("s")) return normalized;
  return `${normalized}s`;
}

function lineCount(text) {
  if (!text) return 0;
  return String(text).split("\n").length;
}

function resolveFromRepo(repoRoot, filePath) {
  if (!filePath) return "";
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(repoRoot, filePath);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function safeReadYaml(filePath) {
  return YAML.parse(readFileSync(filePath, "utf-8"));
}

function listCrewConfigPaths(runtimeRoot) {
  const crewRoot = path.join(runtimeRoot, "crew");
  if (!existsSync(crewRoot)) return [];

  return readdirSync(crewRoot)
    .map((entry) => path.join(crewRoot, entry, "multi-team.yaml"))
    .filter((candidate) => existsSync(candidate) && statSync(candidate).isFile())
    .sort((a, b) => a.localeCompare(b));
}

function collectAgentRecords(configPath, doc) {
  const records = [];
  const systemName = doc?.name || "MultiTeam";

  if (doc?.orchestrator?.name) {
    records.push({
      name: doc.orchestrator.name,
      role: "orchestrator",
      team: "Global",
      system: systemName,
      expertise: doc.orchestrator.expertise || {},
      configPath,
    });
  }

  for (const team of doc?.teams || []) {
    if (team?.lead?.name) {
      records.push({
        name: team.lead.name,
        role: "lead",
        team: team.name || "Unknown",
        system: systemName,
        expertise: team.lead.expertise || {},
        configPath,
      });
    }

    for (const member of team?.members || []) {
      if (!member?.name) continue;
      records.push({
        name: member.name,
        role: "worker",
        team: team.name || "Unknown",
        system: systemName,
        expertise: member.expertise || {},
        configPath,
      });
    }
  }

  return records;
}

function resolveActiveCrewConfigPath(repoRoot, runtimeRoot) {
  const activeMetaPath = path.join(runtimeRoot, ".active-crew.json");
  if (!existsSync(activeMetaPath)) return "";

  try {
    const active = readJson(activeMetaPath);
    if (typeof active?.source_config !== "string" || !active.source_config.trim()) return "";
    const configPath = resolveFromRepo(repoRoot, active.source_config);
    return existsSync(configPath) ? configPath : "";
  } catch {
    return "";
  }
}

function resolveAgentRecord(repoRoot, runtimeRoot, agent) {
  const normalizedAgent = normalizeAgentName(agent);
  if (!normalizedAgent) return null;

  const activeConfigPath = resolveActiveCrewConfigPath(repoRoot, runtimeRoot);
  const matches = [];

  const visitConfig = (configPath) => {
    try {
      const doc = safeReadYaml(configPath);
      const records = collectAgentRecords(configPath, doc);
      for (const record of records) {
        if (normalizeAgentName(record.name) === normalizedAgent) {
          matches.push(record);
        }
      }
    } catch {
      // Ignore malformed configs here; runtime validation covers them elsewhere.
    }
  };

  if (activeConfigPath) {
    visitConfig(activeConfigPath);
    if (matches.length === 1) return matches[0];
  }

  for (const configPath of listCrewConfigPaths(runtimeRoot)) {
    if (configPath === activeConfigPath) continue;
    visitConfig(configPath);
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`agent "${agent}" is ambiguous across multiple crews; pass expertise_path explicitly`);
  }
  return null;
}

function buildBaseDocument({ agent, role, team, maxLines }) {
  return {
    agent: {
      name: agent,
      role: role || "worker",
      team: team || "Global",
    },
    meta: {
      version: 1,
      max_lines: maxLines || DEFAULT_MAX_LINES,
      last_updated: new Date().toISOString(),
    },
    patterns: [],
    workflows: [],
    risks: [],
    tools: [],
    decisions: [],
    lessons: [],
    open_questions: [],
  };
}

function trimDocument(doc) {
  const order = [
    "patterns",
    "workflows",
    "risks",
    "tools",
    "decisions",
    "lessons",
    "open_questions",
    "observations",
    ...Object.keys(doc).filter((key) => Array.isArray(doc[key]) && !DEFAULT_ARRAY_SECTIONS.includes(key) && key !== "observations"),
  ];

  let rendered = YAML.stringify(doc);
  while (lineCount(rendered) > Number(doc?.meta?.max_lines || DEFAULT_MAX_LINES)) {
    const section = order.find((key) => Array.isArray(doc[key]) && doc[key].length > 0);
    if (!section) break;
    doc[section].shift();
    rendered = YAML.stringify(doc);
  }

  return doc;
}

function isAllowedExplicitExpertisePath(runtimeRoot, expertisePath) {
  const normalizedRuntimeRoot = path.resolve(runtimeRoot);
  const normalizedExpertisePath = path.resolve(expertisePath);
  const relativePath = path.relative(normalizedRuntimeRoot, normalizedExpertisePath);
  if (!relativePath || relativePath.startsWith("..")) return false;
  return relativePath === path.join("expertise", path.basename(relativePath)) || relativePath.includes(`${path.sep}expertise${path.sep}`);
}

export function updateMentalModel(args, options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : process.cwd();
  const runtimeRoot = options.runtimeRoot ? path.resolve(options.runtimeRoot) : resolveRuntimeRoot(repoRoot);

  const note = shortText(args?.note, NOTE_MAX_CHARS);
  if (!note) {
    throw new Error("note is required");
  }

  const explicitPath = String(args?.expertise_path || "").trim();
  const agent = normalizeAgentName(args?.agent || "");
  if (!explicitPath && !agent) {
    throw new Error("agent or expertise_path is required");
  }

  const record = explicitPath ? null : resolveAgentRecord(repoRoot, runtimeRoot, agent);
  const expertisePath = explicitPath
    ? resolveFromRepo(repoRoot, explicitPath)
    : record?.expertise?.path
      ? resolveFromRepo(repoRoot, record.expertise.path)
      : path.join(runtimeRoot, "expertise", `${agent}-mental-model.yaml`);

  if (explicitPath && !isAllowedExplicitExpertisePath(runtimeRoot, expertisePath)) {
    throw new Error(`expertise_path must stay within ${path.relative(repoRoot, runtimeRoot) || runtimeRoot} expertise directories`);
  }

  if (record?.expertise && record.expertise.updatable === false) {
    throw new Error(`expertise for agent "${record.name}" is marked as non-updatable`);
  }

  mkdirSync(path.dirname(expertisePath), { recursive: true });

  const inferredRole = record?.role || String(args?.role || "worker").trim() || "worker";
  const inferredTeam = record?.team || String(args?.team || "Global").trim() || "Global";
  const initialMaxLines = Number(record?.expertise?.["max-lines"] || args?.max_lines || DEFAULT_MAX_LINES) || DEFAULT_MAX_LINES;

  let doc = buildBaseDocument({
    agent: agent || normalizeAgentName(path.basename(expertisePath, path.extname(expertisePath))),
    role: inferredRole,
    team: inferredTeam,
    maxLines: initialMaxLines,
  });

  if (existsSync(expertisePath)) {
    try {
      const parsed = safeReadYaml(expertisePath);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("expected a YAML object document");
      }
      doc = parsed;
    } catch (error) {
      throw new Error(`failed to parse expertise YAML at ${path.relative(repoRoot, expertisePath) || expertisePath}: ${error.message}`);
    }
  }

  if (!doc.agent || typeof doc.agent !== "object") {
    doc.agent = {};
  }
  if (!doc.meta || typeof doc.meta !== "object") {
    doc.meta = {};
  }

  doc.agent.name = doc.agent.name || agent || normalizeAgentName(path.basename(expertisePath, path.extname(expertisePath)));
  doc.agent.role = doc.agent.role || inferredRole;
  doc.agent.team = doc.agent.team || inferredTeam;
  doc.meta.version = Number(doc.meta.version || 1) || 1;
  doc.meta.max_lines = Number(doc.meta.max_lines || initialMaxLines) || DEFAULT_MAX_LINES;
  doc.meta.last_updated = new Date().toISOString();

  const category = toCategoryKey(args?.category);
  if (!Array.isArray(doc[category])) {
    doc[category] = [];
  }

  doc[category].push({
    date: today(),
    note,
  });

  trimDocument(doc);
  writeFileSync(expertisePath, YAML.stringify(doc), "utf-8");

  return {
    status: "ok",
    agent: doc.agent.name,
    role: doc.agent.role,
    team: doc.agent.team,
    path: expertisePath,
    category,
  };
}
