import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer } from "http";
import { randomBytes, randomUUID, createHash } from "crypto";
import { dirname, join, resolve } from "path";
import { applyExtensionDefaults } from "./themeMap.ts";
import { loadPiEnv } from "./env-loader.ts";

type McpTransportType = "stdio" | "http";

interface McpOAuthConfig {
	enabled?: boolean;
	clientId?: string;
	clientSecret?: string;
	authorizationEndpoint?: string;
	tokenEndpoint?: string;
	redirectUri?: string;
	scope?: string;
	resource?: string;
	audience?: string;
	codeChallengeMethod?: string;
	additionalAuthParams?: Record<string, string>;
	tokenFile?: string;
	refreshSkewSeconds?: number;
	authorizationTimeoutMs?: number;
	allowPublicCallback?: boolean;
}

interface McpServerConfig {
	transport?: McpTransportType;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	timeout_ms?: number;
	idle_shutdown_ms?: number;
	url?: string;
	headers?: Record<string, string>;
	allowInsecureHttp?: boolean;
	oauth?: McpOAuthConfig;
}

interface McpBridgeConfig {
	servers?: Record<string, McpServerConfig>;
}

interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: number;
	method?: string;
	params?: any;
	result?: any;
	error?: {
		code: number;
		message: string;
		data?: any;
	};
}

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface TokenPayload {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	expires_at?: number | null;
	saved_at?: string;
}

interface McpClientLike {
	ensureInitialized(): Promise<void>;
	listTools(): Promise<any>;
	callTool(name: string, args: Record<string, any>): Promise<any>;
	listResources(): Promise<any>;
	readResource(uri: string): Promise<any>;
	listPrompts(): Promise<any>;
	getPrompt(name: string, args: Record<string, any>): Promise<any>;
	status(): Record<string, any>;
	stop(): void;
}

function ensureParentDir(filePath: string) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function jsonText(value: any): string {
	return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return `${error}`;
}

function mcpToolFailure(server: string, operation: string, error: unknown) {
	const message = errorMessage(error);
	return {
		content: [{ type: "text", text: `MCP ${operation} failed for "${server}": ${message}` }],
		details: { server, operation, error: message },
	};
}

function parseArgumentsJson(raw?: string): Record<string, any> {
	if (!raw || !raw.trim()) return {};
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("arguments_json must be a JSON object.");
	}
	return parsed as Record<string, any>;
}

function resolveEnvPlaceholders(value: any, env: Record<string, string | undefined> = process.env): any {
	if (typeof value === "string") {
		return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, key) => env[key] ?? "");
	}
	if (Array.isArray(value)) {
		return value.map((item) => resolveEnvPlaceholders(item, env));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnvPlaceholders(item, env)]));
	}
	return value;
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

