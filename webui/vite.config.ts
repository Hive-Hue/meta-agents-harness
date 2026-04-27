import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs");

// In-memory store for run sessions
const runSessions = new Map<string, {
  events: Array<{ event: string; at: string; details?: Record<string, unknown> }>;
  logs: Array<{ time: string; level: "INFO" | "WARN" | "ERROR"; msg: string }>;
  status: "running" | "completed" | "failed";
  process?: ReturnType<typeof spawn>;
  createdAt: number;
}>();

function handleConfigApi(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  const configPath = path.join(repoRoot, "meta-agents.yaml");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET") {
    try {
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
      const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
      const body = JSON.parse(raw) as { args?: string[] };
      const args = Array.isArray(body?.args) ? body.args.filter((item) => typeof item === "string" && item.trim()) : [];

      const ALLOWED_COMMANDS = ["skills", "sessions"];
      if (args.length === 0 || !ALLOWED_COMMANDS.includes(args[0])) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "only 'mah skills/sessions ...' commands are allowed" }));
        return;
      }

      const child = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: repoRoot,
        env: process.env,
        encoding: "utf-8",
        timeout: 20000,
      });

      const status = typeof child.status === "number" ? child.status : 1;
      res.statusCode = status === 0 ? 200 : 500;
      res.end(
        JSON.stringify({
          ok: status === 0,
          status,
          command: `mah ${args.join(" ")}`,
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

function handleWorkspaceApi(_req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  const result: Record<string, unknown> = {
    path: repoRoot,
    name: path.basename(repoRoot),
    gitBranch: "",
    gitDirty: false,
    gitClean: true,
    configExists: existsSync(path.join(repoRoot, "meta-agents.yaml")),
  };
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot, encoding: "utf-8" }).trim();
    (result as Record<string, unknown>).gitBranch = branch;
    const status = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf-8" }).trim();
    (result as Record<string, unknown>).gitDirty = status.length > 0;
    (result as Record<string, unknown>).gitClean = status.length === 0;
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

      const sessionId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tp = () => new Date().toLocaleTimeString([], { hour12: false });
      runSessions.set(sessionId, {
        events: [{ event: "queued", at: new Date().toISOString(), details: { label: "Queued", desc: "Task received" } }],
        logs: [{ time: tp(), level: "INFO", msg: "Starting run..." }],
        status: "running",
        createdAt: Date.now(),
      });

      const child = spawn(process.execPath, [cliPath, "run", "--task", task, "--crew", crew, "--runtime", runtime, "--headless"], { cwd: repoRoot, env: { ...process.env } });

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

        if (url === "/api/mah/run-start") { handleRunStart(req, res); return; }
        if (url.startsWith("/api/mah/run-status/")) { handleRunStatus(req, res); return; }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [mahApiMiddleware(), react()],
});
