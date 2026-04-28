import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
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

function resolveWorkspaceRoot(req: import("http").IncomingMessage): string {
  const rawHeader = req.headers["x-mah-workspace-path"];
  const requestedPath = typeof rawHeader === "string" ? rawHeader.trim() : "";
  if (!requestedPath || requestedPath === ".") return repoRoot;
  return path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(repoRoot, requestedPath);
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

function mahApiMiddleware() {
  return {
    name: "mah-api-middleware",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";

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

        if (url === "/api/mah/run-start") { handleRunStart(req, res); return; }
        if (url.startsWith("/api/mah/run-status/")) { handleRunStatus(req, res); return; }

        if (url.startsWith("/api/mah/run-status/")) { handleRunStatus(req, res); return; }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [mahApiMiddleware(), react()],
});
