import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export type Run = {
  id: string; status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: number; endedAt?: number; pid?: number;
  events: Array<{ seq: number; event: string; at: string; details?: Record<string, unknown> }>;
  logs: Array<{ seq: number; time: string; level: "INFO" | "ERROR"; msg: string }>;
};

export class RunSupervisor {
  private runs = new Map<string, Run>();
  private children = new Map<string, ChildProcess>();
  private directory: string;
  private now: () => number;
  constructor(directory: string, now = Date.now) {
    this.directory = directory;
    this.now = now;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(directory)) {
      if (!/^run-[a-f0-9-]+\.json$/.test(name)) continue;
      try {
        const run = JSON.parse(readFileSync(path.join(directory, name), "utf8")) as Run;
        if (`${run.id}.json` !== name || !Array.isArray(run.events) || !Array.isArray(run.logs)) continue;
        if (run.status === "running") {
          run.status = "interrupted";
          run.endedAt = now();
          run.events.push({ seq: this.nextSeq(run), event: "interrupted", at: new Date(now()).toISOString(), details: { label: "Interrupted", desc: "Server restarted; process ownership was lost" } });
          this.save(run);
        }
        this.runs.set(run.id, run);
      } catch { /* Ignore invalid individual records. */ }
    }
  }
  private nextSeq(run: Run): number { return Math.max(0, ...run.events.map(e => e.seq), ...run.logs.map(l => l.seq)) + 1; }
  private save(run: Run): void {
    const file = path.join(this.directory, `${run.id}.json`);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(run), { mode: 0o600 });
    renameSync(temporary, file);
  }
  get(id: string): Run | undefined { return this.runs.get(id); }
  list(): Run[] { return [...this.runs.values()]; }
  start(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Run {
    const run: Run = { id: `run-${randomUUID()}`, status: "running", createdAt: this.now(), events: [], logs: [] };
    this.runs.set(run.id, run);
    this.event(run, "queued", "Queued", "Task received");
    const child = spawn(command, args, { ...options, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    run.pid = child.pid;
    this.children.set(run.id, child);
    this.event(run, "running", "Running", "Process started");
    child.stdout?.on("data", (chunk: Buffer) => this.output(run, "INFO", chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.output(run, "ERROR", chunk));
    child.on("error", (error) => this.finish(run, "failed", error.message));
    child.on("close", (code) => this.finish(run, run.status === "cancelled" ? "cancelled" : code === 0 ? "completed" : "failed", `Exit ${code}`));
    return run;
  }
  private event(run: Run, event: string, label: string, desc: string): void {
    run.events.push({ seq: this.nextSeq(run), event, at: new Date(this.now()).toISOString(), details: { label, desc } });
    this.save(run);
  }
  private output(run: Run, level: "INFO" | "ERROR", chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      run.logs.push({ seq: this.nextSeq(run), time: new Date(this.now()).toLocaleTimeString(), level, msg: line.slice(0, 500) });
    }
    // Retain bounded output while preserving sequential reconnect markers.
    if (run.logs.length > 5000) run.logs.splice(0, run.logs.length - 5000);
    this.save(run);
  }
  private finish(run: Run, status: Run["status"], desc: string): void {
    if (run.endedAt) return;
    run.status = status;
    run.endedAt = this.now();
    this.children.delete(run.id);
    this.event(run, status, status === "completed" ? "Completed" : status === "cancelled" ? "Cancelled" : "Failed", desc);
  }
  cancel(id: string): Run | undefined {
    const run = this.runs.get(id);
    if (!run || run.status !== "running") return run;
    const child = this.children.get(id);
    if (child?.pid) {
      if (process.platform === "win32") {
        const killed = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
        if (killed.status !== 0) throw new Error("Could not confirm process termination; run remains active");
      }
      else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { if (!child.kill("SIGTERM")) throw new Error("Could not stop process"); }
        const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* Already gone. */ } }, 3000);
        timer.unref();
        child.once("close", () => clearTimeout(timer));
      }
    }
    run.status = "cancelled";
    this.finish(run, "cancelled", "Stopped by operator");
    return run;
  }
}