function base64Url(buffer: Buffer): string {
	return buffer
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

class OAuthManager {
	private tokenPath: string;

	constructor(
		private serverName: string,
		private oauthConfig: McpOAuthConfig,
		private stateDir: string,
	) {
		const resolvedConfig = resolveEnvPlaceholders(oauthConfig) as McpOAuthConfig;
		this.oauthConfig = resolvedConfig;
		this.tokenPath = resolvedConfig.tokenFile
			? resolve(process.cwd(), resolvedConfig.tokenFile)
			: join(stateDir, "mcp-oauth", `${serverName}.json`);
	}

	private getRequiredConfig(keys: Array<keyof McpOAuthConfig>): McpOAuthConfig {
		const missing = keys.filter((key) => !this.oauthConfig[key]);
		if (missing.length) {
			throw new Error(`[MCP][OAuth] ${this.serverName}: missing config: ${missing.join(", ")}`);
		}
		return this.oauthConfig;
	}

	private loadToken(): TokenPayload | null {
		if (!existsSync(this.tokenPath)) return null;
		try {
			return JSON.parse(readFileSync(this.tokenPath, "utf-8")) as TokenPayload;
		} catch {
			return null;
		}
	}

	private saveToken(tokenPayload: TokenPayload): TokenPayload {
		const expiresIn = Number(tokenPayload.expires_in || 0);
		const merged: TokenPayload = {
			...tokenPayload,
			saved_at: new Date().toISOString(),
			expires_at: expiresIn > 0 ? nowUnix() + expiresIn : null,
		};
		ensureParentDir(this.tokenPath);
		writeFileSync(this.tokenPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
		return merged;
	}

	private shouldRefresh(token: TokenPayload): boolean {
		const skew = Number(this.oauthConfig.refreshSkewSeconds || 60);
		if (!token.expires_at) return false;
		return nowUnix() >= Number(token.expires_at) - skew;
	}

	private async refreshToken(refreshToken: string): Promise<TokenPayload> {
		const cfg = this.getRequiredConfig(["tokenEndpoint", "clientId"]);
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: String(cfg.clientId),
		});

		if (cfg.clientSecret) body.set("client_secret", String(cfg.clientSecret));
		if (cfg.scope) body.set("scope", String(cfg.scope));

		const response = await fetch(String(cfg.tokenEndpoint), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`token refresh failed: HTTP ${response.status} ${text}`);
		}

		const payload = JSON.parse(text) as TokenPayload;
		if (!payload.access_token) throw new Error("token refresh missing access_token");
		if (!payload.refresh_token) payload.refresh_token = refreshToken;
		return this.saveToken(payload);
	}

	private async waitForCallbackCode(redirectUri: string, expectedState: string, timeoutMs: number): Promise<string> {
		const redirect = new URL(redirectUri);
		const host = redirect.hostname === "localhost" ? "127.0.0.1" : redirect.hostname;
		const port = Number(redirect.port || 80);
		const pathname = redirect.pathname || "/";

		return await new Promise<string>((resolvePromise, rejectPromise) => {
			const server = createServer((req, res) => {
				try {
					const reqUrl = new URL(req.url || "/", `http://${host}:${port}`);
					if (reqUrl.pathname !== pathname) {
						res.statusCode = 404;
						res.end("Not found");
						return;
					}

					const error = reqUrl.searchParams.get("error");
					if (error) {
						res.statusCode = 400;
						res.end(`OAuth error: ${error}`);
						rejectPromise(new Error(`OAuth callback returned error: ${error}`));
						server.close();
						return;
					}

					const state = reqUrl.searchParams.get("state");
					const code = reqUrl.searchParams.get("code");

					if (!code) {
						res.statusCode = 400;
						res.end("Missing code");
						return;
					}

					if (state !== expectedState) {
						res.statusCode = 400;
						res.end("State mismatch");
						rejectPromise(new Error("OAuth state mismatch"));
						server.close();
						return;
					}

					res.statusCode = 200;
					res.setHeader("Content-Type", "text/html; charset=utf-8");
					res.end("<html><body><h1>Authorization complete</h1><p>You can close this tab.</p></body></html>");
					resolvePromise(code);
					server.close();
				} catch (error) {
					rejectPromise(error as Error);
					server.close();
				}
			});

			server.listen(port, host, () => {
				const timeout = setTimeout(() => {
					server.close();
					rejectPromise(new Error(`Timed out waiting for OAuth callback on ${redirectUri}`));
				}, timeoutMs);

				server.on("close", () => clearTimeout(timeout));
				server.on("error", (error) => {
					clearTimeout(timeout);
					rejectPromise(error);
				});
			});
		});
	}

	private async authorizeWithPkce(): Promise<TokenPayload> {
		const cfg = this.getRequiredConfig(["authorizationEndpoint", "tokenEndpoint", "clientId", "redirectUri"]);
		const redirect = new URL(String(cfg.redirectUri));
		if (!isLoopbackHost(redirect.hostname) && cfg.allowPublicCallback !== true) {
			throw new Error(`[MCP][OAuth] ${this.serverName}: redirectUri host must be loopback unless allowPublicCallback=true`);
		}

		const verifier = base64Url(randomBytes(32));
		const challenge = base64Url(createHash("sha256").update(verifier).digest());
		const state = randomUUID();

		const authUrl = new URL(String(cfg.authorizationEndpoint));
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("client_id", String(cfg.clientId));
		authUrl.searchParams.set("redirect_uri", String(cfg.redirectUri));
		authUrl.searchParams.set("state", state);
		authUrl.searchParams.set("code_challenge", challenge);
		authUrl.searchParams.set("code_challenge_method", String(cfg.codeChallengeMethod || "S256"));
		if (cfg.scope) authUrl.searchParams.set("scope", String(cfg.scope));
		if (cfg.resource) authUrl.searchParams.set("resource", String(cfg.resource));
		if (cfg.audience) authUrl.searchParams.set("audience", String(cfg.audience));
		if (cfg.additionalAuthParams) {
			for (const [key, value] of Object.entries(cfg.additionalAuthParams)) {
				if (value != null && value !== "") authUrl.searchParams.set(key, String(value));
			}
		}

		console.warn(`[MCP][OAuth] ${this.serverName}: authorization required.`);
		console.warn(`[MCP][OAuth] Open this URL to authorize: ${authUrl.toString()}`);

		const code = await this.waitForCallbackCode(
			String(cfg.redirectUri),
			state,
			Number(cfg.authorizationTimeoutMs || 600000),
		);

		const body = new URLSearchParams({
			grant_type: "authorization_code",
			client_id: String(cfg.clientId),
			code,
			redirect_uri: String(cfg.redirectUri),
			code_verifier: verifier,
		});
		if (cfg.clientSecret) body.set("client_secret", String(cfg.clientSecret));

		const response = await fetch(String(cfg.tokenEndpoint), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`token exchange failed: HTTP ${response.status} ${text}`);
		}

		const payload = JSON.parse(text) as TokenPayload;
		if (!payload.access_token) throw new Error("token exchange missing access_token");
		return this.saveToken(payload);
	}

	async getAuthHeaders(): Promise<Record<string, string>> {
		const token = this.loadToken();
		if (token?.access_token && !this.shouldRefresh(token)) {
			return { Authorization: `Bearer ${token.access_token}` };
		}

		if (token?.refresh_token) {
			try {
				const refreshed = await this.refreshToken(token.refresh_token);
				return { Authorization: `Bearer ${refreshed.access_token}` };
			} catch (error) {
				console.warn(`[MCP][OAuth] ${this.serverName}: refresh failed: ${(error as Error).message}`);
			}
		}

		const created = await this.authorizeWithPkce();
		return { Authorization: `Bearer ${created.access_token}` };
	}
}

