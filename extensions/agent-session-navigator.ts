/**
 * Agent Session Navigator — inspect session files from other multi-team agents
 *
 * Flow:
 * - Ctrl+X        open navigator overlay immediately
 * - Left/Right    switch between agent sessions
 * - Up/Down       scroll transcript only
 * - G / End       jump to the end of the transcript
 * - g / Home      jump to the top of the transcript
 * - Mouse wheel   scroll transcript (inside overlay)
 * - Mouse click   toggle individual tool/message blocks
 * - Tab           cycle through agents forward
 * - Shift+Tab     cycle through agents backward
 * - Esc/Q         close overlay
 *
 * Fallback:
 * - /agent-sessions command opens overlay directly
 * - Alt+O opens overlay directly
 *
 * Usage:
 *   pi -e extensions/multi-team.ts -e extensions/agent-session-navigator.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ───────────────────────────────────────────────────────────────────

interface AgentSessionSummary {
	agent: string;
	path: string;
	updatedAt: string;
	updatedEpoch: number;
	userCount: number;
	assistantCount: number;
	tokenIn: number;
	tokenOut: number;
	costTotal: number;
	lastUser: string;
	lastAssistant: string;
	team: string;
	model: string;
}

interface TranscriptCacheEntry {
	cacheKey: string;
	lines: TranscriptLine[];
}

interface TranscriptLine {
	text: string;
	type: "role-user" | "role-assistant" | "tool-header" | "tool-args" | "tool-result-sep" | "tool-result" | "tool-no-result" | "content" | "spacer" | "empty";
	/** Toggle key for collapsible sections: "msg:N" for messages, "tool:N:T" for tools */
	toggleKey?: string;
}

interface ParsedToolCall {
	name: string;
	id: string;
	args: any;
	result: string | null;
	isError: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeAgentNameFromFile(filePath: string): string {
	const file = basename(filePath).replace(/\.session\.jsonl$/i, "");
	if (file === "root-orchestrator") return "orchestrator";
	return file;
}

function textFromContent(content: any, message?: any): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) {
		const errorMessage = `${message?.errorMessage || message?.error || ""}`.trim();
		if (errorMessage) return `[error] ${errorMessage}`;
		const stopReason = `${message?.stopReason || ""}`.trim();
		return stopReason && stopReason !== "endTurn" ? `[stopReason] ${stopReason}` : "";
	}
	const text = content
		.map((item: any) => {
			if (!item) return "";
			if (typeof item === "string") return item;
			if (item.type === "text") return item.text || "";
			if (item.type === "toolCall") return `[tool:${item.name || "unknown"}]`;
			if (item.type === "toolResult") return `[tool-result]`;
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
	if (text) return text;
	const errorMessage = `${message?.errorMessage || message?.error || ""}`.trim();
	if (errorMessage) return `[error] ${errorMessage}`;
	const stopReason = `${message?.stopReason || ""}`.trim();
	return stopReason && stopReason !== "endTurn" ? `[stopReason] ${stopReason}` : "";
}

function loadTeams(cwd: string): Record<string, string> {
	const map: Record<string, string> = {};
	try {
		const yamlPath = join(cwd, "meta-agents.yaml");
		if (existsSync(yamlPath)) {
			const yaml = readFileSync(yamlPath, "utf-8");
			const lines = yaml.split("\n");
			let currentId: string | null = null;
			for (const line of lines) {
				const idMatch = line.match(/^\s+-\s*id:\s*(.+)$/);
				if (idMatch) {
					currentId = idMatch[1].trim();
					continue;
				}
				if (currentId) {
					const teamMatch = line.match(/^\s+team:\s*(.+)$/);
					if (teamMatch) {
						map[currentId] = teamMatch[1].trim();
						currentId = null;
					}
				}
			}
		}
	} catch {
		// Ignore parse errors, fallback to unknown
	}
	return map;
}

function summarizeSessionFile(filePath: string, teamMap: Record<string, string>): AgentSessionSummary {
	let userCount = 0;
	let assistantCount = 0;
	let tokenIn = 0;
	let tokenOut = 0;
	let costTotal = 0;
	let lastUser = "";
	let lastAssistant = "";
	let model = "";

	let updatedEpoch = 0;
	try {
		updatedEpoch = statSync(filePath).mtimeMs;
	} catch {
		updatedEpoch = Date.now();
	}

	const raw = readFileSync(filePath, "utf-8");
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (parsed?.type === "model_change" && parsed.modelId) {
			model = parsed.provider ? `${parsed.provider}/${parsed.modelId}` : parsed.modelId;
		}

		if (parsed?.type !== "message" || !parsed?.message) continue;

		if (parsed.message?.model && !model) {
			model = parsed.message.model;
		}

		const role = parsed.message.role;
		const contentText = textFromContent(parsed.message.content || [], parsed.message);
		if (role === "user") {
			userCount += 1;
			if (contentText) lastUser = contentText;
		} else if (role === "assistant") {
			assistantCount += 1;
			if (contentText) lastAssistant = contentText;
			tokenIn += parsed.message?.usage?.input || 0;
			tokenOut += parsed.message?.usage?.output || 0;
			costTotal += parsed.message?.usage?.cost?.total || 0;
		}
	}

	const agentName = normalizeAgentNameFromFile(filePath);
	return {
		agent: agentName,
		path: filePath,
		updatedAt: new Date(updatedEpoch).toISOString(),
		updatedEpoch,
		userCount,
		assistantCount,
		tokenIn,
		tokenOut,
		costTotal,
		lastUser: lastUser.trim(),
		lastAssistant: lastAssistant.trim(),
		team: teamMap[agentName] || "unknown",
		model: model || "unknown",
	};
}

