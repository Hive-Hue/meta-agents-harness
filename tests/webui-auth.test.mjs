import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAuth } from "../webui/server/auth.ts";

async function fixture(auth) {
  const server = createServer((req, res) => auth.handle(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(resolve => server.close(resolve)) };
}

test("default known password cannot log in; explicit password expires on server", async () => {
  let now = 0;
  const defaults = await fixture(createAuth({ now: () => now }));
  try {
    const denied = await fetch(`${defaults.base}/api/mah/auth/login`, { method: "POST", body: JSON.stringify({ username: "admin", password: "mah" }) });
    assert.equal(denied.status, 401);
  } finally { await defaults.close(); }
  const configured = await fixture(createAuth({ password: "a-long-test-secret", now: () => now }));
  try {
    const login = await fetch(`${configured.base}/api/mah/auth/login`, { method: "POST", body: JSON.stringify({ username: "admin", password: "a-long-test-secret" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    const active = await fetch(`${configured.base}/api/mah/auth/status`, { headers: { cookie } });
    assert.equal((await active.json()).authenticated, true);
    now += 8 * 60 * 60 * 1000 + 1;
    const expired = await fetch(`${configured.base}/api/mah/auth/status`, { headers: { cookie } });
    assert.equal((await expired.json()).authenticated, false);
  } finally { await configured.close(); }
});

test("login rejects cross-origin, large bodies, and repeated failures", async () => {
  const app = await fixture(createAuth({ password: "a-long-test-secret" }));
  try {
    const url = `${app.base}/api/mah/auth/login`;
    assert.equal((await fetch(url, { method: "POST", body: "null" })).status, 400);
    assert.equal((await fetch(url, { method: "POST", body: "[]" })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" })).status, 403);
    assert.equal((await fetch(url, { method: "POST", body: "x".repeat(4097) })).status, 413);
    for (let i = 0; i < 5; i++) assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 429);
  } finally { await app.close(); }
});