class StdioMcpClient implements McpClientLike {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private initialized = false;
	private idCounter = 1;
	private pending = new Map<number, PendingRequest>();
	private stdoutBuffer = "";
	private stderrLines: string[] = [];
	private idleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private name: string, private config: McpServerConfig) {}

	private timeoutMs(): number {
		return this.config.timeout_ms && this.config.timeout_ms > 0 ? this.config.timeout_ms : 20000;
	}

	private idleShutdownMs(): number {
		const value = this.config.idle_shutdown_ms;
		if (typeof value === "number") return value;
		return 10000;
	}

	private clearIdleTimer() {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private scheduleIdleShutdown() {
		const idleMs = this.idleShutdownMs();
		if (!this.proc || idleMs <= 0) return;
		if (this.pending.size > 0) return;
		this.clearIdleTimer();
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			if (this.pending.size === 0) this.stop();
		}, idleMs);
	}

	private startProcess() {
		if (this.proc) return;
		this.proc = spawn(String(this.config.command), this.config.args || [], {
			cwd: this.config.cwd ? resolve(process.cwd(), this.config.cwd) : process.cwd(),
			env: {
				...process.env,
				...((resolveEnvPlaceholders(this.config.env || {}) as Record<string, string>) || {}),
			},
			stdio: "pipe",
		});

		this.proc.unref();
		this.proc.stdout.unref?.();
		this.proc.stderr.unref?.();
		this.proc.stdin.unref?.();
		this.clearIdleTimer();

		this.proc.stdout.setEncoding("utf-8");
		this.proc.stdout.on("data", (chunk: string) => {
			this.stdoutBuffer += chunk;
			this.drainStdout();
		});

		this.proc.stderr.setEncoding("utf-8");
		this.proc.stderr.on("data", (chunk: string) => {
			for (const line of chunk.split("\n").map((item) => item.trim()).filter(Boolean)) {
				this.stderrLines.push(line);
				if (this.stderrLines.length > 20) this.stderrLines.shift();
			}
		});

		this.proc.on("close", (code, signal) => {
			const error = new Error(`MCP server "${this.name}" exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
			for (const [id, pending] of this.pending.entries()) {
				clearTimeout(pending.timer);
				pending.reject(error);
				this.pending.delete(id);
			}
			this.proc = null;
			this.initialized = false;
			this.clearIdleTimer();
		});

		this.proc.on("error", (error) => {
			for (const [id, pending] of this.pending.entries()) {
				clearTimeout(pending.timer);
				pending.reject(error);
				this.pending.delete(id);
			}
			this.proc = null;
			this.initialized = false;
			this.clearIdleTimer();
		});
	}

	private drainStdout() {
		for (;;) {
			const newlineIndex = this.stdoutBuffer.indexOf("\n");
			if (newlineIndex === -1) return;
			const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (!line.trim()) continue;

			let message: JsonRpcMessage | null = null;
			try {
				message = JSON.parse(line) as JsonRpcMessage;
			} catch {
				this.stderrLines.push(`[stdout-noise] ${line.trim()}`);
				if (this.stderrLines.length > 20) this.stderrLines.shift();
				continue;
			}

			if (typeof message.id === "number" && this.pending.has(message.id)) {
				const pending = this.pending.get(message.id)!;
				clearTimeout(pending.timer);
				this.pending.delete(message.id);
				if (message.error) {
					pending.reject(new Error(`${message.error.message}${message.error.data ? ` | ${JSON.stringify(message.error.data)}` : ""}`));
				} else {
					pending.resolve(message.result);
				}
				this.scheduleIdleShutdown();
			}
		}
	}

	private writeMessage(message: JsonRpcMessage) {
		if (!this.proc) throw new Error(`MCP server "${this.name}" is not running.`);
		const payload = `${JSON.stringify(message)}\n`;
		this.proc.stdin.write(payload);
	}

	private async request(method: string, params?: any): Promise<any> {
		this.startProcess();
		const id = this.idCounter++;
		return new Promise((resolvePromise, rejectPromise) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				rejectPromise(new Error(`Timed out waiting for MCP response from "${this.name}" for ${method}`));
				this.scheduleIdleShutdown();
			}, this.timeoutMs());

			this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
			this.writeMessage({
				jsonrpc: "2.0",
				id,
				method,
				params,
			});
		});
	}

	private notify(method: string, params?: any) {
		this.startProcess();
		this.writeMessage({
			jsonrpc: "2.0",
			method,
			params,
		});
		this.scheduleIdleShutdown();
	}

	async ensureInitialized() {
		if (this.initialized) return;
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "pi-mcp-bridge",
				version: "0.2.0",
			},
		});
		this.notify("notifications/initialized", {});
		this.initialized = true;
	}

	async listTools() {
		await this.ensureInitialized();
		return this.request("tools/list", {});
	}

	async callTool(name: string, args: Record<string, any>) {
		await this.ensureInitialized();
		return this.request("tools/call", {
			name,
			arguments: args,
		});
	}

	async listResources() {
		await this.ensureInitialized();
		return this.request("resources/list", {});
	}

	async readResource(uri: string) {
		await this.ensureInitialized();
		return this.request("resources/read", { uri });
	}

	async listPrompts() {
		await this.ensureInitialized();
		return this.request("prompts/list", {});
	}

	async getPrompt(name: string, args: Record<string, any>) {
		await this.ensureInitialized();
		return this.request("prompts/get", {
			name,
			arguments: args,
		});
	}

	status() {
		return {
			name: this.name,
			transport: "stdio",
			running: !!this.proc,
			initialized: this.initialized,
			command: this.config.command || "",
			args: this.config.args || [],
			stderr: [...this.stderrLines],
		};
	}

	stop() {
		this.clearIdleTimer();
		for (const [id, pending] of this.pending.entries()) {
			clearTimeout(pending.timer);
			pending.reject(new Error(`MCP server "${this.name}" stopped before completing request ${id}.`));
			this.pending.delete(id);
		}
		if (this.proc) {
			try {
				this.proc.stdin.end();
			} catch {}
			this.proc.kill("SIGTERM");
			this.proc = null;
		}
		this.initialized = false;
	}
}

class HttpMcpClient implements McpClientLike {
	private initialized = false;
	private idCounter = 1;
	private pending = new Map<number, PendingRequest>();
	private sessionId: string | null = null;
	private sseAbortController: AbortController | null = null;
	private oauthManager: OAuthManager | null = null;
	private lastError = "";

	constructor(private name: string, private config: McpServerConfig, private stateDir: string) {
		if (config.oauth?.enabled) {
			this.oauthManager = new OAuthManager(name, config.oauth, stateDir);
		}
		this.validateConfig();
	}

	private timeoutMs(): number {
		return this.config.timeout_ms && this.config.timeout_ms > 0 ? this.config.timeout_ms : 20000;
	}

	private validateConfig() {
		if (!this.config.url) throw new Error(`MCP server "${this.name}" is missing url`);
		const parsed = new URL(this.config.url);
		const isLocal = isLoopbackHost(parsed.hostname);
		if (parsed.protocol !== "https:" && !isLocal && this.config.allowInsecureHttp !== true) {
			throw new Error(`MCP server "${this.name}" must use HTTPS unless allowInsecureHttp=true for loopback/test use`);
		}
	}

	private async resolveHeaders(method: "GET" | "POST"): Promise<Record<string, string>> {
		const headers = { ...((resolveEnvPlaceholders(this.config.headers || {}) as Record<string, string>) || {}) };
		if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
		if (this.oauthManager) {
			Object.assign(headers, await this.oauthManager.getAuthHeaders());
		}
		if (method === "GET") headers.Accept = "text/event-stream";
		return headers;
	}

	private settleMessage(message: JsonRpcMessage) {
		if (typeof message.id !== "number" || !this.pending.has(message.id)) return;
		const pending = this.pending.get(message.id)!;
		clearTimeout(pending.timer);
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(`${message.error.message}${message.error.data ? ` | ${JSON.stringify(message.error.data)}` : ""}`));
			return;
		}
		pending.resolve(message.result);
	}

	private parseSseEvents(buffer: string): { parsed: string[]; remaining: string } {
		const parsed: string[] = [];
		const parts = buffer.split(/\n\n|\r\n\r\n/);
		const remaining = parts.pop() || "";

		for (const part of parts) {
			if (!part.trim()) continue;
			const lines = part.split(/\n|\r\n/);
			let data = "";
			for (const line of lines) {
				const trimmed = line.replace(/\r$/, "");
				if (trimmed.startsWith("data:")) {
					const value = trimmed.slice(5).trimStart();
					data = data ? `${data}\n${value}` : value;
				}
			}
			if (data) parsed.push(data);
		}

		return { parsed, remaining };
	}

	private async readSseBody(body: ReadableStream<Uint8Array> | null) {
		if (!body) return;
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const { parsed, remaining } = this.parseSseEvents(buffer);
			buffer = remaining;
			for (const item of parsed) {
				try {
					this.settleMessage(JSON.parse(item) as JsonRpcMessage);
				} catch {
					// Ignore invalid SSE payloads.
				}
			}
		}
	}

	private async openSseStream() {
		if (this.sseAbortController || !this.config.url) return;
		this.sseAbortController = new AbortController();
		try {
			const response = await fetch(this.config.url, {
				method: "GET",
				headers: await this.resolveHeaders("GET"),
				signal: this.sseAbortController.signal,
			});
			if (!response.ok) {
				if (response.status === 405) return;
				throw new Error(`GET SSE failed: HTTP ${response.status}`);
			}
			void this.readSseBody(response.body).catch((error) => {
				this.lastError = (error as Error).message;
			});
		} catch (error) {
			if ((error as Error).name !== "AbortError") {
				this.lastError = (error as Error).message;
			}
		}
	}

	private async request(method: string, params?: any): Promise<any> {
		if (!this.config.url) throw new Error(`MCP server "${this.name}" is missing url`);
		const id = this.idCounter++;

		const promise = new Promise<any>((resolvePromise, rejectPromise) => {
			const timer = setTimeout(() => {
				this.lastError = `Timed out waiting for MCP response from "${this.name}" for ${method}`;
				this.pending.delete(id);
				rejectPromise(new Error(this.lastError));
			}, this.timeoutMs());

			this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
		});

		const response = await fetch(this.config.url, {
			method: "POST",
			headers: {
				...(await this.resolveHeaders("POST")),
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			}),
		});

		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) this.sessionId = sessionId;

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			const pending = this.pending.get(id);
			if (pending) {
				clearTimeout(pending.timer);
				this.pending.delete(id);
			}
			throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
		}

		if (response.status === 202) {
			if (method === "notifications/initialized") {
				await this.openSseStream();
			}
			const pending = this.pending.get(id);
			if (pending) {
				clearTimeout(pending.timer);
				this.pending.delete(id);
				pending.resolve({});
			}
			return promise;
		}

		const contentType = response.headers.get("content-type") || "";
		if (contentType.includes("text/event-stream")) {
			await this.readSseBody(response.body);
		} else if (contentType.includes("application/json")) {
			const data = await response.json();
			for (const message of Array.isArray(data) ? data : [data]) {
				this.settleMessage(message as JsonRpcMessage);
			}
		} else {
			const text = await response.text().catch(() => "");
			if (text.trim()) {
				try {
					this.settleMessage(JSON.parse(text) as JsonRpcMessage);
				} catch {
					const pending = this.pending.get(id);
					if (pending) {
						clearTimeout(pending.timer);
						this.pending.delete(id);
						pending.reject(new Error(`Unsupported MCP response content-type: ${contentType || "(empty)"}`));
					}
				}
			}
		}

		return promise;
	}

	private async notify(method: string, params?: any): Promise<void> {
		if (!this.config.url) throw new Error(`MCP server "${this.name}" is missing url`);
		const response = await fetch(this.config.url, {
			method: "POST",
			headers: {
				...(await this.resolveHeaders("POST")),
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				method,
				params,
			}),
		});

		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) this.sessionId = sessionId;
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
		}
		if (response.status === 202 && method === "notifications/initialized") {
			await this.openSseStream();
		}
	}

	async ensureInitialized() {
		if (this.initialized) return;
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "pi-mcp-bridge",
				version: "0.2.0",
			},
		});
		await this.notify("notifications/initialized", {});
		this.initialized = true;
	}

	async listTools() {
		await this.ensureInitialized();
		return this.request("tools/list", {});
	}

	async callTool(name: string, args: Record<string, any>) {
		await this.ensureInitialized();
		return this.request("tools/call", { name, arguments: args });
	}

	async listResources() {
		await this.ensureInitialized();
		return this.request("resources/list", {});
	}

	async readResource(uri: string) {
		await this.ensureInitialized();
		return this.request("resources/read", { uri });
	}

	async listPrompts() {
		await this.ensureInitialized();
		return this.request("prompts/list", {});
	}

	async getPrompt(name: string, args: Record<string, any>) {
		await this.ensureInitialized();
		return this.request("prompts/get", { name, arguments: args });
	}

	status() {
		return {
			name: this.name,
			transport: "http",
			url: this.config.url || "",
			running: true,
			initialized: this.initialized,
			sessionId: this.sessionId,
			oauth: !!this.oauthManager,
			lastError: this.lastError,
		};
	}

	stop() {
		this.sseAbortController?.abort();
		this.sseAbortController = null;
		this.initialized = false;
		this.sessionId = null;
		this.pending.clear();
	}
}

function loadConfig(cwd: string): McpBridgeConfig {
	const candidates = [
		process.env.PI_MCP_CONFIG?.trim() ? resolve(cwd, process.env.PI_MCP_CONFIG.trim()) : "",
		resolve(cwd, ".pi", "mcp-servers.json"),
		resolve(cwd, "multi-agents", "mcp-servers.example.json"),
	].filter(Boolean);

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			return resolveEnvPlaceholders(JSON.parse(readFileSync(candidate, "utf-8"))) as McpBridgeConfig;
		} catch (error) {
			throw new Error(`Failed to parse MCP config at ${candidate}: ${(error as Error).message}`);
		}
	}

	return { servers: {} };
}

export default function (pi: ExtensionAPI) {
	let cfg: McpBridgeConfig = { servers: {} };
	const clients = new Map<string, McpClientLike>();
	let bridgeStateDir = "";

	function getServerNames(): string[] {
		return Object.keys(cfg.servers || {}).sort();
	}

	function getClient(server: string): McpClientLike {
		const serverConfig = cfg.servers?.[server];
		if (!serverConfig) {
			throw new Error(`Unknown MCP server "${server}". Configured servers: ${getServerNames().join(", ") || "(none)"}`);
		}

		if (!clients.has(server)) {
			const transport = serverConfig.transport || (serverConfig.url ? "http" : "stdio");
			if (transport === "http") {
				clients.set(server, new HttpMcpClient(server, serverConfig, bridgeStateDir));
			} else {
				if (!serverConfig.command) throw new Error(`MCP server "${server}" is missing command`);
				clients.set(server, new StdioMcpClient(server, serverConfig));
			}
		}
		return clients.get(server)!;
	}

	pi.registerTool({
		name: "mcp_servers",
		label: "MCP Servers",
		description: "List configured MCP servers and their current bridge status.",
		parameters: Type.Object({}),
		async execute() {
			const rows = getServerNames().map((name) => {
				const base = cfg.servers?.[name] || {};
				const status = clients.get(name)?.status() || {};
				return {
					name,
					transport: base.transport || (base.url ? "http" : "stdio"),
					command: base.command || "",
					args: base.args || [],
					url: base.url || "",
					oauth: !!base.oauth?.enabled,
					initialized: status.initialized || false,
					running: status.running || false,
					sessionId: status.sessionId || null,
					lastError: status.lastError || "",
					stderr: status.stderr || [],
				};
			});

			return {
				content: [{ type: "text", text: rows.length ? jsonText(rows) : "No MCP servers configured." }],
				details: { servers: rows },
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.bold("mcp_servers"), 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "mcp_tools",
		label: "MCP Tools",
		description: "List tools exposed by an MCP server.",
		parameters: Type.Object({
			server: Type.String({ description: "Configured MCP server name." }),
		}),
		async execute(_toolCallId, params) {
			const { server } = params as { server: string };
			try {
				const result = await getClient(server).listTools();
				return {
					content: [{ type: "text", text: jsonText(result) }],
					details: { server, result },
				};
			} catch (error) {
				return mcpToolFailure(server, "tools/list", error);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.bold("mcp_tools")} ${(args as any).server || ""}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "mcp_call",
		label: "MCP Call",
		description: "Call a specific tool on an MCP server using JSON arguments.",
		parameters: Type.Object({
			server: Type.String({ description: "Configured MCP server name." }),
			tool: Type.String({ description: "MCP tool name." }),
			arguments_json: Type.Optional(Type.String({ description: "JSON object string for tool arguments." })),
		}),
		async execute(_toolCallId, params) {
			const { server, tool, arguments_json } = params as { server: string; tool: string; arguments_json?: string };
			const args = parseArgumentsJson(arguments_json);
			try {
				const result = await getClient(server).callTool(tool, args);
				return {
					content: [{ type: "text", text: jsonText(result) }],
					details: { server, tool, args, result },
				};
			} catch (error) {
				return mcpToolFailure(server, `tools/call:${tool}`, error);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.bold("mcp_call")} ${(args as any).server || ""}:${(args as any).tool || ""}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "mcp_resources",
		label: "MCP Resources",
		description: "List resources exposed by an MCP server.",
		parameters: Type.Object({
			server: Type.String({ description: "Configured MCP server name." }),
		}),
		async execute(_toolCallId, params) {
			const { server } = params as { server: string };
			try {
				const result = await getClient(server).listResources();
				return {
					content: [{ type: "text", text: jsonText(result) }],
					details: { server, result },
				};
			} catch (error) {
				return mcpToolFailure(server, "resources/list", error);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.bold("mcp_resources")} ${(args as any).server || ""}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "mcp_read_resource",
		label: "MCP Read Resource",
		description: "Read a resource from an MCP server by URI.",
		parameters: Type.Object({
			server: Type.String({ description: "Configured MCP server name." }),
			uri: Type.String({ description: "Resource URI." }),
		}),
		async execute(_toolCallId, params) {
			const { server, uri } = params as { server: string; uri: string };
			try {
				const result = await getClient(server).readResource(uri);
				return {
					content: [{ type: "text", text: jsonText(result) }],
					details: { server, uri, result },
				};
			} catch (error) {
				return mcpToolFailure(server, "resources/read", error);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.bold("mcp_read_resource")} ${(args as any).server || ""}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "mcp_prompts",
		label: "MCP Prompts",
		description: "List prompts exposed by an MCP server.",
		parameters: Type.Object({
			server: Type.String({ description: "Configured MCP server name." }),
		}),
		async execute(_toolCallId, params) {
			const { server } = params as { server: string };
			try {
				const result = await getClient(server).listPrompts();
				return {
					content: [{ type: "text", text: jsonText(result) }],
					details: { server, result },
				};
			} catch (error) {
				return mcpToolFailure(server, "prompts/list", error);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.bold("mcp_prompts")} ${(args as any).server || ""}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "mcp_get_prompt",
		label: "MCP Get Prompt",
		description: "Fetch a prompt from an MCP server using JSON arguments.",
		parameters: Type.Object({
			server: Type.String({ description: "Configured MCP server name." }),
			name: Type.String({ description: "Prompt name." }),
			arguments_json: Type.Optional(Type.String({ description: "JSON object string for prompt arguments." })),
		}),
		async execute(_toolCallId, params) {
			const { server, name, arguments_json } = params as { server: string; name: string; arguments_json?: string };
			const args = parseArgumentsJson(arguments_json);
			try {
				const result = await getClient(server).getPrompt(name, args);
				return {
					content: [{ type: "text", text: jsonText(result) }],
					details: { server, name, args, result },
				};
			} catch (error) {
				return mcpToolFailure(server, `prompts/get:${name}`, error);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.bold("mcp_get_prompt")} ${(args as any).server || ""}:${(args as any).name || ""}`, 0, 0);
		},
		renderResult(result) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerCommand("mcp", {
		description: "Show configured MCP servers.",
		handler: async (_args, ctx) => {
			const rows = getServerNames()
				.map((name) => {
					const server = cfg.servers?.[name] || {};
					const transport = server.transport || (server.url ? "http" : "stdio");
					const status = clients.get(name)?.status();
					if (transport === "http") {
						return `${name}: ${server.url || ""} ${(status?.initialized ? "[ready]" : "[idle]")}`;
					}
					return `${name}: ${server.command || ""} ${(status?.initialized ? "[ready]" : status?.running ? "[running]" : "[idle]")}`;
				})
				.join("\n") || "No MCP servers configured.";
			ctx.ui.notify(rows, "info");
		},
	});

	pi.registerCommand("mcp-stop", {
		description: "Stop one MCP server or all MCP server processes.",
		handler: async (args, ctx) => {
			const target = args?.trim();
			if (!target || target === "all") {
				for (const client of clients.values()) client.stop();
				ctx.ui.notify("Stopped all MCP bridge server clients.", "info");
				return;
			}
			const client = clients.get(target);
			if (!client) {
				ctx.ui.notify(`No running MCP client for "${target}".`, "warning");
				return;
			}
			client.stop();
			ctx.ui.notify(`Stopped MCP client "${target}".`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		loadPiEnv(ctx.cwd);
		applyExtensionDefaults(import.meta.url, ctx);
		cfg = loadConfig(ctx.cwd);
		bridgeStateDir = resolve(ctx.cwd, ".pi");
		const names = getServerNames();
		if (ctx.hasUI) {
			ctx.ui.notify(
				names.length
					? `MCP bridge loaded. Servers: ${names.join(", ")}`
					: "MCP bridge loaded. No MCP servers configured.",
				"info",
			);
		}
	});

	pi.on("session_end", async () => {
		for (const client of clients.values()) client.stop();
	});
}