function formatTokens(value: number): string {
	if (value < 1000) return `${Math.round(value)}`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatCost(value: number): string {
	if (value < 0.01) return `$${value.toFixed(4)}`;
	if (value < 1) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(2)}`;
}

function formatTimeAgo(epoch: number): string {
	const diff = Date.now() - epoch;
	if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
	return `${Math.round(diff / 86_400_000)}d ago`;
}

function displayName(name: string): string {
	return name
		.split(/[-_]/g)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function discoverSessionRoots(cwd: string): string[] {
	const roots: string[] = [];
	const crewRoot = resolve(cwd, ".pi", "crew");
	if (existsSync(crewRoot)) {
		for (const crewName of readdirSync(crewRoot)) {
			const sessions = resolve(crewRoot, crewName, "sessions");
			if (existsSync(sessions)) roots.push(sessions);
		}
	}
	const legacy = resolve(cwd, ".pi", "multi-team", "sessions");
	if (existsSync(legacy)) roots.push(legacy);
	return roots;
}

function latestStateDirInRoot(sessionsRoot: string): string | null {
	if (!existsSync(sessionsRoot)) return null;
	const sessionDirs = readdirSync(sessionsRoot)
		.map((entry) => resolve(sessionsRoot, entry))
		.filter((dir) => {
			try { return statSync(dir).isDirectory() && existsSync(resolve(dir, "state")); }
			catch { return false; }
		})
		.sort((a, b) => {
			try { return statSync(b).mtimeMs - statSync(a).mtimeMs; }
			catch { return 0; }
		});
	return sessionDirs.length > 0 ? resolve(sessionDirs[0], "state") : null;
}

function discoverStateDir(cwd: string): string | null {
	const explicitRoot = process.env.PI_MULTI_SESSION_ROOT?.trim();
	if (explicitRoot) {
		const directState = resolve(cwd, explicitRoot, "state");
		if (existsSync(directState)) return directState;
		const explicitAsState = resolve(cwd, explicitRoot);
		if (existsSync(explicitAsState) && basename(explicitAsState) === "state") return explicitAsState;
	}
	const sessionId = process.env.PI_MULTI_SESSION_ID?.trim();
	if (sessionId) {
		for (const root of discoverSessionRoots(cwd)) {
			const exact = resolve(root, sessionId, "state");
			if (existsSync(exact)) return exact;
		}
	}
	const candidates = discoverSessionRoots(cwd)
		.map((root) => latestStateDirInRoot(root))
		.filter((value): value is string => Boolean(value))
		.sort((a, b) => {
			try { return statSync(b).mtimeMs - statSync(a).mtimeMs; }
			catch { return 0; }
		});
	return candidates[0] || null;
}

function loadSummaries(cwd: string): { stateDir: string | null; summaries: AgentSessionSummary[] } {
	const stateDir = discoverStateDir(cwd);
	if (!stateDir || !existsSync(stateDir)) {
		return { stateDir: null, summaries: [] };
	}
	const files = readdirSync(stateDir)
		.filter((name) => name.endsWith(".session.jsonl"))
		.map((name) => resolve(stateDir, name))
		.sort((a, b) => normalizeAgentNameFromFile(a).localeCompare(normalizeAgentNameFromFile(b)));
		
	const teamMap = loadTeams(cwd);
	const summaries = files.map((filePath) => summarizeSessionFile(filePath, teamMap));
	return { stateDir, summaries };
}

function resolvePrimaryAgent(): string {
	const explicit = process.env.PI_MULTI_AGENT?.trim();
	if (explicit) return explicit;
	return "orchestrator";
}

// ── Constants ───────────────────────────────────────────────────────────────
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ── Main class ──────────────────────────────────────────────────────────────

class AgentSessionNavigator {
	private stateDir: string | null = null;
	private summaries: AgentSessionSummary[] = [];
	private transcriptCache = new Map<string, TranscriptCacheEntry>();
	private selected = 0;
	/** Scroll offset — applies ONLY to the transcript panel */
	private transcriptScrollOffset = 0;
	private lastRefreshAt = 0;
	private readonly refreshIntervalMs = 900;
	private terminalRows = 24;
	private terminalCols = 80;
	private lastTranscriptLineCount = 0;
	private lastTranscriptViewport = 0;
	/** Per-section collapse state. Keys: "msg:N" for messages, "tool:N:T" for tools */
	private collapsed = new Set<string>();
	private mouseEnabled = true;
	private showSidebar = true;
	private spinnerFrame = 0;
	private spinnerInterval: any = null;
	/**
	 * Maps rendered screen row (0-indexed) → toggleKey for click-to-toggle.
	 * Rebuilt every render().
	 */
	private clickableRows = new Map<number, string>();

	constructor(
		private cwd: string,
		private primaryAgent: string,
		private close: () => void,
		private requestRender: () => void,
	) {
		// Enable SGR Mouse Tracking (1000 = normal config, 1006 = SGR format)
		if (this.mouseEnabled) {
			process.stdout.write("\x1b[?1000h\x1b[?1006h");
		}

		this.refresh(true);
		this.spinnerInterval = setInterval(() => {
			this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
		}, 80);
	}

	dispose(): void {
		// Disable SGR Mouse Tracking
		process.stdout.write("\x1b[?1000l\x1b[?1006l");

		if (this.spinnerInterval) {
			clearInterval(this.spinnerInterval);
			this.spinnerInterval = null;
		}
	}

	private refresh(force = false): void {
		const now = Date.now();
		if (!force && now - this.lastRefreshAt < this.refreshIntervalMs) return;
		this.lastRefreshAt = now;

		const previousAgent = this.summaries[this.selected]?.agent || "";
		const { stateDir, summaries } = loadSummaries(this.cwd);
		this.stateDir = stateDir;
		this.summaries = summaries;

		if (this.summaries.length === 0) {
			this.selected = 0;
			return;
		}

		if (previousAgent) {
			const idx = this.summaries.findIndex((item) => item.agent === previousAgent);
			if (idx >= 0) {
				this.selected = idx;
				return;
			}
		}

		const preferred = this.summaries.findIndex((item) => item.agent !== this.primaryAgent);
		this.selected = preferred >= 0 ? preferred : 0;
	}

	private getTranscriptViewport(): number {
		const rows = Number.isFinite(this.terminalRows) ? this.terminalRows : 24;
		// Header takes 4 lines, footer takes 1 → viewport is the rest
		return Math.max(4, rows - 5);
	}

	private getMaxTranscriptScroll(): number {
		return Math.max(0, this.lastTranscriptLineCount - this.lastTranscriptViewport);
	}

	private setTranscriptScroll(next: number): void {
		const max = this.getMaxTranscriptScroll();
		this.transcriptScrollOffset = Math.max(0, Math.min(max, next));
	}

	private scrollTranscript(delta: number): void {
		this.setTranscriptScroll(this.transcriptScrollOffset + delta);
	}

	private truncate(text: string, limit: number): string {
		if (text.length <= limit) return text;
		return text.slice(0, limit) + ` ... (truncated, ${text.length} chars total)`;
	}

	// ── JSONL Parsing ───────────────────────────────────────────────────────
	// pi-coding-agent session format:
	//   assistant message: content has {type:"toolCall", name, id, arguments:{...}}
	//   tool result: separate message with role:"toolResult", toolCallId, toolName, content:[{type:"text",text}]
	//   user message: role:"user", content is text or array of text items

	private parseSessionMessages(summary: AgentSessionSummary): Array<{
		role: string;
		content: any;
		toolCalls: ParsedToolCall[];
		rawMessage: any;
	}> {
		let raw: string;
		try {
			raw = readFileSync(summary.path, "utf-8");
		} catch {
			return [];
		}

		const jsonlLines = raw.split("\n");
		const messages: Array<{ role: string; content: any; toolCalls: ParsedToolCall[]; rawMessage: any }> = [];

		let i = 0;
		while (i < jsonlLines.length) {
			const line = jsonlLines[i];
			if (!line.trim()) { i++; continue; }
			let parsed: any;
			try { parsed = JSON.parse(line); } catch { i++; continue; }
			if (parsed?.type !== "message" || !parsed?.message) { i++; continue; }

			const msg = parsed.message;
			const role = String(msg.role || "unknown");

			if (role === "assistant") {
				const content = msg.content || [];
				const toolCalls: ParsedToolCall[] = [];

				// Extract tool calls from assistant content
				if (Array.isArray(content)) {
					for (const item of content) {
						if (item?.type === "toolCall") {
							toolCalls.push({
								name: item.name || "unknown",
								id: item.id || "",
								// pi uses "arguments" field, not "input"
								args: item.arguments || item.input || {},
								result: null,
								isError: false,
							});
						}
					}
				}

				// Look ahead for matching toolResult messages
				if (toolCalls.length > 0) {
					let j = i + 1;
					let toolIdx = 0;
					while (j < jsonlLines.length && toolIdx < toolCalls.length) {
						const nextLine = jsonlLines[j];
						if (!nextLine.trim()) { j++; continue; }
						let nextParsed: any;
						try { nextParsed = JSON.parse(nextLine); } catch { j++; continue; }
						if (nextParsed?.type !== "message" || !nextParsed?.message) { j++; continue; }

						const nextMsg = nextParsed.message;
						const nextRole = String(nextMsg.role || "");

						if (nextRole === "toolResult") {
							// Match by toolCallId if available, otherwise positional
							const callId = nextMsg.toolCallId || "";
							let matchIdx = toolIdx;
							if (callId) {
								const byId = toolCalls.findIndex((tc) => tc.id === callId);
								if (byId >= 0) matchIdx = byId;
							}

							// Extract result text
							let resultText = "";
							const resultContent = nextMsg.content;
							if (typeof resultContent === "string") {
								resultText = resultContent;
							} else if (Array.isArray(resultContent)) {
								resultText = resultContent
									.map((c: any) => typeof c === "string" ? c : c?.text || "")
									.join("");
							} else if (resultContent !== undefined) {
								resultText = JSON.stringify(resultContent);
							}

							if (matchIdx < toolCalls.length) {
								toolCalls[matchIdx].result = resultText;
								toolCalls[matchIdx].isError = !!nextMsg.isError;
							}
							toolIdx++;
							j++;
							continue;
						}

						// Also support legacy format: role="user" with toolResult items
						if (nextRole === "user") {
							const nextContent = nextMsg.content || [];
							if (Array.isArray(nextContent)) {
								let foundToolResult = false;
								for (const item of nextContent) {
									if (item?.type === "toolResult" && toolIdx < toolCalls.length) {
										let resultText = "";
										if (typeof item.content === "string") {
											resultText = item.content;
										} else if (Array.isArray(item.content)) {
											resultText = item.content.map((c: any) => typeof c === "string" ? c : c?.text || "").join("");
										} else if (item.content !== undefined) {
											resultText = JSON.stringify(item.content);
										}
										toolCalls[toolIdx].result = resultText;
										toolIdx++;
										foundToolResult = true;
									}
								}
								if (foundToolResult) { j++; continue; }
							}
						}

						// Stop looking if we hit another assistant message
						if (nextRole === "assistant") break;
						j++;
					}
				}

				messages.push({ role, content, toolCalls, rawMessage: msg });
				i++;

			} else if (role === "toolResult") {
				// Skip standalone toolResult messages (already consumed above)
				i++;

			} else {
				// user messages
				messages.push({ role, content: msg.content, toolCalls: [], rawMessage: msg });
				i++;
			}
		}

		return messages;
	}

	private buildTranscriptLines(summary: AgentSessionSummary): TranscriptLine[] {
		const expandKey = Array.from(this.collapsed).sort().join(",");
		const cacheKey = `${summary.path}:${summary.updatedEpoch}:${expandKey}`;
		const cached = this.transcriptCache.get(cacheKey);
		if (cached) return cached.lines;

		const transcript: TranscriptLine[] = [];
		const messages = this.parseSessionMessages(summary);
		const TRUNCATE_LIMIT = 300;

		for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
			const msg = messages[msgIdx];
			const role = msg.role.toUpperCase();
			const displayRole = role === "ASSISTANT" ? "AGENT" : role;
			const msgKey = `msg:${msgIdx}`;
			const isCollapsed = this.collapsed.has(msgKey);

			// Role header
			const roleIcon = role === "USER" ? "▸" : "◂";
			const msgNum = String(msgIdx + 1).padStart(3, "0");
			const collapseIcon = isCollapsed ? "▸" : "▾";
			const roleType: TranscriptLine["type"] = role === "USER" ? "role-user" : "role-assistant";

			transcript.push({
				text: `${collapseIcon} ${roleIcon} [${msgNum}] ${displayRole}`,
				type: roleType,
				toggleKey: msgKey,
			});

			if (isCollapsed) {
				transcript.push({ text: "", type: "spacer" });
				continue;
			}

			// Tool calls
			if (msg.toolCalls.length > 0) {
				for (let tIdx = 0; tIdx < msg.toolCalls.length; tIdx++) {
					const tc = msg.toolCalls[tIdx];
					const toolKey = `tool:${msgIdx}:${tIdx}`;
					const toolCollapsed = this.collapsed.has(toolKey);
					const hasResult = tc.result !== null;
					const statusIcon = hasResult ? (tc.isError ? "✗" : "✔") : "⋯";
					const toggleIcon = toolCollapsed ? "▸" : "▾";

					transcript.push({
						text: `  ${statusIcon} ${toggleIcon} ƒ ${tc.name}`,
						type: "tool-header",
						toggleKey: toolKey,
					});

					if (!toolCollapsed) {
						// Args
						const argsStr = JSON.stringify(tc.args, null, 2);
						const truncatedArgs = this.truncate(argsStr, TRUNCATE_LIMIT);
						for (const argLine of truncatedArgs.split("\n")) {
							transcript.push({ text: `    │ ${argLine}`, type: "tool-args" });
						}
						// Result
						if (hasResult) {
							transcript.push({ text: "    ├── output ──", type: "tool-result-sep" });
							const resultLines = this.truncate(tc.result!, TRUNCATE_LIMIT).split("\n");
							for (const rl of resultLines) {
								transcript.push({ text: `    │ ${rl}`, type: tc.isError ? "tool-no-result" : "tool-result" });
							}
							transcript.push({ text: "    └────────────", type: "tool-result-sep" });
						} else {
							transcript.push({ text: "    └ (pending…)", type: "tool-no-result" });
						}
					}
				}

				// Also show any non-tool text content from the assistant message
				if (Array.isArray(msg.content)) {
					const textParts = msg.content
						.filter((c: any) => c?.type === "text" && c.text?.trim())
						.map((c: any) => c.text);
					for (const part of textParts) {
						for (const row of part.replace(/\r/g, "").split("\n")) {
							transcript.push({ text: `  │ ${row}`, type: "content" });
						}
					}
				}
			} else {
				// Non-tool message content
				const text = textFromContent(msg.content, msg.rawMessage);
				if (text.trim()) {
					for (const row of text.replace(/\r/g, "").split("\n")) {
						transcript.push({ text: `  │ ${row}`, type: "content" });
					}
				} else {
					transcript.push({ text: "  │ (empty)", type: "empty" });
				}
			}

			transcript.push({ text: "", type: "spacer" });
		}

		if (transcript.length === 0) {
			transcript.push({ text: "(no message content found in this session)", type: "content" });
		}

		this.transcriptCache.set(cacheKey, { cacheKey, lines: transcript });
		return transcript;
	}

	private colorizeLine(text: string, type: TranscriptLine["type"], theme: any): string {
		switch (type) {
			case "role-user": return theme.fg("userMessageText", theme.bold(text));
			case "role-assistant": return theme.fg("accent", theme.bold(text));
			case "tool-header": return theme.fg("toolTitle", theme.bold(text));
			case "tool-args": return theme.fg("mdCode", text);
			case "tool-result-sep": return theme.fg("mdCodeBlockBorder", text);
			case "tool-result": return theme.fg("toolOutput", text);
			case "tool-no-result": return theme.fg("warning", text);
			case "content": return theme.fg("text", text);
			case "spacer": return text;
			case "empty": return theme.fg("dim", text);
			default: return theme.fg("dim", text);
		}
	}

	private wrapPlainLine(line: string, width: number): string[] {
		if (width <= 1) return [line];
		if (line.length <= width) return [line];
		const wrapped: string[] = [];
		for (let i = 0; i < line.length; i += width) {
			wrapped.push(line.slice(i, i + width));
		}
		return wrapped;
	}

	// ── Mouse parsing ───────────────────────────────────────────────────────

	private parseMouseEvent(data: string): { button: number; col: number; row: number; release: boolean } | null {
		// SGR mouse mode: ESC [ < button ; col ; row M/m
		const sgrMatch = data.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
		if (sgrMatch) {
			return {
				button: parseInt(sgrMatch[1], 10),
				col: parseInt(sgrMatch[2], 10),
				row: parseInt(sgrMatch[3], 10),
				release: sgrMatch[4] === "m",
			};
		}
		// X10 mouse mode: ESC [ M cb cx cy
		if (data.startsWith("\x1b[M") && data.length >= 6) {
			const cb = data.charCodeAt(3) - 32;
			const cx = data.charCodeAt(4) - 32;
			const cy = data.charCodeAt(5) - 32;
			return { button: cb, col: cx, row: cy, release: false };
		}
		return null;
	}

	handleInput(data: string, tui: any): boolean {
		// ── Mouse events ──
		if (this.mouseEnabled) {
			const mouse = this.parseMouseEvent(data);
			if (mouse) {
				// Scroll wheel
				if (mouse.button === 64) { this.scrollTranscript(-3); tui.requestRender(); return true; }
				if (mouse.button === 65) { this.scrollTranscript(3); tui.requestRender(); return true; }

				// Left click (press)
				if (mouse.button === 0 && !mouse.release) {
					const screenRow = mouse.row - 1; // 0-indexed
					const toggleKey = this.clickableRows.get(screenRow);
					if (toggleKey) {
						if (this.collapsed.has(toggleKey)) {
							this.collapsed.delete(toggleKey);
						} else {
							this.collapsed.add(toggleKey);
						}
						this.transcriptCache.clear();
						tui.requestRender();
					}
					return true;
				}

				return true; // Consume all mouse events
			}

			// Catch any other mouse escape sequences
			if (data.startsWith("\x1b[<") || data.startsWith("\x1b[M")) {
				return true;
			}
		}

		// ── Keyboard ──
		if (matchesKey(data, "m")) {
			this.mouseEnabled = !this.mouseEnabled;
			if (this.mouseEnabled) {
				process.stdout.write("\x1b[?1000h\x1b[?1006h");
			} else {
				process.stdout.write("\x1b[?1000l\x1b[?1006l");
			}
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, "z")) {
			this.showSidebar = !this.showSidebar;
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.left) || matchesKey(data, "shift+tab")) {
			if (this.summaries.length > 0) {
				this.selected = (this.selected - 1 + this.summaries.length) % this.summaries.length;
				this.transcriptScrollOffset = 0;
			}
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.right) || matchesKey(data, "tab")) {
			if (this.summaries.length > 0) {
				this.selected = (this.selected + 1) % this.summaries.length;
				this.transcriptScrollOffset = 0;
			}
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.up)) {
			this.scrollTranscript(-1);
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.down)) {
			this.scrollTranscript(1);
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.pageUp)) {
			this.scrollTranscript(-Math.max(1, this.lastTranscriptViewport - 2));
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.pageDown)) {
			this.scrollTranscript(Math.max(1, this.lastTranscriptViewport - 2));
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, "alt+up")) {
			this.scrollTranscript(-1);
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, "alt+down")) {
			this.scrollTranscript(1);
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.home) || matchesKey(data, "g")) {
			this.setTranscriptScroll(0);
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, Key.end) || matchesKey(data, "G") || matchesKey(data, "shift+g")) {
			this.setTranscriptScroll(this.getMaxTranscriptScroll());
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.dispose();
			this.close();
			return true;
		}

		if (matchesKey(data, "r")) {
			this.refresh(true);
			this.transcriptScrollOffset = 0;
			tui.requestRender();
			return true;
		}

		if (matchesKey(data, "ctrl+o")) {
			// Bulk toggle all collapsed
			if (this.collapsed.size > 0) {
				this.collapsed.clear();
			} else {
				// Collapse all messages
				const selected = this.summaries[this.selected];
				if (selected) {
					const tlines = this.buildTranscriptLines(selected);
					for (const tl of tlines) {
						if (tl.toggleKey) this.collapsed.add(tl.toggleKey);
					}
				}
			}
			this.transcriptCache.clear();
			tui.requestRender();
			return true;
		}

		return false;
	}

	// ── Visual helpers ──────────────────────────────────────────────────────

	private buildMiniBar(value: number, maxValue: number, width: number, theme: any): string {
		if (maxValue <= 0 || width <= 0) return "";
		const filled = Math.round(Math.min(1, value / maxValue) * width);
		const barFilled = "━".repeat(filled);
		const barEmpty = "─".repeat(Math.max(0, width - filled));
		return theme.fg("accent", barFilled) + theme.fg("dim", barEmpty);
	}

	// ── Header bar ──────────────────────────────────────────────────────────

	private buildHeaderBar(width: number, theme: any): string[] {
		const lines: string[] = [];

		lines.push(theme.fg("accent", "━".repeat(width)));

		const spinner = SPINNER_FRAMES[this.spinnerFrame];
		const titleLeft = ` ${spinner} Agent Session Navigator`;
		const agentCount = this.summaries.length;
		const titleRight = `${agentCount} agent${agentCount !== 1 ? "s" : ""} `;
		const titlePad = Math.max(0, width - visibleWidth(titleLeft) - visibleWidth(titleRight));
		lines.push(
			theme.fg("accent", theme.bold(titleLeft)) +
			" ".repeat(titlePad) +
			theme.fg("dim", titleRight)
		);

		const mouseState = this.mouseEnabled ? "on" : "off";
		const hints = `  ←/→ agent  ↑/↓ scroll  click toggle  Ctrl+O all  z zoom  g/G jump  m mouse:${mouseState}  esc quit`;
		lines.push(truncateToWidth(theme.fg("dim", hints), width));

		lines.push(theme.fg("dim", "─".repeat(width)));

		return lines;
	}

	// ── Agent sidebar list ──────────────────────────────────────────────────

	private buildAgentList(listWidth: number, theme: any): string[] {
		const lines: string[] = [];

		for (let idx = 0; idx < this.summaries.length; idx++) {
			const s = this.summaries[idx];
			const isSelected = idx === this.selected;
			const nameDisplay = displayName(s.agent);

			const hasActivity = s.assistantCount > 0;
			const indicator = isSelected ? "▶" : hasActivity ? "●" : "○";

			const agentLabel = ` ${indicator} ${nameDisplay}`;
			const truncatedLabel = agentLabel.length > listWidth
				? agentLabel.slice(0, listWidth - 1) + "…"
				: agentLabel;
			const padded = truncatedLabel + " ".repeat(Math.max(0, listWidth - visibleWidth(truncatedLabel)));

			if (isSelected) {
				lines.push(theme.fg("accent", theme.bold(padded)));
				const statsLine = `   ${s.userCount}↑ ${s.assistantCount}↓ ${formatCost(s.costTotal)}`;
				lines.push(truncateToWidth(theme.fg("dim", statsLine), listWidth));
			} else {
				lines.push(
					theme.fg(hasActivity ? "success" : "dim", ` ${indicator}`) +
					theme.fg("text", ` ${nameDisplay}`) +
					" ".repeat(Math.max(0, listWidth - visibleWidth(agentLabel)))
				);
			}
		}

		return lines;
	}

	// ── Stats panel ─────────────────────────────────────────────────────────

	private buildStatsPanel(selected: AgentSessionSummary, width: number, theme: any): string[] {
		const lines: string[] = [];

		lines.push(theme.fg("accent", theme.bold(` ${displayName(selected.agent)}`)));
		lines.push(theme.fg("dim", ` ${formatTimeAgo(selected.updatedEpoch)}`));
		lines.push("");

		lines.push(
			theme.fg("userMessageText", ` User  `) +
			theme.fg("text", `${selected.userCount}`)
		);
		lines.push(
			theme.fg("accent", ` Agent `) +
			theme.fg("text", `${selected.assistantCount}`)
		);
		lines.push("");

		// Token stats: ratio bar shows In vs Out proportion
		const totalTokens = selected.tokenIn + selected.tokenOut;
		const ratioBarW = Math.max(2, Math.min(8, width - 18));
		lines.push(theme.fg("dim", " Tokens"));
		lines.push(
			theme.fg("success", `  In  ${formatTokens(selected.tokenIn).padStart(7)} `) +
			this.buildMiniBar(selected.tokenIn, totalTokens, ratioBarW, theme)
		);
		lines.push(
			theme.fg("accent", `  Out ${formatTokens(selected.tokenOut).padStart(7)} `) +
			this.buildMiniBar(selected.tokenOut, totalTokens, ratioBarW, theme)
		);
		lines.push("");

		lines.push(
			theme.fg("dim", " Cost ") +
			theme.fg("warning", theme.bold(formatCost(selected.costTotal)))
		);

		lines.push("");
		const collapsedCount = this.collapsed.size;
		const toolHint = collapsedCount > 0
			? `${collapsedCount} collapsed`
			: "click ▸ to collapse";
		lines.push(theme.fg("dim", ` ${toolHint}`));

		lines.push("");
		const teamName = selected.team === "unknown" ? "unknown" : displayName(selected.team);
		lines.push(truncateToWidth(theme.fg("dim", ` Team:  ${teamName}`), width));
		lines.push(truncateToWidth(theme.fg("dim", ` Model: ${selected.model}`), width));

		return lines;
	}

	// ── Main render ─────────────────────────────────────────────────────────

	render(width: number, theme: any, terminalRows?: number): string[] {
		if (typeof terminalRows === "number" && Number.isFinite(terminalRows) && terminalRows > 0) {
			this.terminalRows = terminalRows;
		}
		this.terminalCols = width;
		this.refresh(false);
		this.clickableRows.clear();

		const output: string[] = [];

		// ── Header (fixed, always visible) ──
		const headerLines = this.buildHeaderBar(width, theme);
		for (const hl of headerLines) {
			output.push(truncateToWidth(hl, width));
		}

		if (!this.stateDir) {
			output.push("");
			output.push(theme.fg("error", " ✗ No multi-team session state directory found."));
			output.push(theme.fg("dim", "   Tip: run with extensions/multi-team.ts and an active crew."));
			// Footer
			output.push(theme.fg("accent", "━".repeat(width)));
			return output;
		}

		if (this.summaries.length === 0) {
			output.push("");
			output.push(theme.fg("warning", " ⚠ No *.session.jsonl files found."));
			output.push(theme.fg("accent", "━".repeat(width)));
			return output;
		}

		const selected = this.summaries[this.selected];
		const headerHeight = headerLines.length;

		// ── Sidebar (fixed, no scroll) ──
		const sidebarWidth = this.showSidebar ? Math.min(28, Math.floor(width * 0.20)) : 0;
		const transcriptWidth = this.showSidebar ? Math.max(20, width - sidebarWidth - 1) : width;

		let sidebarContent: string[] = [];
		if (this.showSidebar) {
			const agentList = this.buildAgentList(sidebarWidth, theme);
			const statsPanel = this.buildStatsPanel(selected, sidebarWidth, theme);
			sidebarContent = [
				...agentList,
				theme.fg("dim", "─".repeat(sidebarWidth)),
				...statsPanel,
			];
		}

		// Viewport for transcript
		const availableRows = Number.isFinite(this.terminalRows) ? this.terminalRows : 24;
		// Ensure bodyHeight is at least the sidebar's length so we don't leave empty margin
		const bodyHeight = Math.max(4, sidebarContent.length, availableRows - headerHeight - 1);

		// ── Transcript (scrollable) ──
		const allTranscriptLines: { rendered: string; toggleKey?: string }[] = [];
		allTranscriptLines.push({ rendered: theme.fg("accent", theme.bold(" Transcript")) });
		allTranscriptLines.push({ rendered: theme.fg("dim", "─".repeat(transcriptWidth)) });

		for (const tline of this.buildTranscriptLines(selected)) {
			const wrapped = this.wrapPlainLine(tline.text, Math.max(8, transcriptWidth - 2));
			for (let wIdx = 0; wIdx < wrapped.length; wIdx++) {
				const colored = this.colorizeLine(wrapped[wIdx], tline.type, theme);
				allTranscriptLines.push({
					rendered: truncateToWidth(" " + colored, transcriptWidth),
					toggleKey: wIdx === 0 ? tline.toggleKey : undefined,
				});
			}
		}

		this.lastTranscriptLineCount = allTranscriptLines.length;
		this.lastTranscriptViewport = bodyHeight;

		const maxScroll = this.getMaxTranscriptScroll();
		if (this.transcriptScrollOffset > maxScroll) {
			this.transcriptScrollOffset = maxScroll;
		}

		const tStart = this.transcriptScrollOffset;
		const tEnd = Math.min(allTranscriptLines.length, tStart + bodyHeight);
		const visibleTranscript = allTranscriptLines.slice(tStart, tEnd);

		// ── Merge sidebar + transcript side-by-side ──
		const divider = this.showSidebar ? theme.fg("dim", "│") : "";
		const rowCount = Math.max(sidebarContent.length, visibleTranscript.length, bodyHeight);

		for (let i = 0; i < rowCount; i++) {
			let sidebarPadded = "";

			if (this.showSidebar) {
				const sidebarLine = i < sidebarContent.length
					? sidebarContent[i]
					: " ".repeat(sidebarWidth);

				const sidebarVisible = visibleWidth(sidebarLine);
				sidebarPadded = sidebarLine + " ".repeat(Math.max(0, sidebarWidth - sidebarVisible));
			}

			const transcriptEntry = i < visibleTranscript.length
				? visibleTranscript[i]
				: { rendered: "" };

			const screenRow = output.length; // absolute screen row
			output.push(truncateToWidth(sidebarPadded + divider + transcriptEntry.rendered, width));

			// Track clickable rows for mouse detection
			if (transcriptEntry.toggleKey) {
				this.clickableRows.set(screenRow, transcriptEntry.toggleKey);
			}
		}

		// ── Footer bar ──
		const hasOverflow = allTranscriptLines.length > bodyHeight;
		const posText = hasOverflow
			? `${tStart + 1}-${tEnd}/${allTranscriptLines.length}`
			: `${allTranscriptLines.length} lines`;
		const spinner = SPINNER_FRAMES[this.spinnerFrame];
		const footerLeft = ` ${spinner} ${posText}`;
		const footerRight = `${selected.agent} `;
		const footerPad = Math.max(0, width - visibleWidth(footerLeft) - visibleWidth(footerRight));
		const footer =
			theme.fg("dim", footerLeft) +
			theme.fg("dim", "─".repeat(footerPad)) +
			theme.fg("accent", footerRight);
		output.push(truncateToWidth(footer, width));

		return output.map((line) => {
			const truncated = truncateToWidth(line, width);
			const visible = truncated.replace(/\x1b\[[0-9;]*m/g, "");
			if (visible.length > width) return visible.slice(0, width);
			return truncated;
		});
	}
}

// ── Extension export ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let isOpening = false;

	const openNavigator = async (ctx: ExtensionContext) => {
		if (isOpening) return;
		isOpening = true;
		try {
			await ctx.ui.custom(
				(tui, theme, _kb, done) => {
					const viewer = new AgentSessionNavigator(
						ctx.cwd,
						resolvePrimaryAgent(),
						() => done(undefined),
						() => tui.requestRender(),
					);
					return {
						render(width: number) {
							return viewer.render(width, theme, tui.terminal?.rows);
						},
						handleInput(data: string) {
							return viewer.handleInput(data, tui);
						},
						invalidate() { },
					};
				},
			);
		} finally {
			isOpening = false;
		}
	};

	pi.registerCommand("agent-sessions", {
		description: "Open navigator to inspect session files from other agents in this multi-team run",
		handler: async (_args, ctx) => {
			await openNavigator(ctx);
		},
	});

	pi.registerShortcut("ctrl+x", {
		description: "Open Agent Session Navigator",
		handler: async (ctx) => {
			try {
				await openNavigator(ctx);
			} catch (err) {
				console.error("Agent Session Navigator error:", err?.message || err);
			}
		},
	});

	pi.registerShortcut("alt+o", {
		description: "Open Agent Session Navigator",
		handler: async (ctx) => {
			try {
				await openNavigator(ctx);
			} catch (err) {
				console.error("Agent Session Navigator error:", err?.message || err);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
		ctx.ui.setStatus("session-nav", "Agent session navigator ready (/agent-sessions)");
	});

	pi.on("session_shutdown", async () => {
		isOpening = false;
	});
}
