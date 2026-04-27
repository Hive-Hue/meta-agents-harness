import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs");

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

        if (url === "/api/mah/run-stream") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          req.on("end", async () => {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("Access-Control-Allow-Origin", "*");

            if (req.method !== "POST") {
              res.statusCode = 405;
              res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
              return;
            }

            try {
              const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
              const body = JSON.parse(raw) as { task?: string; crew?: string; runtime?: string };
              const { task = "", crew = "dev", runtime = ".pi/" } = body;

              if (!task.trim()) {
                res.write("event: error\ndata: No task provided\n\n");
                res.end();
                return;
              }

              const { spawn } = await import("node:child_process");
              const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs");
              const args = ["run", "--task", `"${task.replace(/"/g, '\\"')}"`, "--crew", crew, "--runtime", runtime, "--headless"];

              const child = spawn(process.execPath, [cliPath, ...args], { cwd: repoRoot, env: { ...process.env } });

              let closed = false;
              const cleanup = () => { if (!closed) { closed = true; if (!child.killed) child.kill(); } };

              child.stdout?.on("data", (data: Buffer) => {
                const lines = data.toString("utf-8").split("\n").filter(Boolean);
                for (const line of lines) res.write(`event: stdout\ndata: ${line}\n\n`);
              });

              child.stderr?.on("data", (data: Buffer) => {
                const lines = data.toString("utf-8").split("\n").filter(Boolean);
                for (const line of lines) res.write(`event: stderr\ndata: ${line}\n\n`);
              });

              child.on("close", (code) => {
                res.write(`event: done\ndata: ${code ?? 0}\n\n`);
                cleanup(); res.end();
              });

              child.on("error", (err) => {
                res.write(`event: error\ndata: ${err.message}\n\n`);
                cleanup(); res.end();
              });

              setTimeout(() => {
                res.write("event: error\ndata: Run timed out after 5 minutes\n\n");
                cleanup(); res.end();
              }, 300_000);

            } catch (error) {
              res.write(`event: error\ndata: ${error instanceof Error ? error.message : String(error)}\n\n`);
              res.end();
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [mahApiMiddleware(), react()],
});
