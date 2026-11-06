import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunSupervisor } from "../webui/server/runs.ts";

test("active run survives 15 minutes and restart reconciles durable status", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mah-webui-runs-"));
  let now = Date.now();
  const supervisor = new RunSupervisor(directory, () => now);
  try {
    const run = supervisor.start(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: directory, env: process.env });
    now += 15 * 60 * 1000;
    assert.equal(supervisor.get(run.id)?.status, "running");
    const recovered = new RunSupervisor(directory, () => now);
    assert.equal(recovered.get(run.id)?.status, "interrupted");
    assert.equal(recovered.get(run.id)?.events.at(-1)?.event, "interrupted");
    assert.ok(recovered.get(run.id)?.events.every((event, index, events) => index === 0 || event.seq > events[index - 1].seq));
    supervisor.cancel(run.id);
    assert.equal(supervisor.get(run.id)?.status, "cancelled");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
