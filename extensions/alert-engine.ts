import type { ExtensionAPI, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { parse as yamlParse } from "yaml";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { applyExtensionDefaults } from "./themeMap.ts";

type Severity = "info" | "warning" | "critical";

interface RuleConfig {
	id?: string;
	description?: string;
	event?: "tool_call";
	tool?: string | string[];
	commandIncludes?: string[];
	commandRegex?: string;
	commandRegexFlags?: string;
	pathIncludes?: string[];
	pathRegex?: string;
	pathRegexFlags?: string;
	severity?: Severity;
	message?: string;
	notify?: boolean;
	throttleSeconds?: number;
	alertOnce?: boolean;
	tags?: string[];
}

interface RulesFile {
	rules?: RuleConfig[];
}

interface CompiledRule {
	id: string;
	description?: string;
	event: "tool_call";
	tools?: Set<string>;
	commandIncludes: string[];
	commandRegex?: RegExp;
	pathIncludes: string[];
	pathRegex?: RegExp;
	severity: Severity;
	message: string;
	notify: boolean;
	throttleSeconds?: number;
	alertOnce: boolean;
	tags: string[];
}

const PATH_KEYS = new Set(["path", "glob", "directory", "cwd", "file", "filepath", "target", "root"]);

function toSafeRegex(source: string, flags: string | undefined, defaultFlags = "i"): RegExp | undefined {
	try {
		return new RegExp(source, flags || defaultFlags);
	} catch {
		return undefined;
	}
}

function extractStrings(input: unknown): string[] {
	const out: string[] = [];
	const visit = (value: unknown) => {
		if (typeof value === "string") {
			out.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (value && typeof value === "object") {
			for (const v of Object.values(value as Record<string, unknown>)) visit(v);
		}
	};
	visit(input);
	return out;
}

function extractPathCandidates(input: unknown, cwd: string): string[] {
	const out = new Set<string>();
	const visit = (value: unknown, keyHint?: string) => {
		if (typeof value === "string") {
			if (keyHint && PATH_KEYS.has(keyHint.toLowerCase())) {
				out.add(value);
				out.add(path.resolve(cwd, value));
			} else if (value.includes("/") || value.includes("\\") || value.startsWith(".")) {
				out.add(value);
				out.add(path.resolve(cwd, value));
			}
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) visit(item, keyHint);
			return;
		}
		if (value && typeof value === "object") {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k);
		}
	};
	visit(input);
	return [...out];
}

function matchesIncludes(candidates: string[], includes: string[]): boolean {
	if (includes.length === 0) return true;
	const lowered = candidates.map((c) => c.toLowerCase());
	return includes.every((needle) => lowered.some((candidate) => candidate.includes(needle)));
}

export default function (pi: ExtensionAPI) {
	let rules: CompiledRule[] = [];
	const counters: Record<Severity, number> = { info: 0, warning: 0, critical: 0 };
	const lastTriggeredMs = new Map<string, number>();
	const firedOnce = new Set<string>();
	let lastStatusMessage = "ready";

	const setStatus = (ctx: Parameters<ExtensionAPI["on"]>[1] extends (...args: infer A) => unknown ? A[1] : never) => {
		ctx.ui.setStatus(
			`🔔 Alert Engine [ℹ️ ${counters.info} ⚠️ ${counters.warning} 🚨 ${counters.critical}] • ${lastStatusMessage}`,
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
		const projectRulesPath = path.join(ctx.cwd, ".pi", "alert-rules.yaml");
		const globalRulesPath = path.join(os.homedir(), ".pi", "alert-rules.yaml");
		const rulesPath = fs.existsSync(projectRulesPath)
			? projectRulesPath
			: fs.existsSync(globalRulesPath)
				? globalRulesPath
				: null;

		if (!rulesPath) {
			ctx.ui.notify("🔔 Alert Engine: no rules found at .pi/alert-rules.yaml (project/global)");
			setStatus(ctx);
			return;
		}

		try {
			const raw = fs.readFileSync(rulesPath, "utf8");
			const parsed = yamlParse(raw) as RulesFile;
			const loaded = parsed.rules || [];
			rules = loaded.map((rule, index): CompiledRule => {
				const id = (rule.id && rule.id.trim()) || `rule-${index + 1}`;
				const toolsArray = Array.isArray(rule.tool) ? rule.tool : rule.tool ? [rule.tool] : [];
				return {
					id,
					description: rule.description,
					event: "tool_call",
					tools: toolsArray.length > 0 ? new Set(toolsArray.map((t) => t.toLowerCase())) : undefined,
					commandIncludes: (rule.commandIncludes || []).map((s) => s.toLowerCase()),
					commandRegex: rule.commandRegex ? toSafeRegex(rule.commandRegex, rule.commandRegexFlags, "i") : undefined,
					pathIncludes: (rule.pathIncludes || []).map((s) => s.toLowerCase()),
					pathRegex: rule.pathRegex ? toSafeRegex(rule.pathRegex, rule.pathRegexFlags, "i") : undefined,
					severity: rule.severity || "warning",
					message: rule.message || rule.description || id,
					notify: rule.notify ?? true,
					throttleSeconds: rule.throttleSeconds,
					alertOnce: rule.alertOnce ?? false,
					tags: rule.tags || [],
				};
			});
			ctx.ui.notify(`🔔 Alert Engine: loaded ${rules.length} rule(s) (${rulesPath === projectRulesPath ? "project" : "global"})`);
		} catch (error) {
			ctx.ui.notify(`🔔 Alert Engine: failed to load rules (${error instanceof Error ? error.message : String(error)})`);
		}

		setStatus(ctx);
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
		const toolName = event.toolName.toLowerCase();
		const commandCandidates = extractStrings(event.input);
		const pathCandidates = extractPathCandidates(event.input, ctx.cwd);

		for (const rule of rules) {
			if (rule.tools && !rule.tools.has(toolName)) continue;
			if (!matchesIncludes(commandCandidates, rule.commandIncludes)) continue;
			if (rule.commandRegex && !commandCandidates.some((c) => rule.commandRegex?.test(c))) continue;
			if (!matchesIncludes(pathCandidates, rule.pathIncludes)) continue;
			if (rule.pathRegex && !pathCandidates.some((p) => rule.pathRegex?.test(p))) continue;
			if (rule.alertOnce && firedOnce.has(rule.id)) continue;

			const now = Date.now();
			if (rule.throttleSeconds && rule.throttleSeconds > 0) {
				const previous = lastTriggeredMs.get(rule.id);
				if (previous && now - previous < rule.throttleSeconds * 1000) {
					continue;
				}
			}

			lastTriggeredMs.set(rule.id, now);
			if (rule.alertOnce) firedOnce.add(rule.id);
			counters[rule.severity] += 1;

			const emoji = rule.severity === "critical" ? "🚨" : rule.severity === "warning" ? "⚠️" : "ℹ️";
			const detail = `${emoji} ${rule.id}: ${rule.message}`;
			lastStatusMessage = detail;
			setStatus(ctx);

			if (rule.notify) {
				ctx.ui.notify(`🔔 Alert Engine: ${detail}`);
			}

			pi.appendEntry("alerts-engine-log", {
				timestamp: new Date(now).toISOString(),
				ruleId: rule.id,
				severity: rule.severity,
				message: rule.message,
				description: rule.description,
				tool: event.toolName,
				input: event.input,
				tags: rule.tags,
			});
		}

		return { block: false };
	});
}
