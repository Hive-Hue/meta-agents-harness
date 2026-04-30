import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import * as pty from "node-pty";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs");
const CONFIG_FILENAME = "meta-agents.yaml";
const ENV_FILENAME = ".env";

const PROVIDER_SECRET_SPECS = [
  { id: "minimax", label: "MiniMax", envVar: "MINIMAX_API_KEY" },
  { id: "zai", label: "ZAI", envVar: "ZAI_API_KEY" },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
  { id: "gemini", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
] as const;

// In-memory store for run sessions
const runSessions = new Map<string, {
  events: Array<{ event: string; at: string; details?: Record<string, unknown> }>;
  logs: Array<{ time: string; level: "INFO" | "WARN" | "ERROR"; msg: string }>;
  status: "running" | "completed" | "failed";
  process?: ReturnType<typeof spawn>;
  createdAt: number;
}>();

const INTERACTIVE_RESUME_RUNTIMES = new Set(["claude", "opencode", "pi", "hermes", "kilo", "openclaude"]);
const WEBUI_AUTH_COOKIE = "mah_webui_session";
const WEBUI_AUTH_MAX_AGE_SECONDS = 60 * 60 * 8;
const WEBUI_AUTH_USER = `${process.env.MAH_WEBUI_USER || "admin"}`;
const WEBUI_AUTH_PASSWORD = `${process.env.MAH_WEBUI_PASSWORD || "mah"}`;
const webUiSessions = new Set<string>();
const TASKS_STORAGE_DIR = path.join(".mah", "tasks");
const TASKS_FILE = "tasks.yaml";
const MISSIONS_FILE = "missions.yaml";

type StoredTask = {
  id: string;
  title: string;
  state: "backlog" | "ready" | "in_progress" | "blocked" | "review" | "done";
  priority: "high" | "medium" | "low";
  missionId: string;
  owner: string;
  runtime: string;
  dependencies: string[];
  estimate: string;
  confidence: number;
  risk: string;
  summary: string;
  lastUpdate: string;
  sessionId?: string;
  blockedReason?: string;
  rationale: string;
  command: string;
};

type StoredMission = {
  id: string;
  name: string;
  objective: string;
  status: "draft" | "active" | "at_risk" | "completed";
  dueWindow: string;
  risk: string;
  capacity: string;
  progress: number;
  health: string;
  successCriteria: string[];
  command: string;
};

type TerminalEvent =
  | { type: "output"; text: string }
  | { type: "exit"; code?: number | null }
  | { type: "error"; message: string };

const terminalSessions = new Map<string, {
  id: string;
  runtime: string;
  sessionId: string;
  pty: pty.IPty;
  clients: Set<import("http").ServerResponse>;
  closed: boolean;
  exitCode: number | null;
}>();

function sendTerminalSse(res: import("http").ServerResponse, payload: TerminalEvent): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastTerminalEvent(terminalId: string, payload: TerminalEvent): void {
  const terminal = terminalSessions.get(terminalId);
  if (!terminal) return;
  terminal.clients.forEach((client) => {
    sendTerminalSse(client, payload);
  });
}

function cleanupTerminalSession(terminalId: string): void {
  const terminal = terminalSessions.get(terminalId);
  if (!terminal) return;
  terminal.clients.forEach((client) => {
    if (!client.writableEnded) client.end();
  });
  terminal.clients.clear();
  terminalSessions.delete(terminalId);
}

function resolveWorkspaceRoot(req: import("http").IncomingMessage): string {
  const rawHeader = req.headers["x-mah-workspace-path"];
  const requestedPath = typeof rawHeader === "string" ? rawHeader.trim() : "";
  if (!requestedPath || requestedPath === ".") return repoRoot;
  return path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(repoRoot, requestedPath);
}

function parseCookies(req: import("http").IncomingMessage): Record<string, string> {
  const cookieHeader = `${req.headers.cookie || ""}`;
  if (!cookieHeader.trim()) return {};
  return cookieHeader.split(";").reduce<Record<string, string>>((acc, entry) => {
    const [rawKey, ...rawValue] = entry.trim().split("=");
    const key = decodeURIComponent(`${rawKey || ""}`.trim());
    const value = decodeURIComponent(rawValue.join("=").trim());
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function getAuthSessionId(req: import("http").IncomingMessage): string {
  const cookies = parseCookies(req);
  return `${cookies[WEBUI_AUTH_COOKIE] || ""}`.trim();
}

function isAuthenticated(req: import("http").IncomingMessage): boolean {
  const sessionId = getAuthSessionId(req);
  return Boolean(sessionId) && webUiSessions.has(sessionId);
}

function setAuthCookie(res: import("http").ServerResponse, sessionId: string): void {
  res.setHeader(
    "Set-Cookie",
    `${WEBUI_AUTH_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEBUI_AUTH_MAX_AGE_SECONDS}`,
  );
}

function clearAuthCookie(res: import("http").ServerResponse): void {
  res.setHeader("Set-Cookie", `${WEBUI_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function handleAuthApi(req: import("http").IncomingMessage, res: import("http").ServerResponse): void {
  res.setHeader("Content-Type", "application/json");
  const url = req.url ?? "";

  if (url === "/api/mah/auth/status" && req.method === "GET") {
    const authed = isAuthenticated(req);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, authenticated: authed, username: authed ? WEBUI_AUTH_USER : "" }));
    return;
  }

  if (url === "/api/mah/auth/logout" && req.method === "POST") {
    const sessionId = getAuthSessionId(req);
    if (sessionId) webUiSessions.delete(sessionId);
    clearAuthCookie(res);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === "/api/mah/auth/login" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
        const body = JSON.parse(raw) as { username?: string; password?: string };
        const username = `${body.username || ""}`.trim();
        const password = `${body.password || ""}`;
        const valid = username === WEBUI_AUTH_USER && password === WEBUI_AUTH_PASSWORD;
        if (!valid) {
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: "credenciais inválidas" }));
          return;
        }
        const sessionId = randomUUID();
        webUiSessions.add(sessionId);
        setAuthCookie(res, sessionId);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, authenticated: true, username: WEBUI_AUTH_USER }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
}

function getWorkspaceMetadata(workspaceRoot: string) {
  let exists = false;
  let isDirectory = false;
  try {
    const stat = statSync(workspaceRoot);
    exists = true;
    isDirectory = stat.isDirectory();
  } catch {
    // Keep default metadata for non-existing paths.
  }
  return { exists, isDirectory };
}

function hasWorkspaceConfig(workspaceRoot: string): boolean {
  return existsSync(path.join(workspaceRoot, CONFIG_FILENAME));
}

function readJsonBody<T>(req: import("http").IncomingMessage, callback: (body: T) => void, onError: (error: unknown) => void): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    try {
      const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
      callback(JSON.parse(raw) as T);
    } catch (error) {
      onError(error);
    }
  });
}

function getTasksStoragePaths(workspaceRoot: string) {
  const baseDir = path.join(workspaceRoot, TASKS_STORAGE_DIR);
  return {
    baseDir,
    tasksPath: path.join(baseDir, TASKS_FILE),
    missionsPath: path.join(baseDir, MISSIONS_FILE),
  };
}

function buildTaskCommand(task: Pick<StoredTask, "id" | "owner" | "runtime">): string {
  const crew = task.owner.includes("-") ? task.owner.split("-")[0] : task.owner;
  return `mah task run --id ${task.id} --crew ${crew} --runtime ${task.runtime}`;
}

function defaultTaskRecords(): StoredTask[] {
  return [
    {
      id: "TASK-118",
      title: "Prefetch audit context docs",
      state: "backlog",
      priority: "medium",
      missionId: "q4-audit",
      owner: "planning-lead",
      runtime: "openclaude",
      dependencies: [],
      estimate: "1h 20m",
      confidence: 78,
      risk: "Context gap",
      summary: "Load and normalize auth hardening references before execution begins.",
      lastUpdate: "8m ago",
      rationale: "Needed to reduce blocked risk before engineering tasks start.",
      command: buildTaskCommand({ id: "TASK-118", owner: "planning-lead", runtime: "openclaude" }),
    },
    {
      id: "TASK-126",
      title: "Generate runtime sync diff",
      state: "ready",
      priority: "medium",
      missionId: "q4-audit",
      owner: "ops-lead",
      runtime: "pi",
      dependencies: ["TASK-118"],
      estimate: "45m",
      confidence: 86,
      risk: "Low",
      summary: "Produce an artifact diff to validate the new runtime boundary.",
      lastUpdate: "4m ago",
      rationale: "Selected because ops-lead owns runtime projections and validation hooks.",
      command: buildTaskCommand({ id: "TASK-126", owner: "ops-lead", runtime: "pi" }),
    },
    {
      id: "TASK-142",
      title: "Verify auth middleware",
      state: "in_progress",
      priority: "high",
      missionId: "q4-audit",
      owner: "security-lead",
      runtime: "pi",
      dependencies: ["TASK-118", "TASK-126"],
      estimate: "2h 30m",
      confidence: 92,
      risk: "Dependency risk",
      summary: "Validate the new auth middleware path and update the hardened execution flow.",
      lastUpdate: "active now",
      sessionId: "ses_01j4f82x",
      rationale: "Assigned to security-lead due to strongest expertise match on auth verification and risk scoring.",
      command: buildTaskCommand({ id: "TASK-142", owner: "security-lead", runtime: "pi" }),
    },
    {
      id: "TASK-154",
      title: "Unlock blocked context dependency",
      state: "blocked",
      priority: "high",
      missionId: "q4-audit",
      owner: "context-lead",
      runtime: "openclaude",
      dependencies: ["TASK-118"],
      estimate: "55m",
      confidence: 63,
      risk: "High",
      summary: "Resolve missing legacy auth docs required by downstream execution.",
      lastUpdate: "12m ago",
      blockedReason: "Waiting for TASK-118 import and context validation",
      rationale: "Context-lead must approve document retrieval before downstream tasks can continue.",
      command: buildTaskCommand({ id: "TASK-154", owner: "context-lead", runtime: "openclaude" }),
    },
    {
      id: "TASK-160",
      title: "Validate artifact sync",
      state: "review",
      priority: "medium",
      missionId: "q4-audit",
      owner: "validation-lead",
      runtime: "hermes",
      dependencies: ["TASK-142"],
      estimate: "40m",
      confidence: 84,
      risk: "Validation required",
      summary: "Review generated artifacts, compare drift, and clear sync confidence.",
      lastUpdate: "17m ago",
      rationale: "Validation-lead owns final evidence review and release gating.",
      command: buildTaskCommand({ id: "TASK-160", owner: "validation-lead", runtime: "hermes" }),
    },
  ];
}

function defaultMissionRecords(): StoredMission[] {
  return [
    {
      id: "q4-audit",
      name: "Q4 Audit Hardening",
      objective: "Ship auth hardening, runtime sync validation, and context coverage for the audit window.",
      status: "active",
      dueWindow: "Oct 15 - Nov 20",
      risk: "Medium",
      capacity: "92%",
      progress: 68,
      health: "Stable with one critical bottleneck",
      successCriteria: [
        "Auth middleware verified across the active runtimes",
        "Critical path reduced below 8 nodes",
        "Context gaps closed before final hardening run",
      ],
      command: "mah mission status --id q4-audit",
    },
    {
      id: "infra-sync",
      name: "Infrastructure Sync",
      objective: "Normalize generated runtime artifacts before the next operator rollout.",
      status: "draft",
      dueWindow: "Nov 21 - Nov 29",
      risk: "Low",
      capacity: "44%",
      progress: 12,
      health: "Scoping",
      successCriteria: ["Diff reviewed", "Sync policy agreed"],
      command: "mah mission status --id infra-sync",
    },
    {
      id: "migration",
      name: "System Migration",
      objective: "Move legacy mission routing to the new governed runtime core.",
      status: "at_risk",
      dueWindow: "Nov 04 - Dec 02",
      risk: "High",
      capacity: "96%",
      progress: 54,
      health: "Blocked by shared runtime constraint",
      successCriteria: ["Parallel path restored", "Fallback policy tested"],
      command: "mah mission status --id migration",
    },
  ];
}

function ensureTasksStorage(workspaceRoot: string): { tasksPath: string; missionsPath: string } {
  const { baseDir, tasksPath, missionsPath } = getTasksStoragePaths(workspaceRoot);
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  if (!existsSync(tasksPath)) writeFileSync(tasksPath, yaml.dump({ tasks: defaultTaskRecords() }, { lineWidth: -1, quotingType: "'" }), "utf-8");
  if (!existsSync(missionsPath)) writeFileSync(missionsPath, yaml.dump({ missions: defaultMissionRecords() }, { lineWidth: -1, quotingType: "'" }), "utf-8");
  return { tasksPath, missionsPath };
}

function readTasksStore(workspaceRoot: string): { tasks: StoredTask[]; missions: StoredMission[] } {
  const { tasksPath, missionsPath } = ensureTasksStorage(workspaceRoot);
  const rawTasks = yaml.load(readFileSync(tasksPath, "utf-8")) as { tasks?: StoredTask[] } | null;
  const rawMissions = yaml.load(readFileSync(missionsPath, "utf-8")) as { missions?: StoredMission[] } | null;
  return {
    tasks: Array.isArray(rawTasks?.tasks) ? rawTasks.tasks : [],
    missions: Array.isArray(rawMissions?.missions) ? rawMissions.missions : [],
  };
}

function writeTasks(workspaceRoot: string, tasks: StoredTask[]): void {
  const { tasksPath } = ensureTasksStorage(workspaceRoot);
  writeFileSync(tasksPath, yaml.dump({ tasks }, { lineWidth: -1, quotingType: "'" }), "utf-8");
}

function writeMissions(workspaceRoot: string, missions: StoredMission[]): void {
  const { missionsPath } = ensureTasksStorage(workspaceRoot);
  writeFileSync(missionsPath, yaml.dump({ missions }, { lineWidth: -1, quotingType: "'" }), "utf-8");
}

function validateWorkspaceForTasks(res: import("http").ServerResponse, workspaceRoot: string): boolean {
  const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
  if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
    return false;
  }
  return true;
}

function nextTaskId(tasks: StoredTask[]): string {
  const next = tasks.reduce((max, task) => {
    const value = Number.parseInt(task.id.replace(/^TASK-/, ""), 10);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 100);
  return `TASK-${next + 1}`;
}

function createTaskRecord(input: Partial<StoredTask>, tasks: StoredTask[]): StoredTask {
  const id = `${input.id || nextTaskId(tasks)}`.trim();
  const owner = `${input.owner || "planning-lead"}`.trim();
  const runtime = `${input.runtime || "openclaude"}`.trim();
  return {
    id,
    title: `${input.title || "New task"}`.trim(),
    state: input.state || "backlog",
    priority: input.priority || "medium",
    missionId: `${input.missionId || "q4-audit"}`.trim(),
    owner,
    runtime,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map((item) => `${item}`) : [],
    estimate: `${input.estimate || "45m"}`.trim(),
    confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 75,
    risk: `${input.risk || "Low"}`.trim(),
    summary: `${input.summary || "Task created from the Tasks workspace."}`.trim(),
    lastUpdate: "just now",
    sessionId: input.sessionId ? `${input.sessionId}` : undefined,
    blockedReason: input.blockedReason ? `${input.blockedReason}` : undefined,
    rationale: `${input.rationale || "Created from the Tasks page for operator planning."}`.trim(),
    command: buildTaskCommand({ id, owner, runtime }),
  };
}

function createMissionRecord(input: Partial<StoredMission>, missions: StoredMission[]): StoredMission {
  const baseId = `${input.id || input.name || `mission-${missions.length + 1}`}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: baseId,
    name: `${input.name || "New Mission"}`.trim(),
    objective: `${input.objective || "Mission objective pending definition."}`.trim(),
    status: input.status || "draft",
    dueWindow: `${input.dueWindow || "TBD"}`.trim(),
    risk: `${input.risk || "Low"}`.trim(),
    capacity: `${input.capacity || "0%"}`.trim(),
    progress: Number.isFinite(input.progress) ? Number(input.progress) : 0,
    health: `${input.health || "Scoping"}`.trim(),
    successCriteria: Array.isArray(input.successCriteria) ? input.successCriteria.map((item) => `${item}`) : ["Define scope"],
    command: `mah mission status --id ${baseId}`,
  };
}

function handleConfigApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  const workspaceRoot = resolveWorkspaceRoot(req);
  const configPath = path.join(workspaceRoot, CONFIG_FILENAME);
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET") {
    try {
      if (!existsSync(configPath)) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, config: null }));
        return;
      }
      const raw = readFileSync(configPath, "utf-8");
      const config = yaml.load(raw) as Record<string, unknown>;
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, config }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (req.method === "PUT") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
        if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
          return;
        }

        const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
        const body = JSON.parse(raw) as { config?: unknown };
        if (!body || typeof body.config !== "object" || body.config === null) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "request body must contain a 'config' object" }));
          return;
        }
        const serialized = yaml.dump(body.config, { lineWidth: -1, quotingType: "'" });
        writeFileSync(configPath, serialized, "utf-8");
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
}

function parseDotEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function redactSensitiveArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--api-key" || token === "--ai-api-key") {
      out.push(token);
      out.push("***");
      i += 1;
      continue;
    }
    if (token.startsWith("--api-key=") || token.startsWith("--ai-api-key=")) {
      out.push(`${token.split("=")[0]}=***`);
      continue;
    }
    out.push(token);
  }
  return out;
}

function escapeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function upsertEnvVar(content: string, envVar: string, value: string): string {
  const lines = content ? content.split(/\r?\n/) : [];
  let replaced = false;
  const nextLines = lines.filter((line) => {
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return true;
    if (match[1] !== envVar) return true;
    if (!value) {
      replaced = true;
      return false;
    }
    replaced = true;
    return true;
  }).map((line) => {
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || match[1] !== envVar) return line;
    return `${envVar}=${escapeEnvValue(value)}`;
  });

  if (!replaced && value) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim()) nextLines.push("");
    nextLines.push(`${envVar}=${escapeEnvValue(value)}`);
  }

  return `${nextLines.join("\n")}\n`;
}

function maskSecret(value: string): string {
  const normalized = `${value || ""}`.trim();
  if (!normalized) return "";
  const suffix = normalized.slice(-4);
  return `••••••••${suffix}`;
}

function handleSecretsApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  const workspaceRoot = resolveWorkspaceRoot(req);
  const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
  if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
    return;
  }
  if (!hasWorkspaceConfig(workspaceRoot)) {
    res.statusCode = 409;
    res.end(JSON.stringify({ ok: false, error: `workspace config not found at ${workspaceRoot}/${CONFIG_FILENAME}` }));
    return;
  }
  const envPath = path.join(workspaceRoot, ENV_FILENAME);
  const rawEnv = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const parsed = parseDotEnvContent(rawEnv);

  if (req.method === "GET") {
    const providers = PROVIDER_SECRET_SPECS.map((spec) => {
      const value = `${parsed[spec.envVar] || process.env[spec.envVar] || ""}`.trim();
      const configured = Boolean(value);
      return {
        id: spec.id,
        provider: spec.label,
        envVar: spec.envVar,
        configured,
        masked: configured ? maskSecret(value) : "Not configured",
        status: configured ? "Configured" : "Missing",
      };
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, providers }));
    return;
  }

  if (req.method === "PUT") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const bodyRaw = Buffer.concat(chunks).toString("utf-8") || "{}";
        const body = JSON.parse(bodyRaw) as { providerId?: string; apiKey?: string };
        const providerId = `${body.providerId || ""}`.trim();
        const apiKey = `${body.apiKey || ""}`.trim();
        const spec = PROVIDER_SECRET_SPECS.find((item) => item.id === providerId);
        if (!spec) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "invalid providerId" }));
          return;
        }
        const updatedContent = upsertEnvVar(rawEnv, spec.envVar, apiKey);
        writeFileSync(envPath, updatedContent, "utf-8");
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, providerId: spec.id, configured: Boolean(apiKey) }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
}

function handleExpertiseProposalsApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }

  try {
    const workspaceRoot = resolveWorkspaceRoot(req);
    const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
    if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
      return;
    }

    const proposalsDir = path.join(workspaceRoot, ".mah", "expertise", "proposals");
    if (!existsSync(proposalsDir)) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, proposals: [] }));
      return;
    }

    const files = readdirSync(proposalsDir).filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
    const proposals = files.flatMap((file) => {
      try {
        const raw = readFileSync(path.join(proposalsDir, file), "utf-8");
        const doc = yaml.load(raw);
        if (!doc || typeof doc !== "object") return [];
        const d = doc as Record<string, unknown>;
        return [{
          id: typeof d.id === "string" && d.id ? d.id : file,
          file_path: `.mah/expertise/proposals/${file}`,
          target_expertise_id: typeof d.target_expertise_id === "string" ? d.target_expertise_id : "",
          summary: typeof d.summary === "string" ? d.summary : "",
          rationale: typeof d.rationale === "string" ? d.rationale : "",
          generated_by: (d.generated_by && typeof d.generated_by === "object") ? d.generated_by : { actor: "unknown", role: "" },
          reviewers: Array.isArray(d.reviewers) ? d.reviewers : [],
          status: typeof d.status === "string" ? d.status : "pending",
          created_at: typeof d.created_at === "string" ? d.created_at : "",
          proposed_changes: (d.proposed_changes && typeof d.proposed_changes === "object") ? d.proposed_changes : {},
          target_snapshot: (d.target_snapshot && typeof d.target_snapshot === "object")
            ? d.target_snapshot
            : { lifecycle: "", validation_status: "", confidence: null },
        }];
      } catch {
        return [];
      }
    });

    proposals.sort((a, b) => `${b.created_at || ""}`.localeCompare(`${a.created_at || ""}`));
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, proposals }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

function handleTasksApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  const workspaceRoot = resolveWorkspaceRoot(req);
  if (!validateWorkspaceForTasks(res, workspaceRoot)) return;

  if (req.method === "GET") {
    try {
      const { tasks } = readTasksStore(workspaceRoot);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, tasks }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (req.method === "POST") {
    readJsonBody<{ task?: Partial<StoredTask> }>(req, (body) => {
      try {
        const store = readTasksStore(workspaceRoot);
        const task = createTaskRecord(body.task || {}, store.tasks);
        const tasks = [task, ...store.tasks];
        writeTasks(workspaceRoot, tasks);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, task, tasks }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }, (error) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    });
    return;
  }

  const patchMatch = (req.url ?? "").match(/^\/api\/mah\/tasks\/([^/?]+)$/);
  if (req.method === "PATCH" && patchMatch) {
    const taskId = decodeURIComponent(patchMatch[1]);
    readJsonBody<{ updates?: Partial<StoredTask> }>(req, (body) => {
      try {
        const store = readTasksStore(workspaceRoot);
        const tasks = store.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const owner = `${body.updates?.owner || task.owner}`.trim();
          const runtime = `${body.updates?.runtime || task.runtime}`.trim();
          return {
            ...task,
            ...body.updates,
            owner,
            runtime,
            dependencies: Array.isArray(body.updates?.dependencies) ? body.updates.dependencies.map((item) => `${item}`) : task.dependencies,
            command: buildTaskCommand({ id: task.id, owner, runtime }),
            lastUpdate: "just now",
          };
        });
        const updated = tasks.find((task) => task.id === taskId);
        if (!updated) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, error: "task not found" }));
          return;
        }
        writeTasks(workspaceRoot, tasks);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, task: updated, tasks }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }, (error) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    });
    return;
  }

  const runMatch = (req.url ?? "").match(/^\/api\/mah\/tasks\/([^/?]+)\/run$/);
  if (req.method === "POST" && runMatch) {
    try {
      const taskId = decodeURIComponent(runMatch[1]);
      const store = readTasksStore(workspaceRoot);
      const now = new Date().toISOString();
      let updatedTask: StoredTask | null = null;
      const tasks = store.tasks.map((task) => {
        if (task.id !== taskId) return task;
        updatedTask = {
          ...task,
          state: "in_progress",
          sessionId: task.sessionId || `ses_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
          lastUpdate: now,
        };
        return updatedTask;
      });
      if (!updatedTask) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "task not found" }));
        return;
      }
      const finalTask = updatedTask as StoredTask;
      writeTasks(workspaceRoot, tasks);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, task: finalTask, command: finalTask.command }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
}

function handleMissionsApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  const workspaceRoot = resolveWorkspaceRoot(req);
  if (!validateWorkspaceForTasks(res, workspaceRoot)) return;

  if (req.method === "GET") {
    try {
      const { missions } = readTasksStore(workspaceRoot);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, missions }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/mah/missions") {
    readJsonBody<{ mission?: Partial<StoredMission> }>(req, (body) => {
      try {
        const store = readTasksStore(workspaceRoot);
        const mission = createMissionRecord(body.mission || {}, store.missions);
        const missions = [mission, ...store.missions];
        writeMissions(workspaceRoot, missions);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, mission, missions }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }, (error) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    });
    return;
  }

  const patchMatch = (req.url ?? "").match(/^\/api\/mah\/missions\/([^/?]+)$/);
  if (req.method === "PATCH" && patchMatch) {
    const missionId = decodeURIComponent(patchMatch[1]);
    readJsonBody<{ updates?: Partial<StoredMission> }>(req, (body) => {
      try {
        const store = readTasksStore(workspaceRoot);
        const missions = store.missions.map((mission) => mission.id === missionId ? { ...mission, ...body.updates } : mission);
        const updated = missions.find((mission) => mission.id === missionId);
        if (!updated) {
          res.statusCode = 404;
          res.end(JSON.stringify({ ok: false, error: "mission not found" }));
          return;
        }
        writeMissions(workspaceRoot, missions);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, mission: updated, missions }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }, (error) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    });
    return;
  }

  const commitMatch = (req.url ?? "").match(/^\/api\/mah\/missions\/([^/?]+)\/commit-scope$/);
  if (req.method === "POST" && commitMatch) {
    try {
      const missionId = decodeURIComponent(commitMatch[1]);
      const store = readTasksStore(workspaceRoot);
      const missions = store.missions.map((mission) => mission.id === missionId
        ? { ...mission, status: "active" as const, health: "Scope committed", progress: Math.max(mission.progress, 5) }
        : mission);
      const updated = missions.find((mission) => mission.id === missionId);
      if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "mission not found" }));
        return;
      }
      writeMissions(workspaceRoot, missions);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, mission: updated, missions }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  const replanMatch = (req.url ?? "").match(/^\/api\/mah\/missions\/([^/?]+)\/replan$/);
  if (req.method === "POST" && replanMatch) {
    try {
      const missionId = decodeURIComponent(replanMatch[1]);
      const store = readTasksStore(workspaceRoot);
      const tasks = store.tasks.map((task) => {
        if (task.missionId !== missionId) return task;
        if (task.id === "TASK-142") {
          return {
            ...task,
            owner: "eng-lead",
            runtime: "pi/local",
            confidence: Math.min(task.confidence + 3, 99),
            rationale: "Replanned to eng-lead after expertise rebalance and lower queue delay on pi/local.",
            command: buildTaskCommand({ id: task.id, owner: "eng-lead", runtime: "pi/local" }),
            lastUpdate: "replanned now",
          };
        }
        if (task.id === "TASK-154") {
          return {
            ...task,
            state: "ready" as const,
            blockedReason: undefined,
            rationale: "Context prefetch resolved the bottleneck and unlocked downstream execution.",
            lastUpdate: "replanned now",
          };
        }
        return task;
      });
      const missions = store.missions.map((mission) => mission.id === missionId
        ? { ...mission, risk: "Lower", health: "Replanned to reduce bottleneck", progress: Math.max(mission.progress, 72) }
        : mission);
      const updatedMission = missions.find((mission) => mission.id === missionId);
      if (!updatedMission) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "mission not found" }));
        return;
      }
      writeTasks(workspaceRoot, tasks);
      writeMissions(workspaceRoot, missions);
      res.statusCode = 200;
      res.end(JSON.stringify({
        ok: true,
        mission: updatedMission,
        missions,
        tasks,
        summary: "Agentic replan moved TASK-142 to eng-lead on pi/local and unlocked TASK-154 via context prefetch.",
      }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
}

function handleExecApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    try {
      const workspaceRoot = resolveWorkspaceRoot(req);
      const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
      if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
        return;
      }
      if (!hasWorkspaceConfig(workspaceRoot)) {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: `workspace config not found at ${workspaceRoot}/${CONFIG_FILENAME}` }));
        return;
      }

      const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
      const body = JSON.parse(raw) as { args?: string[] };
      const args = Array.isArray(body?.args) ? body.args.filter((item) => typeof item === "string" && item.trim()) : [];
      const redactedArgs = redactSensitiveArgs(args);

      const ALLOWED_COMMANDS = ["skills", "sessions", "expertise", "context"];
      if (args.length === 0 || !ALLOWED_COMMANDS.includes(args[0])) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "only 'mah skills/sessions/expertise/context ...' commands are allowed" }));
        return;
      }

      const envPath = path.join(workspaceRoot, ENV_FILENAME);
      const rawEnv = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
      const workspaceEnv = parseDotEnvContent(rawEnv);

      const child = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: workspaceRoot,
        env: { ...process.env, ...workspaceEnv },
        encoding: "utf-8",
        timeout: 20000,
      });

      const status = typeof child.status === "number" ? child.status : 1;
      res.statusCode = status === 0 ? 200 : 500;
      res.end(
        JSON.stringify({
          ok: status === 0,
          status,
          command: `mah ${redactedArgs.join(" ")}`,
          stdout: child.stdout || "",
          stderr: child.stderr || "",
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

function handleWorkspaceApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  const workspaceRoot = resolveWorkspaceRoot(req);
  const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
  const result: Record<string, unknown> = {
    path: workspaceRoot,
    name: path.basename(workspaceRoot) || path.basename(repoRoot),
    gitBranch: "",
    gitDirty: false,
    gitClean: true,
    exists: workspaceMeta.exists,
    isDirectory: workspaceMeta.isDirectory,
    configExists: existsSync(path.join(workspaceRoot, CONFIG_FILENAME)),
  };
  try {
    if (workspaceMeta.exists && workspaceMeta.isDirectory) {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspaceRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      (result as Record<string, unknown>).gitBranch = branch;
      const status = execSync("git status --porcelain", {
        cwd: workspaceRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      (result as Record<string, unknown>).gitDirty = status.length > 0;
      (result as Record<string, unknown>).gitClean = status.length === 0;
    }
  } catch { /* not a git repo */ }
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, workspace: result }));
}

function handleRunStart(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: "method not allowed" })); return; }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
      const { task = "", crew = "dev", runtime = ".pi/" } = JSON.parse(raw);
      if (!task.trim()) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "no task" })); return; }

      const workspaceRoot = resolveWorkspaceRoot(req);
      const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
      if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
        return;
      }
      if (!hasWorkspaceConfig(workspaceRoot)) {
        res.statusCode = 409;
        res.end(JSON.stringify({ ok: false, error: `workspace config not found at ${workspaceRoot}/${CONFIG_FILENAME}` }));
        return;
      }

      const sessionId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tp = () => new Date().toLocaleTimeString([], { hour12: false });
      runSessions.set(sessionId, {
        events: [{ event: "queued", at: new Date().toISOString(), details: { label: "Queued", desc: "Task received" } }],
        logs: [{ time: tp(), level: "INFO", msg: "Starting run..." }],
        status: "running",
        createdAt: Date.now(),
      });

      const envPath = path.join(workspaceRoot, ENV_FILENAME);
      const rawEnv = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
      const workspaceEnv = parseDotEnvContent(rawEnv);
      const child = spawn(process.execPath, [cliPath, "run", "--task", task, "--crew", crew, "--runtime", runtime, "--headless"], {
        cwd: workspaceRoot,
        env: { ...process.env, ...workspaceEnv },
      });

      const session = runSessions.get(sessionId)!;
      session.process = child;

      child.stdout?.on("data", (d: Buffer) => {
        const sess = runSessions.get(sessionId);
        if (!sess) return;
        const lines = d.toString("utf-8").split("\n").filter(Boolean);
        for (const line of lines) {
          if (line.includes("Lifecycle:") || line.startsWith("lifecycle")) {
            sess.events = sess.events.map(e => ({ ...e, event: e.event === "queued" ? "running" : e.event }));
            sess.events.push({ event: "running", at: new Date().toISOString(), details: { label: "Running", desc: line.slice(0, 100) } });
          }
          sess.logs.push({ time: tp(), level: "INFO", msg: line.slice(0, 500) });
        }
        runSessions.set(sessionId, sess);
      });

      child.stderr?.on("data", (d: Buffer) => {
        const sess = runSessions.get(sessionId);
        if (!sess) return;
        const lines = d.toString("utf-8").split("\n").filter(Boolean);
        for (const line of lines) if (line.trim()) sess.logs.push({ time: tp(), level: "ERROR", msg: line.slice(0, 500) });
        runSessions.set(sessionId, sess);
      });

      child.on("close", (code) => {
        const sess = runSessions.get(sessionId);
        if (!sess) return;
        sess.status = code === 0 ? "completed" : "failed";
        sess.events.push({ event: code === 0 ? "completed" : "failed", at: new Date().toISOString(), details: { label: code === 0 ? "Completed" : "Failed", desc: `Exit ${code}` } });
        runSessions.set(sessionId, sess);
      });

      child.on("error", (e) => {
        const sess = runSessions.get(sessionId);
        if (!sess) return;
        sess.status = "failed";
        sess.events.push({ event: "failed", at: new Date().toISOString(), details: { label: "Error", desc: e.message } });
        sess.logs.push({ time: tp(), level: "ERROR", msg: e.message });
        runSessions.set(sessionId, sess);
      });

      setTimeout(() => { runSessions.delete(sessionId); }, 10 * 60 * 1000);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, sessionId, status: "running" }));
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })); }
  });
}

function handleRunStatus(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: "method not allowed" })); return; }

  const match = (req.url ?? "").match(/^\/api\/mah\/run-status\/([^?]+)/);
  if (!match) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "missing sessionId" })); return; }

  const session = runSessions.get(match[1]);
  if (!session) { res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: "session not found" })); return; }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, sessionId: match[1], status: session.status, events: session.events, logs: session.logs, elapsedMs: Date.now() - session.createdAt }));
}

function handleTerminalOpen(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    try {
      const bodyRaw = Buffer.concat(chunks).toString("utf-8") || "{}";
      const body = JSON.parse(bodyRaw) as { sessionId?: string; runtime?: string };
      const runtime = `${body.runtime || ""}`.trim().toLowerCase();
      const sessionId = `${body.sessionId || ""}`.trim();

      if (!runtime || !sessionId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "runtime and sessionId are required" }));
        return;
      }
      if (!INTERACTIVE_RESUME_RUNTIMES.has(runtime)) {
        res.statusCode = 400;
        res.end(JSON.stringify({
          ok: false,
          error: `interactive browser console for resume is enabled only for: ${Array.from(INTERACTIVE_RESUME_RUNTIMES).join(", ")}`,
        }));
        return;
      }

      const workspaceRoot = resolveWorkspaceRoot(req);
      const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
      if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
        return;
      }

      const envPath = path.join(workspaceRoot, ENV_FILENAME);
      const rawEnv = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
      const workspaceEnv = parseDotEnvContent(rawEnv);

      const terminalId = `terminal-${randomUUID()}`;
      const resumeArgs = [cliPath, "sessions", "resume", sessionId];
      if (runtime === "claude") {
        resumeArgs.push("--policy", "enforce-domain");
      }

      const terminal = pty.spawn(
        process.execPath,
        resumeArgs,
        {
          cwd: workspaceRoot,
          env: { ...process.env, ...workspaceEnv } as Record<string, string>,
          cols: 120,
          rows: 40,
          name: "xterm-256color",
        },
      );

      terminalSessions.set(terminalId, {
        id: terminalId,
        runtime,
        sessionId,
        pty: terminal,
        clients: new Set(),
        closed: false,
        exitCode: null,
      });

      terminal.onData((data) => {
        broadcastTerminalEvent(terminalId, { type: "output", text: data });
      });
      terminal.onExit(({ exitCode }) => {
        const session = terminalSessions.get(terminalId);
        if (!session) return;
        session.closed = true;
        session.exitCode = typeof exitCode === "number" ? exitCode : null;
        broadcastTerminalEvent(terminalId, { type: "exit", code: session.exitCode });
        setTimeout(() => cleanupTerminalSession(terminalId), 10_000);
      });

      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, terminalId }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function handleTerminalOpenShell(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }

  try {
    const workspaceRoot = resolveWorkspaceRoot(req);
    const workspaceMeta = getWorkspaceMetadata(workspaceRoot);
    if (!workspaceMeta.exists || !workspaceMeta.isDirectory) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: `workspace path is invalid: ${workspaceRoot}` }));
      return;
    }

    const envPath = path.join(workspaceRoot, ENV_FILENAME);
    const rawEnv = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
    const workspaceEnv = parseDotEnvContent(rawEnv);
    const terminalId = `terminal-${randomUUID()}`;
    const shellBin = `${process.env.SHELL || ""}`.trim() || "bash";

    const terminal = pty.spawn(
      shellBin,
      [],
      {
        cwd: workspaceRoot,
        env: { ...process.env, ...workspaceEnv } as Record<string, string>,
        cols: 120,
        rows: 40,
        name: "xterm-256color",
      },
    );

    terminalSessions.set(terminalId, {
      id: terminalId,
      runtime: "shell",
      sessionId: "workspace",
      pty: terminal,
      clients: new Set(),
      closed: false,
      exitCode: null,
    });

    terminal.onData((data) => {
      broadcastTerminalEvent(terminalId, { type: "output", text: data });
    });
    terminal.onExit(({ exitCode }) => {
      const session = terminalSessions.get(terminalId);
      if (!session) return;
      session.closed = true;
      session.exitCode = typeof exitCode === "number" ? exitCode : null;
      broadcastTerminalEvent(terminalId, { type: "exit", code: session.exitCode });
      setTimeout(() => cleanupTerminalSession(terminalId), 10_000);
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, terminalId, runtime: "shell", sessionId: "workspace" }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

function handleTerminalStream(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }
  const match = (req.url ?? "").match(/^\/api\/mah\/terminal\/stream\/([^/?]+)/);
  if (!match) {
    res.statusCode = 400;
    res.end("missing terminal id");
    return;
  }
  const terminalId = decodeURIComponent(match[1]);
  const terminal = terminalSessions.get(terminalId);
  if (!terminal) {
    res.statusCode = 404;
    res.end("terminal not found");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write(": connected\n\n");

  terminal.clients.add(res);
  if (terminal.closed) {
    sendTerminalSse(res, { type: "exit", code: terminal.exitCode });
  }

  req.on("close", () => {
    terminal.clients.delete(res);
  });
}

function handleTerminalInput(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }
  const match = (req.url ?? "").match(/^\/api\/mah\/terminal\/input\/([^/?]+)/);
  if (!match) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "missing terminal id" }));
    return;
  }
  const terminalId = decodeURIComponent(match[1]);
  const terminal = terminalSessions.get(terminalId);
  if (!terminal) {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "terminal not found" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    try {
      const bodyRaw = Buffer.concat(chunks).toString("utf-8") || "{}";
      const body = JSON.parse(bodyRaw) as { data?: string };
      const data = typeof body.data === "string" ? body.data : "";
      if (data) terminal.pty.write(data);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function handleTerminalResize(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }
  const match = (req.url ?? "").match(/^\/api\/mah\/terminal\/resize\/([^/?]+)/);
  if (!match) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "missing terminal id" }));
    return;
  }
  const terminalId = decodeURIComponent(match[1]);
  const terminal = terminalSessions.get(terminalId);
  if (!terminal) {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "terminal not found" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    try {
      const bodyRaw = Buffer.concat(chunks).toString("utf-8") || "{}";
      const body = JSON.parse(bodyRaw) as { cols?: number; rows?: number };
      const cols = Number.isFinite(body.cols) ? Math.max(1, Number(body.cols)) : 120;
      const rows = Number.isFinite(body.rows) ? Math.max(1, Number(body.rows)) : 40;
      terminal.pty.resize(cols, rows);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function handleTerminalClose(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }
  const match = (req.url ?? "").match(/^\/api\/mah\/terminal\/close\/([^/?]+)/);
  if (!match) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "missing terminal id" }));
    return;
  }
  const terminalId = decodeURIComponent(match[1]);
  const terminal = terminalSessions.get(terminalId);
  if (!terminal) {
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: "terminal not found" }));
    return;
  }
  try {
    terminal.pty.kill();
    cleanupTerminalSession(terminalId);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

function mahApiMiddleware() {
  return {
    name: "mah-api-middleware",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";

        if (url.startsWith("/api/mah/auth/")) {
          handleAuthApi(req, res);
          return;
        }

        if (url.startsWith("/api/mah/") && !isAuthenticated(req)) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "não autenticado" }));
          return;
        }

        if (url === "/api/mah/workspace") {
          handleWorkspaceApi(req, res);
          return;
        }

        if (url === "/api/mah/config") {
          handleConfigApi(req, res);
          return;
        }

        if (url === "/api/mah/exec") {
          handleExecApi(req, res);
          return;
        }

        if (url === "/api/mah/secrets") {
          handleSecretsApi(req, res);
          return;
        }
        if (url === "/api/mah/expertise-proposals") {
          handleExpertiseProposalsApi(req, res);
          return;
        }
        if (url === "/api/mah/tasks" || /^\/api\/mah\/tasks\/[^/]+(?:\/run)?$/.test(url)) {
          handleTasksApi(req, res);
          return;
        }
        if (url === "/api/mah/missions" || /^\/api\/mah\/missions\/[^/]+(?:\/(?:commit-scope|replan))?$/.test(url)) {
          handleMissionsApi(req, res);
          return;
        }

        if (url === "/api/mah/run-start") { handleRunStart(req, res); return; }
        if (url.startsWith("/api/mah/run-status/")) { handleRunStatus(req, res); return; }
        if (url === "/api/mah/terminal/open") { handleTerminalOpen(req, res); return; }
        if (url === "/api/mah/terminal/open-shell") { handleTerminalOpenShell(req, res); return; }
        if (url.startsWith("/api/mah/terminal/stream/")) { handleTerminalStream(req, res); return; }
        if (url.startsWith("/api/mah/terminal/input/")) { handleTerminalInput(req, res); return; }
        if (url.startsWith("/api/mah/terminal/resize/")) { handleTerminalResize(req, res); return; }
        if (url.startsWith("/api/mah/terminal/close/")) { handleTerminalClose(req, res); return; }

        if (url.startsWith("/api/mah/run-status/")) { handleRunStatus(req, res); return; }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [mahApiMiddleware(), react()],
});
