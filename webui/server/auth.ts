import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";

const COOKIE = "mah_webui_session";
const TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 4096;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function createAuth(options: { username?: string; password?: string; now?: () => number } = {}) {
  const username = options.username?.trim() || "admin";
  const password = options.password || "";
  const now = options.now || Date.now;
  const sessions = new Map<string, number>();
  const failures = new Map<string, { count: number; until: number }>();

  function sessionId(req: IncomingMessage): string {
    const match = (req.headers.cookie || "").match(/(?:^|;\s*)mah_webui_session=([a-f0-9]{64})(?:;|$)/);
    return match?.[1] || "";
  }
  function authenticated(req: IncomingMessage): boolean {
    const id = sessionId(req);
    const expires = sessions.get(id);
    if (!expires) return false;
    if (expires <= now()) { sessions.delete(id); return false; }
    return true;
  }
  function json(res: ServerResponse, code: number, body: object): void {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }
  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === req.headers.host;
    } catch { return false; }
  }
  function secure(req: IncomingMessage): string {
    return (req.socket as TLSSocket).encrypted ? "; Secure" : "";
  }
  function validPassword(input: string): boolean {
    if (!password) return false;
    const left = Buffer.from(input);
    const right = Buffer.from(password);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url?.split("?")[0];
    if (url === "/api/mah/auth/status" && req.method === "GET") {
      const active = authenticated(req);
      json(res, 200, { ok: true, authenticated: active, username: active ? username : "" });
      return;
    }
    if (req.method !== "POST" || !sameOrigin(req)) {
      json(res, !sameOrigin(req) ? 403 : 405, { ok: false, error: "request denied" }); return;
    }
    if (url === "/api/mah/auth/logout") {
      sessions.delete(sessionId(req));
      res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req)}`);
      json(res, 200, { ok: true }); return;
    }
    if (url !== "/api/mah/auth/login") { json(res, 404, { ok: false, error: "not found" }); return; }
    const remote = req.socket.remoteAddress || "unknown";
    const attempt = failures.get(remote);
    if (attempt && attempt.until > now() && attempt.count >= MAX_FAILURES) {
      res.setHeader("Retry-After", String(Math.ceil((attempt.until - now()) / 1000)));
      json(res, 429, { ok: false, error: "too many attempts" }); return;
    }
    if ((Number(req.headers["content-length"]) || 0) > MAX_BODY) {
      json(res, 413, { ok: false, error: "body too large" }); return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { json(res, 413, { ok: false, error: "body too large" }); req.pause(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let body: { username?: unknown; password?: unknown };
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
        body = parsed;
      }
      catch { json(res, 400, { ok: false, error: "invalid JSON" }); return; }
      if (body.username !== username || typeof body.password !== "string" || !validPassword(body.password)) {
        const latest = failures.get(remote);
        const count = latest && latest.until > now() ? latest.count + 1 : 1;
        failures.set(remote, { count, until: now() + WINDOW_MS });
        json(res, 401, { ok: false, error: "invalid credentials" }); return;
      }
      failures.delete(remote);
      const id = randomBytes(32).toString("hex");
      sessions.set(id, now() + TTL_MS);
      res.setHeader("Set-Cookie", `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_MS / 1000}${secure(req)}`);
      json(res, 200, { ok: true, authenticated: true, username });
    });
  }
  return { authenticated, handle, sameOrigin };
}
