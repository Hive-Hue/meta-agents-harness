/**
 * Agent Session Navigator — inspect session files from other multi-team agents
 *
 * Flow:
 * - Ctrl+X        open navigator overlay immediately
 * - Left/Right    switch between agent sessions
 * - Up/Down       scroll inside the overlay
 * - G / End       jump to the end of the transcript
 * - g / Home      jump to the top of the transcript
 * - Mouse wheel   scroll inside the overlay
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
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { applyExtensionDefaults } from "./themeMap.ts";

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
}

interface TranscriptCacheEntry {
	updatedEpoch: number;
	lines: string[];
}

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

function summarizeSessionFile(filePath: string): AgentSessionSummary {
	let userCount = 0;
	let assistantCount = 0;
	let tokenIn = 0;
	let tokenOut = 0;
	let costTotal = 0;
	let lastUser = "";
	let lastAssistant = "";

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

		if (parsed?.type !== "message" || !parsed?.message) continue;

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

	return {
		agent: normalizeAgentNameFromFile(filePath),
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
	};
}

function formatTokens(value: number): string {
	if (value < 1000) return `${Math.round(value)}`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
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
			try {
				return statSync(dir).isDirectory() && existsSync(resolve(dir, "state"));
			} catch {
				return false;
			}
		})
		.sort((a, b) => {
			try {
				return statSync(b).mtimeMs - statSync(a).mtimeMs;
			} catch {
				return 0;
			}
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
			try {
				return statSync(b).mtimeMs - statSync(a).mtimeMs;
			} catch {
				return 0;
			}
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

	const summaries = files.map((filePath) => summarizeSessionFile(filePath));
	return { stateDir, summaries };
}

function resolvePrimaryAgent(): string {
	const explicit = process.env.PI_MULTI_AGENT?.trim();
	if (explicit) return explicit;
	return "orchestrator";
}

class AgentSessionNavigator {
	private stateDir: string | null = null;
	private summaries: AgentSessionSummary[] = [];
	private transcriptCache = new Map<string, TranscriptCacheEntry>();
	private selected = 0;
	private scrollOffset = 0;
	private lastRefreshAt = 0;
	private readonly refreshIntervalMs = 900;
	private terminalRows = 24;
	private lastContentLines = 0;
	private lastViewportLines = 0;

	constructor(
		private cwd: string,
		private primaryAgent: string,
		private close: () => void,
	) {
		this.refresh(true);
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

	private getViewportLineCount(): number {
		const rows = Number.isFinite(this.terminalRows) ? this.terminalRows : 24;
		return Math.max(6, rows - 1);
	}

	private getMaxScrollOffset(): number {
		return Math.max(0, this.lastContentLines - this.lastViewportLines);
	}

	private setScrollOffset(next: number): void {
		const max = this.getMaxScrollOffset();
		this.scrollOffset = Math.max(0, Math.min(max, next));
	}

	private scrollBy(delta: number): void {
		this.setScrollOffset(this.scrollOffset + delta);
	}

	private buildTranscriptLines(summary: AgentSessionSummary): string[] {
		const cached = this.transcriptCache.get(summary.path);
		if (cached && cached.updatedEpoch === summary.updatedEpoch) {
			return cached.lines;
		}

		const transcript: string[] = [];
		let index = 0;
		try {
			const raw = readFileSync(summary.path, "utf-8");
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				let parsed: any;
				try {
					parsed = JSON.parse(line);
				} catch {
					continue;
				}
				if (parsed?.type !== "message" || !parsed?.message) continue;

				const role = String(parsed.message.role || "unknown").toUpperCase();
				const text = textFromContent(parsed.message.content || [], parsed.message);
				transcript.push(`[${String(index + 1).padStart(3, "0")}] ${role}`);
				if (text.trim()) {
					for (const row of text.replace(/\r/g, "").split("\n")) {
						transcript.push(`  ${row}`);
					}
				} else {
					transcript.push("  (empty)");
				}
				transcript.push("");
				index += 1;
			}
		} catch {
			transcript.push("(failed to read session file)");
		}

		if (transcript.length === 0) {
			transcript.push("(no message content found in this session)");
		}

		const entry: TranscriptCacheEntry = {
			updatedEpoch: summary.updatedEpoch,
			lines: transcript,
		};
		this.transcriptCache.set(summary.path, entry);
		return entry.lines;
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

	private isMouseWheelUp(data: string): boolean {
		// xterm SGR mouse mode (most terminals): ESC [ < 64 ; Cx ; Cy M/m
		if (data.includes("\u001b[<64;")) return true;
		// Legacy X10 mouse mode: ESC [ M Cb Cx Cy (Cb='`' for wheel up)
		if (data.startsWith("\u001b[M") && data.length >= 6) {
			return data.charCodeAt(3) === 96;
		}
		return false;
	}

	private isMouseWheelDown(data: string): boolean {
		// xterm SGR mouse mode (most terminals): ESC [ < 65 ; Cx ; Cy M/m
		if (data.includes("\u001b[<65;")) return true;
		// Legacy X10 mouse mode: ESC [ M Cb Cx Cy (Cb='a' for wheel down)
		if (data.startsWith("\u001b[M") && data.length >= 6) {
			return data.charCodeAt(3) === 97;
		}
		return false;
	}

	handleInput(data: string, tui: any): void {
		if (this.isMouseWheelUp(data)) {
			this.scrollBy(-3);
			tui.requestRender();
			return;
		}

		if (this.isMouseWheelDown(data)) {
			this.scrollBy(3);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.left)) {
			if (this.summaries.length > 0) {
				this.selected = (this.selected - 1 + this.summaries.length) % this.summaries.length;
				this.setScrollOffset(0);
			}
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.right)) {
			if (this.summaries.length > 0) {
				this.selected = (this.selected + 1) % this.summaries.length;
				this.setScrollOffset(0);
			}
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.scrollBy(-1);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.down)) {
			this.scrollBy(1);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.pageUp)) {
			this.scrollBy(-Math.max(1, this.lastViewportLines - 2));
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.pageDown)) {
			this.scrollBy(Math.max(1, this.lastViewportLines - 2));
			tui.requestRender();
			return;
		}

		if (matchesKey(data, "alt+up")) {
			this.scrollBy(-1);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, "alt+down")) {
			this.scrollBy(1);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.home)) {
			this.setScrollOffset(0);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, "g")) {
			this.setScrollOffset(0);
			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.end)) {
			this.setScrollOffset(this.getMaxScrollOffset());
			tui.requestRender();
			return;
		}

		if (matchesKey(data, "G") || matchesKey(data, "shift+g")) {
			this.setScrollOffset(this.getMaxScrollOffset());
			tui.requestRender();
			return;
		}

		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.close();
			return;
		}

		if (matchesKey(data, "r")) {
			this.refresh(true);
			this.setScrollOffset(0);
			tui.requestRender();
		}
	}

	private buildLines(width: number, theme: any): string[] {
		this.refresh(false);
		const lines: string[] = [];

		lines.push(
			truncateToWidth(
				theme.fg("accent", " Agent Session Navigator ") +
				theme.fg("muted", "←/→ switch  ↑/↓ scroll  Alt+↑/↓ line  PgUp/PgDn page  g/G jump  r refresh  esc close"),
				width,
			),
		);
		lines.push(theme.fg("borderMuted", "─".repeat(Math.max(0, width))));

		if (!this.stateDir) {
			lines.push(theme.fg("error", "No multi-team session state directory found."));
			lines.push(theme.fg("dim", "Tip: run with extensions/multi-team.ts and an active crew session."));
			return lines;
		}

		lines.push(truncateToWidth(theme.fg("dim", `state: ${relative(this.cwd, this.stateDir) || this.stateDir}`), width));
		lines.push(theme.fg("dim", `primary: ${this.primaryAgent}`));
		lines.push("");

		if (this.summaries.length === 0) {
			lines.push(theme.fg("warning", "No *.session.jsonl files found in this state directory."));
			return lines;
		}

		const tabLine = this.summaries
			.map((item, idx) =>
				idx === this.selected
					? theme.fg("accent", `[${item.agent}]`)
					: theme.fg("dim", item.agent),
			)
			.join(theme.fg("muted", " | "));
		lines.push(truncateToWidth(tabLine, width));
		lines.push("");

		const selected = this.summaries[this.selected];
		const stats =
			theme.fg("success", `${selected.userCount}`) +
			theme.fg("dim", " user  ") +
			theme.fg("accent", `${selected.assistantCount}`) +
			theme.fg("dim", " assistant  ·  ") +
			theme.fg("success", formatTokens(selected.tokenIn)) +
			theme.fg("dim", " in  ") +
			theme.fg("accent", formatTokens(selected.tokenOut)) +
			theme.fg("dim", " out  ·  ") +
			theme.fg("warning", `$${selected.costTotal.toFixed(4)}`);

		lines.push(truncateToWidth(theme.fg("accent", `Agent: ${selected.agent}`), width));
		lines.push(truncateToWidth(stats, width));
		lines.push(truncateToWidth(theme.fg("dim", `updated: ${selected.updatedAt}`), width));
		lines.push(truncateToWidth(theme.fg("dim", `file: ${relative(this.cwd, selected.path)}`), width));
		lines.push("");
		lines.push(theme.fg("accent", "Transcript:"));
		lines.push("");
		for (const row of this.buildTranscriptLines(selected)) {
			lines.push(...this.wrapPlainLine(row, Math.max(8, width - 1)));
		}

		return lines.map((line) => truncateToWidth(line, width));
	}

	render(width: number, theme: any, terminalRows?: number): string[] {
		if (typeof terminalRows === "number" && Number.isFinite(terminalRows) && terminalRows > 0) {
			this.terminalRows = terminalRows;
		}

		const allLines = this.buildLines(width, theme);
		this.lastContentLines = allLines.length;
		this.lastViewportLines = this.getViewportLineCount();

		const maxOffset = this.getMaxScrollOffset();
		if (this.scrollOffset > maxOffset) {
			this.scrollOffset = maxOffset;
		}

		const start = this.scrollOffset;
		const end = Math.min(allLines.length, start + this.lastViewportLines);
		const visibleLines = allLines.slice(start, end);
		const hasOverflow = allLines.length > this.lastViewportLines;

		const footer = hasOverflow
			? `scroll ${start + 1}-${end}/${allLines.length} · ↑/↓ (Alt) · PgUp/PgDn · g/G · Home/End · ←/→ · esc`
			: "↑/↓ (Alt) · PgUp/PgDn · g/G · Home/End · ←/→ · esc";
		visibleLines.push(truncateToWidth(theme.fg("dim", footer), width));

		return visibleLines.map((line) => truncateToWidth(line, width));
	}
}

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
					);
					return {
						render(width: number) {
							return viewer.render(width, theme, tui.terminal?.rows);
						},
						handleInput(data: string) {
							viewer.handleInput(data, tui);
						},
						invalidate() { },
					};
				},
				{
					overlay: true,
					overlayOptions: {
						width: "100%",
						maxHeight: "100%",
						anchor: "top-left",
						row: 0,
						col: 0,
						margin: 0,
					},
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
