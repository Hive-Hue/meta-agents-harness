/**
 * Multi-Team — hierarchical multi-agent orchestration inspired by layered teams
 *
 * Roles:
 * - Orchestrator: delegates to team leads only
 * - Lead: delegates to workers in its own team only
 * - Worker: executes code tasks directly within its ownership domain
 *
 * The runtime is driven by multi-team.yaml plus .pi/agents/,
 * .pi/expertise/, .pi/multi-team/skills/, and .pi/multi-team/sessions/.
 *
 * Usage:
 *   pi -e extensions/multi-team.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, relative, resolve } from "path";
import { applyExtensionDefaults } from "./themeMap.ts";
import { loadPiEnv } from "./env-loader.ts";

type RuntimeRole = "orchestrator" | "lead" | "worker";
type CardStatus = "idle" | "running" | "done" | "error";

interface DomainConfig {
	read?: string[];
	write?: string[];
	rules?: DomainRule[];
}

interface DomainRule {
	path: string;
	read?: boolean;
	upsert?: boolean;
	delete?: boolean;
}

interface NormalizedDomainRule {
	path: string;
	absolutePath: string;
	read: boolean;
	upsert: boolean;
	delete: boolean;
	index: number;
}

interface ExpertiseEntry {
	date: string;
	note: string;
}

interface ExpertiseDocument {
	agent: {
		name: string;
		role: RuntimeRole;
		team: string;
	};
	meta: {
		version: number;
		max_lines: number;
		last_updated: string;
	};
	patterns: ExpertiseEntry[];
	risks: ExpertiseEntry[];
	tools: ExpertiseEntry[];
	workflows: ExpertiseEntry[];
	decisions: ExpertiseEntry[];
	lessons: ExpertiseEntry[];
	observations: ExpertiseEntry[];
	open_questions: ExpertiseEntry[];
	[key: string]: any;
}

interface SkillReference {
	path: string;
	useWhen?: string;
}

interface ExpertiseReference {
	path: string;
	useWhen?: string;
	updatable?: boolean;
	maxLines?: number;
}

interface AgentConfig {
	name: string;
	prompt: string;
	description?: string;
	model?: string;
	tools?: string[] | string;
	skills?: Array<string | SkillReference>;
	expertise?: string | ExpertiseReference;
	domain?: DomainConfig | DomainRule[];
}

interface TeamConfig {
	name: string;
	lead: AgentConfig;
	members: AgentConfig[];
}

interface MultiTeamConfig {
	name: string;
	session_dir?: string;
	expertise_dir?: string;
	orchestrator: AgentConfig;
	teams: TeamConfig[];
}

interface ResolvedConfig extends MultiTeamConfig {
	baseDir: string;
	configPath: string;
	sessionDirAbs: string;
	expertiseDirAbs: string;
}

interface RuntimeState {
	role: RuntimeRole;
	agent: AgentConfig;
	team?: TeamConfig;
	children: AgentConfig[];
}

interface DispatchTarget {
	agent: AgentConfig;
	role: RuntimeRole;
	team?: TeamConfig;
}

interface CardState {
	agent: AgentConfig;
	teamName?: string;
	role: RuntimeRole;
	status: CardStatus;
	task: string;
	lastLine: string;
	elapsed: number;
	runCount: number;
	timer?: ReturnType<typeof setInterval>;
}

const DEFAULT_WORKER_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const SAFE_LEAD_TOOLS = ["read", "grep", "find", "ls"];
const SPAWNABLE_TOOL_NAMES = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"delegate_agent",
	"update_mental_model",
	"mcp_servers",
	"mcp_tools",
	"mcp_call",
	"mcp_resources",
	"mcp_read_resource",
	"mcp_prompts",
	"mcp_get_prompt",
]);
const DEFAULT_EXPERTISE_MAX_LINES = 120;
const EXPERTISE_NOTE_MAX_CHARS = 2000;

interface ParsedYamlLine {
	indent: number;
	content: string;
}

interface PromptDefinition {
	body: string;
	metadata: Record<string, any>;
}

interface PendingToolCall {
	callId: string;
	toolName: string;
	input: any;
	startedAt: string;
}

function displayName(name: string): string {
	return name
		.split(/[-_]/g)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function shortText(value: string, limit = 180): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > limit ? normalized.slice(0, limit - 3) + "..." : normalized;
}

function stripFrontmatter(raw: string): string {
	const match = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
	return match ? match[1].trim() : raw.trim();
}

function parsePromptDefinition(raw: string): PromptDefinition {
	const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
	if (!match) {
		return { body: raw.trim(), metadata: {} };
	}

	return {
		body: match[2].trim(),
		metadata: parseYamlSubset(match[1]),
	};
}

function safeReadText(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

function stripYamlComments(line: string): string {
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}
		if (char === `"` && !inSingle) {
			inDouble = !inDouble;
			continue;
		}
		if (char === "#" && !inSingle && !inDouble) {
			if (i === 0 || /\s/.test(line[i - 1])) {
				return line.slice(0, i).trimEnd();
			}
		}
	}

	return line.trimEnd();
}

function preprocessYaml(raw: string): ParsedYamlLine[] {
	return raw
		.replace(/\t/g, "    ")
		.split("\n")
		.map((line) => stripYamlComments(line))
		.filter((line) => line.trim().length > 0)
		.map((line) => ({
			indent: line.match(/^ */)?.[0].length || 0,
			content: line.trim(),
		}));
}

function parseInlineArray(token: string): string[] {
	const body = token.slice(1, -1).trim();
	if (!body) return [];
	return body
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => part.replace(/^['"]|['"]$/g, ""));
}

function parseScalarToken(token: string): any {
	if (token === "[]") return [];
	if (token === "{}") return {};
	if (token.startsWith("[") && token.endsWith("]")) return parseInlineArray(token);
	if ((token.startsWith(`"`) && token.endsWith(`"`)) || (token.startsWith("'") && token.endsWith("'"))) {
		return token.slice(1, -1);
	}
	if (token === "true") return true;
	if (token === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
	return token;
}

function nextRelevantLine(lines: ParsedYamlLine[], index: number): ParsedYamlLine | null {
	for (let i = index; i < lines.length; i++) {
		if (lines[i]) return lines[i];
	}
	return null;
}

function parseYamlBlock(lines: ParsedYamlLine[], startIndex: number, indent: number): { value: any; index: number } {
	if (startIndex >= lines.length) return { value: null, index: startIndex };

	const first = lines[startIndex];
	if (first.content.startsWith("- ")) {
		const items: any[] = [];
		let index = startIndex;

		while (index < lines.length) {
			const line = lines[index];
			if (line.indent < indent) break;
			if (line.indent !== indent || !line.content.startsWith("- ")) break;

			const rest = line.content.slice(2).trim();
			if (!rest) {
				const next = nextRelevantLine(lines, index + 1);
				if (next && next.indent > indent) {
					const child = parseYamlBlock(lines, index + 1, next.indent);
					items.push(child.value);
					index = child.index;
				} else {
					items.push("");
					index++;
				}
				continue;
			}

			const colonIndex = rest.indexOf(":");
			if (colonIndex === -1) {
				items.push(parseScalarToken(rest));
				index++;
				continue;
			}

			const item: Record<string, any> = {};
			const key = rest.slice(0, colonIndex).trim();
			const valueToken = rest.slice(colonIndex + 1).trim();

			if (valueToken) {
				item[key] = parseScalarToken(valueToken);
				index++;
			} else {
				const next = nextRelevantLine(lines, index + 1);
				if (next && next.indent > indent) {
					const child = parseYamlBlock(lines, index + 1, next.indent);
					item[key] = child.value;
					index = child.index;
				} else {
					item[key] = "";
					index++;
				}
			}

			while (index < lines.length) {
				const sibling = lines[index];
				if (sibling.indent <= indent) break;
				if (sibling.indent !== indent + 2) break;
				if (sibling.content.startsWith("- ")) break;

				const siblingColon = sibling.content.indexOf(":");
				if (siblingColon === -1) {
					index++;
					continue;
				}

				const siblingKey = sibling.content.slice(0, siblingColon).trim();
				const siblingValueToken = sibling.content.slice(siblingColon + 1).trim();

				if (siblingValueToken) {
					item[siblingKey] = parseScalarToken(siblingValueToken);
					index++;
					continue;
				}

				const next = nextRelevantLine(lines, index + 1);
				if (next && next.indent > sibling.indent) {
					const child = parseYamlBlock(lines, index + 1, next.indent);
					item[siblingKey] = child.value;
					index = child.index;
				} else {
					item[siblingKey] = "";
					index++;
				}
			}

			items.push(item);
		}

		return { value: items, index };
	}

	const object: Record<string, any> = {};
	let index = startIndex;

	while (index < lines.length) {
		const line = lines[index];
		if (line.indent < indent) break;
		if (line.indent !== indent) break;
		if (line.content.startsWith("- ")) break;

		const colonIndex = line.content.indexOf(":");
		if (colonIndex === -1) {
			index++;
			continue;
		}

		const key = line.content.slice(0, colonIndex).trim();
		const valueToken = line.content.slice(colonIndex + 1).trim();

		if (valueToken) {
			object[key] = parseScalarToken(valueToken);
			index++;
			continue;
		}

		const next = nextRelevantLine(lines, index + 1);
		if (next && next.indent > indent) {
			const child = parseYamlBlock(lines, index + 1, next.indent);
			object[key] = child.value;
			index = child.index;
		} else {
			object[key] = "";
			index++;
		}
	}

	return { value: object, index };
}

function parseYamlSubset(raw: string): any {
	const lines = preprocessYaml(raw);
	if (lines.length === 0) return {};
	return parseYamlBlock(lines, 0, lines[0].indent).value;
}

function getPromptDefinition(config: ResolvedConfig, agent: AgentConfig): PromptDefinition {
	const promptPath = resolveArtifact(config.baseDir, agent.prompt);
	const raw = safeReadText(promptPath);
	if (!raw) return { body: "", metadata: {} };
	return parsePromptDefinition(raw);
}

function normalizeSkillReference(value: any): SkillReference | null {
	if (typeof value === "string") {
		const path = value.trim();
		return path ? { path } : null;
	}
	if (!value || typeof value !== "object") return null;
	const path = typeof value.path === "string" ? value.path.trim() : "";
	if (!path) return null;
	const useWhenRaw = value["use-when"] ?? value.use_when ?? value.useWhen;
	return {
		path,
		useWhen: typeof useWhenRaw === "string" && useWhenRaw.trim() ? useWhenRaw.trim() : undefined,
	};
}

function normalizeSkillReferences(values: any): SkillReference[] {
	if (!Array.isArray(values)) {
		if (typeof values === "string" && values.trim()) {
			return values
				.split(",")
				.map((value) => normalizeSkillReference(value))
				.filter((item): item is SkillReference => !!item);
		}
		return [];
	}

	return values
		.map((value) => normalizeSkillReference(value))
		.filter((item): item is SkillReference => !!item);
}

function effectiveSkillRefs(config: ResolvedConfig, agent: AgentConfig): SkillReference[] {
	const promptDef = getPromptDefinition(config, agent);
	const merged = new Map<string, SkillReference>();
	for (const item of [...normalizeSkillReferences(agent.skills), ...normalizeSkillReferences(promptDef.metadata.skills)]) {
		const existing = merged.get(item.path);
		merged.set(item.path, {
			path: item.path,
			useWhen: item.useWhen || existing?.useWhen,
		});
	}
	return Array.from(merged.values());
}

function effectiveSkills(config: ResolvedConfig, agent: AgentConfig): string[] {
	return effectiveSkillRefs(config, agent).map((skill) => skill.path);
}

function normalizeExpertiseReference(value: any): ExpertiseReference | null {
	if (typeof value === "string") {
		const path = value.trim();
		return path ? { path } : null;
	}
	if (!value || typeof value !== "object") return null;
	const path = typeof value.path === "string" ? value.path.trim() : "";
	if (!path) return null;
	const useWhenRaw = value["use-when"] ?? value.use_when ?? value.useWhen;
	const maxLinesRaw = value["max-lines"] ?? value.max_lines ?? value.maxLines;
	return {
		path,
		useWhen: typeof useWhenRaw === "string" && useWhenRaw.trim() ? useWhenRaw.trim() : undefined,
		updatable: typeof value.updatable === "boolean" ? value.updatable : undefined,
		maxLines: typeof maxLinesRaw === "number"
			? maxLinesRaw
			: typeof maxLinesRaw === "string" && /^-?\d+$/.test(maxLinesRaw.trim())
			? Number(maxLinesRaw.trim())
			: undefined,
	};
}

function effectiveExpertise(config: ResolvedConfig, agent: AgentConfig): ExpertiseReference | null {
	const promptDef = getPromptDefinition(config, agent);
	const declared = normalizeExpertiseReference(agent.expertise);
	const metadata = normalizeExpertiseReference(promptDef.metadata.expertise);
	const merged = {
		...(declared || {}),
		...(metadata || {}),
	} as ExpertiseReference;
	if (merged.path) {
		return {
			path: merged.path,
			useWhen: merged.useWhen,
			updatable: merged.updatable ?? true,
			maxLines: merged.maxLines,
		};
	}
	return null;
}

function effectiveModel(config: ResolvedConfig, agent: AgentConfig): string | null {
	const promptDef = getPromptDefinition(config, agent);
	const metadataModel = typeof promptDef.metadata.model === "string" ? promptDef.metadata.model.trim() : "";
	if (metadataModel) return metadataModel;
	if (agent.model && agent.model !== "inherit") return agent.model;
	return null;
}

function effectiveTools(config: ResolvedConfig, agent: AgentConfig): AgentConfig["tools"] {
	if (agent.tools && (Array.isArray(agent.tools) ? agent.tools.length > 0 : agent.tools.trim().length > 0)) {
		return agent.tools;
	}
	return getPromptDefinition(config, agent).metadata.tools;
}

function mergeDomainRuleMap(map: Map<string, DomainRule>, rule: DomainRule) {
	const existing = map.get(rule.path) || { path: rule.path, read: false, upsert: false, delete: false };
	map.set(rule.path, {
		path: rule.path,
		read: rule.read ?? existing.read,
		upsert: rule.upsert ?? existing.upsert,
		delete: rule.delete ?? existing.delete,
	});
}

function legacyDomainToRules(readPaths: string[], writePaths: string[]): DomainRule[] {
	const merged = new Map<string, DomainRule>();
	for (const path of readPaths) {
		mergeDomainRuleMap(merged, { path, read: true, upsert: false, delete: false });
	}
	for (const path of writePaths) {
		mergeDomainRuleMap(merged, { path, read: true, upsert: true, delete: true });
	}
	return Array.from(merged.values());
}

function effectiveDomain(config: ResolvedConfig, agent: AgentConfig): DomainConfig {
	const metadata = getPromptDefinition(config, agent).metadata;
	const explicitRules = Array.isArray(agent.domain)
		? agent.domain
		: Array.isArray(agent.domain?.rules)
		? agent.domain.rules
		: [];
	if (explicitRules.length > 0) {
		return { rules: explicitRules };
	}
	const metadataRules = Array.isArray(metadata.domain)
		? metadata.domain
		: Array.isArray(metadata.domain?.rules)
		? metadata.domain.rules
		: [];
	if (metadataRules.length > 0) {
		return { rules: metadataRules };
	}
	const read = agent.domain?.read && agent.domain.read.length > 0
		? agent.domain.read
		: Array.isArray(metadata.domain_read)
		? metadata.domain_read
		: [];
	const write = agent.domain?.write && agent.domain.write.length > 0
		? agent.domain.write
		: Array.isArray(metadata.domain_write)
		? metadata.domain_write
		: [];
	return { read, write, rules: legacyDomainToRules(read, write) };
}

function resolveConfigPath(cwd: string): string {
	const envPath = process.env.PI_MULTI_CONFIG?.trim();
	const candidates = [
		envPath ? resolve(cwd, envPath) : "",
		resolve(cwd, "multi-team.yaml"),
		resolve(cwd, ".pi", "multi-team.yaml"),
	].filter(Boolean);

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	throw new Error("Could not find multi-team.yaml in the project root.");
}

function loadConfig(cwd: string): ResolvedConfig {
	const configPath = resolveConfigPath(cwd);
	const baseDir = dirname(configPath);
	const raw = parseYamlSubset(readFileSync(configPath, "utf-8")) as MultiTeamConfig;

	if (!raw?.orchestrator) {
		throw new Error("multi-team.yaml is missing the orchestrator block.");
	}
	if (!Array.isArray(raw.teams) || raw.teams.length === 0) {
		throw new Error("multi-team.yaml must define at least one team.");
	}

	return {
		...raw,
		baseDir,
		configPath,
		sessionDirAbs: resolve(baseDir, raw.session_dir || ".pi/multi-team/sessions"),
		expertiseDirAbs: resolve(baseDir, raw.expertise_dir || ".pi/expertise"),
	};
}

function resolveArtifact(baseDir: string, target: string): string {
	return resolve(baseDir, target);
}

function normalizeTools(tools: AgentConfig["tools"], role: RuntimeRole): string[] {
	if (Array.isArray(tools) && tools.length > 0) return tools;
	if (typeof tools === "string" && tools.trim()) {
		return tools.split(",").map((tool) => tool.trim()).filter(Boolean);
	}
	if (role === "worker") return DEFAULT_WORKER_TOOLS;
	return ["delegate_agent"];
}

function spawnableToolsForSpawn(tools: string[]): string[] {
	return Array.from(new Set(tools.filter((tool) => SPAWNABLE_TOOL_NAMES.has(tool))));
}

function matchesName(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase() || slugify(left) === slugify(right);
}

function resolveRuntime(config: ResolvedConfig): RuntimeState {
	const role = (process.env.PI_MULTI_ROLE as RuntimeRole | undefined) || "orchestrator";
	const agentName = process.env.PI_MULTI_AGENT?.trim();
	const teamName = process.env.PI_MULTI_TEAM?.trim();

	if (role === "orchestrator") {
		return {
			role,
			agent: config.orchestrator,
			children: config.teams.map((team) => team.lead),
		};
	}

	if (role === "lead") {
		const team = config.teams.find((item) =>
			(teamName && matchesName(item.name, teamName)) ||
			(agentName && matchesName(item.lead.name, agentName))
		);
		if (!team) throw new Error(`Lead runtime could not resolve team for "${agentName || teamName}".`);
		return {
			role,
			agent: team.lead,
			team,
			children: team.members,
		};
	}

	const team = config.teams.find((item) =>
		(teamName && matchesName(item.name, teamName)) ||
		item.members.some((member) => agentName && matchesName(member.name, agentName))
	);
	if (!team) throw new Error(`Worker runtime could not resolve team for "${agentName || teamName}".`);

	const worker = team.members.find((member) => agentName && matchesName(member.name, agentName));
	if (!worker) throw new Error(`Worker runtime could not resolve worker "${agentName}".`);

	return {
		role,
		agent: worker,
		team,
		children: [],
	};
}

function childKey(name: string): string {
	return slugify(name);
}

function ensureDir(path: string) {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function tokenizeShell(command: string): string[] {
	const tokens = command.match(/'[^']*'|"[^"]*"|\S+/g) || [];
	return tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function extractPathLikeTokens(command: string): string[] {
	return tokenizeShell(command).filter((token) => {
		if (!token || token.startsWith("-")) return false;
		if (token === "|" || token === "||" || token === "&&" || token === ";" || token === "(" || token === ")") return false;
		if (token.includes("://")) return false;
		if (/^[A-Z0-9_]+=/.test(token)) return false;
		if (token.includes("/")) return true;
		if (token.startsWith(".")) return true;
		if (token === "multi-team.yaml") return true;
		if (/\.(ts|tsx|js|jsx|json|jsonl|yaml|yml|md|txt|sh)$/i.test(token)) return true;
		return false;
	});
}

function isMutatingBash(command: string): boolean {
	return /\b(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|tee)\b/.test(command) ||
		/\bsed\s+-i\b/.test(command) ||
		/\bperl\s+-pi\b/.test(command) ||
		/\bgit\s+(checkout|restore|reset|clean|commit|push|rebase|cherry-pick|apply)\b/.test(command) ||
		/(^|[^<])>\s*[^&\s]/.test(command);
}

function isDeleteBash(command: string): boolean {
	return /\b(rm|rmdir|unlink|shred)\b/.test(command) || /\bgit\s+rm\b/.test(command);
}

function normalizeDomainRules(config: ResolvedConfig, domain: DomainConfig | DomainRule[] | undefined, fallbackRead = "."): NormalizedDomainRule[] {
	const rules = Array.isArray(domain)
		? domain
		: domain?.rules && domain.rules.length > 0
		? domain.rules
		: legacyDomainToRules(domain?.read || [fallbackRead], domain?.write || []);
	return rules.map((rule, index) => ({
		path: rule.path,
		absolutePath: resolve(config.baseDir, rule.path),
		read: !!rule.read,
		upsert: !!rule.upsert,
		delete: !!rule.delete,
		index,
	}));
}

function matchingDomainRule(targetPath: string, rules: NormalizedDomainRule[]): NormalizedDomainRule | null {
	const matches = rules.filter((rule) => {
		const normalized = rule.absolutePath.endsWith("/") ? rule.absolutePath.slice(0, -1) : rule.absolutePath;
		return targetPath === normalized || targetPath.startsWith(normalized + "/");
	});
	if (matches.length === 0) return null;
	matches.sort((left, right) => {
		if (right.absolutePath.length !== left.absolutePath.length) {
			return right.absolutePath.length - left.absolutePath.length;
		}
		return right.index - left.index;
	});
	return matches[0];
}

function ruleAllows(targetPath: string, rules: NormalizedDomainRule[], permission: "read" | "upsert" | "delete"): boolean {
	const rule = matchingDomainRule(targetPath, rules);
	return rule ? !!rule[permission] : false;
}

function domainRulesSummary(config: ResolvedConfig, domain: DomainConfig | DomainRule[] | undefined): string[] {
	return normalizeDomainRules(config, domain).map((rule) =>
		`${toConfigRelative(config, rule.absolutePath)} [read:${rule.read ? "true" : "false"} upsert:${rule.upsert ? "true" : "false"} delete:${rule.delete ? "true" : "false"}]`
	);
}

function toConfigRelative(config: ResolvedConfig, targetPath: string): string {
	const rel = relative(config.baseDir, targetPath);
	return rel && rel !== "" ? rel : ".";
}

function firstUsefulLine(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !/^#+\s/.test(line));
	return lines[0] || "No concise summary returned.";
}

function stripMarkdownNoise(value: string): string {
	return value
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*/g, "")
		.replace(/__/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function isLowSignalExpertiseSummary(summary: string): boolean {
	const normalized = summary.trim().toLowerCase();
	if (!normalized) return true;
	return normalized === "1. outcome"
		|| normalized === "---"
		|| normalized === "no concise summary returned."
		|| normalized === "none."
		|| normalized === "no files changed."
		|| normalized === "blocked."
		|| normalized.startsWith("i haven't executed")
		|| normalized.startsWith("i have not executed")
		|| normalized.startsWith("delegated by ")
		|| normalized.startsWith("return format:")
		|| normalized.includes("no concise summary returned");
}

function summarizeTaskForExpertise(task: string): string {
	const normalized = stripMarkdownNoise(task);
	const firstSentence = normalized.split(/\.(\s|$)|\n/)[0]?.trim() || normalized;
	return shortText(firstSentence, 140);
}

function buildExpertiseObservation(task: string, output: string): string | null {
	const summary = stripMarkdownNoise(firstUsefulLine(output));
	if (isLowSignalExpertiseSummary(summary)) return null;
	const taskSummary = summarizeTaskForExpertise(task);
	const note = taskSummary
		? `${taskSummary} -> ${summary}`
		: summary;
	return shortText(note, EXPERTISE_NOTE_MAX_CHARS);
}

function newSessionId(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const rand = Math.random().toString(36).slice(2, 8);
	return `${stamp}-${rand}`;
}

function collectTextFragments(value: any, output: string[], depth = 0) {
	if (value === null || value === undefined || depth > 5) return;
	if (typeof value === "string") {
		const text = value.trim();
		if (text) output.push(text);
		return;
	}
	if (typeof value === "number" || typeof value === "boolean") return;
	if (Array.isArray(value)) {
		for (const item of value) collectTextFragments(item, output, depth + 1);
		return;
	}
	if (typeof value !== "object") return;

	const object = value as Record<string, any>;
	if (object.type === "text" && typeof object.text === "string") {
		const text = object.text.trim();
		if (text) output.push(text);
	}

	for (const key of ["text", "content", "message", "messages", "input", "prompt", "task", "query", "delta"]) {
		if (key in object) collectTextFragments(object[key], output, depth + 1);
	}
}

function extractStructuredText(value: any): string {
	const fragments: string[] = [];
	collectTextFragments(value, fragments);
	const seen = new Set<string>();
	const unique = fragments.filter((fragment) => {
		if (seen.has(fragment)) return false;
		seen.add(fragment);
		return true;
	});
	return unique.join("\n\n").trim();
}

function extractAssistantMessageText(messages: any[]): string {
	const assistantMessages = Array.isArray(messages) ? messages.filter((message) => message?.role === "assistant") : [];
	const texts = assistantMessages
		.map((message) => extractStructuredText(message))
		.filter(Boolean);
	return texts.length > 0 ? texts[texts.length - 1] : "";
}

function artifactFileName(parts: string[], extension = "md"): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const slug = parts
		.map((part) => slugify(part))
		.filter(Boolean)
		.join("-");
	return `${stamp}-${slug || "artifact"}.${extension.replace(/^\./, "")}`;
}

function yamlScalar(value: any): string {
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null || value === undefined) return '""';
	const text = String(value);
	return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stringifyYaml(value: any, indent = 0): string {
	const pad = " ".repeat(indent);

	if (Array.isArray(value)) {
		if (value.length === 0) return `${pad}[]`;
		return value.map((item) => {
			if (item && typeof item === "object" && !Array.isArray(item)) {
				const entries = Object.entries(item);
				if (entries.length === 0) return `${pad}- {}`;
				const [firstKey, firstValue] = entries[0];
				const firstLine = typeof firstValue === "object" && firstValue !== null
					? `${pad}- ${firstKey}:`
					: `${pad}- ${firstKey}: ${yamlScalar(firstValue)}`;
				const restLines: string[] = [];
				if (typeof firstValue === "object" && firstValue !== null) {
					restLines.push(stringifyYaml(firstValue, indent + 4));
				}
				for (const [key, child] of entries.slice(1)) {
					if (typeof child === "object" && child !== null) {
						restLines.push(`${" ".repeat(indent + 2)}${key}:`);
						restLines.push(stringifyYaml(child, indent + 4));
					} else {
						restLines.push(`${" ".repeat(indent + 2)}${key}: ${yamlScalar(child)}`);
					}
				}
				return [firstLine, ...restLines].join("\n");
			}
			return `${pad}- ${yamlScalar(item)}`;
		}).join("\n");
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) return `${pad}{}`;
		return entries.map(([key, child]) => {
			if (Array.isArray(child)) {
				return child.length === 0
					? `${pad}${key}: []`
					: `${pad}${key}:\n${stringifyYaml(child, indent + 2)}`;
			}
			if (child && typeof child === "object") {
				return `${pad}${key}:\n${stringifyYaml(child, indent + 2)}`;
			}
			return `${pad}${key}: ${yamlScalar(child)}`;
		}).join("\n");
	}

	return `${pad}${yamlScalar(value)}`;
}

export default function (pi: ExtensionAPI) {
	let config: ResolvedConfig | null = null;
	let runtime: RuntimeState | null = null;
	let widgetCtx: any;
	let sessionId = "";
	let sessionRoot = "";
	let toolCallSequence = 0;
	const pendingToolCalls: PendingToolCall[] = [];
	const cards = new Map<string, CardState>();
	const childProcesses = new Map<string, ChildProcessWithoutNullStreams>();

	function currentSessionId(): string {
		return process.env.PI_MULTI_SESSION_ID?.trim() || sessionId;
	}

	function currentSessionRoot(): string {
		return process.env.PI_MULTI_SESSION_ROOT?.trim() || sessionRoot;
	}

	function currentDepth(): number {
		return Number(process.env.PI_MULTI_DEPTH || "0") || 0;
	}

	function currentParentAgent(): string | null {
		const parent = process.env.PI_MULTI_PARENT?.trim();
		return parent || null;
	}

	function sessionPath(...parts: string[]): string {
		return resolve(currentSessionRoot(), ...parts);
	}

	function sessionProcessInfo() {
		return {
			pid: process.pid,
			agent: runtime?.agent.name || null,
			agentRole: runtime?.role || null,
			agentTeam: runtime?.team?.name || null,
			parentAgent: currentParentAgent(),
			depth: currentDepth(),
		};
	}

	function appendJsonl(relativePath: string, payload: Record<string, unknown>) {
		appendFileSync(sessionPath(relativePath), JSON.stringify(payload) + "\n");
	}

	function mutateSessionIndex(mutator: (index: any) => void) {
		if (!config) return;
		const indexPath = sessionPath("session_index.json");
		const now = new Date().toISOString();
		let index: any = {
			sessionId: currentSessionId(),
			system: config.name,
			configPath: config.configPath,
			root: currentSessionRoot(),
			createdAt: now,
			updatedAt: now,
			status: "running",
			processes: [],
			counts: {
				conversation: 0,
				tool_calls: 0,
				artifacts: 0,
				delegations: 0,
				blocked_tools: 0,
			},
		};

		if (existsSync(indexPath)) {
			try {
				index = {
					...index,
					...JSON.parse(safeReadText(indexPath)),
				};
				index.counts = {
					...index.counts,
					...(index.counts || {}),
				};
				index.processes = Array.isArray(index.processes) ? index.processes : [];
			} catch {}
		}

		mutator(index);
		index.updatedAt = now;
		writeFileSync(indexPath, JSON.stringify(index, null, 2));
	}

	function appendConversation(role: "user" | "assistant" | "system", text: string, extra: Record<string, unknown> = {}) {
		if (!runtime) return;
		const normalized = text.trim();
		if (!normalized) return;
		appendJsonl("conversation.jsonl", {
			type: "message",
			at: new Date().toISOString(),
			sessionId: currentSessionId(),
			role,
			text: normalized,
			preview: shortText(normalized, 240),
			...sessionProcessInfo(),
			...extra,
		});
		mutateSessionIndex((index) => {
			index.counts.conversation = (index.counts.conversation || 0) + 1;
		});
	}

	function appendToolCallEntry(payload: Record<string, unknown>) {
		appendJsonl("tool_calls.jsonl", {
			type: "tool_call",
			at: new Date().toISOString(),
			sessionId: currentSessionId(),
			...sessionProcessInfo(),
			...payload,
		});
	}

	function createPendingToolCall(event: any): PendingToolCall {
		const pending: PendingToolCall = {
			callId: `${process.pid}-${Date.now()}-${++toolCallSequence}`,
			toolName: event.toolName,
			input: event.input,
			startedAt: new Date().toISOString(),
		};
		pendingToolCalls.push(pending);
		appendToolCallEntry({
			callId: pending.callId,
			phase: "attempt",
			toolName: pending.toolName,
			input: pending.input,
		});
		mutateSessionIndex((index) => {
			index.counts.tool_calls = (index.counts.tool_calls || 0) + 1;
		});
		return pending;
	}

	function removePendingToolCall(callId: string): PendingToolCall | null {
		const index = pendingToolCalls.findIndex((pending) => pending.callId === callId);
		if (index === -1) return null;
		return pendingToolCalls.splice(index, 1)[0] || null;
	}

	function resolvePendingToolCall(toolName: string): PendingToolCall | null {
		const index = pendingToolCalls.findIndex((pending) => pending.toolName === toolName);
		if (index === -1) return null;
		return pendingToolCalls.splice(index, 1)[0] || null;
	}

	function blockPendingToolCall(pending: PendingToolCall | null, reason: string) {
		if (!pending) return;
		removePendingToolCall(pending.callId);
		appendToolCallEntry({
			callId: pending.callId,
			phase: "blocked",
			toolName: pending.toolName,
			input: pending.input,
			reason,
		});
		mutateSessionIndex((index) => {
			index.counts.blocked_tools = (index.counts.blocked_tools || 0) + 1;
		});
	}

	function completePendingToolCall(event: any) {
		const pending = resolvePendingToolCall(event.toolName);
		const resultText = extractStructuredText(event.result || event.details || event);
		const status = event.result?.details?.status || event.details?.status || event.status || "done";
		appendToolCallEntry({
			callId: pending?.callId || `${process.pid}-${Date.now()}-${++toolCallSequence}`,
			phase: "completed",
			toolName: event.toolName,
			input: pending?.input,
			status,
			summary: shortText(resultText || JSON.stringify(event.result?.details || event.details || {}), 240),
			result: event.result?.details || event.details || null,
		});
	}

	function persistArtifact(kind: string, label: string, content: string, metadata: Record<string, unknown> = {}) {
		if (!runtime) return "";
		const fileName = artifactFileName([runtime.agent.name, kind, label]);
		const fullPath = sessionPath("artifacts", fileName);
		const relativePath = relative(currentSessionRoot(), fullPath);
		writeFileSync(fullPath, content);
		appendJsonl("artifacts/index.jsonl", {
			type: "artifact",
			at: new Date().toISOString(),
			sessionId: currentSessionId(),
			kind,
			label,
			path: relativePath,
			...sessionProcessInfo(),
			...metadata,
		});
		mutateSessionIndex((index) => {
			index.counts.artifacts = (index.counts.artifacts || 0) + 1;
		});
		return relativePath;
	}

	function ensureSessionLayout() {
		if (!config) return;
		sessionId = currentSessionId() || newSessionId();
		sessionRoot = currentSessionRoot() || resolve(config.sessionDirAbs, sessionId);
		ensureDir(config.sessionDirAbs);
		ensureDir(config.expertiseDirAbs);
		ensureDir(sessionRoot);
		ensureDir(resolve(sessionRoot, "jsonl"));
		ensureDir(resolve(sessionRoot, "state"));
		ensureDir(resolve(sessionRoot, "artifacts"));
		for (const file of ["events.jsonl", "conversation.jsonl", "tool_calls.jsonl"]) {
			const path = resolve(sessionRoot, file);
			if (!existsSync(path)) writeFileSync(path, "");
		}
		const artifactIndex = resolve(sessionRoot, "artifacts", "index.jsonl");
		if (!existsSync(artifactIndex)) writeFileSync(artifactIndex, "");

		const manifestPath = resolve(sessionRoot, "manifest.json");
		if (!existsSync(manifestPath)) {
			writeFileSync(manifestPath, JSON.stringify({
				sessionId,
				system: config.name,
				configPath: config.configPath,
				root: sessionRoot,
				files: {
					index: "session_index.json",
					conversation: "conversation.jsonl",
					toolCalls: "tool_calls.jsonl",
					events: "events.jsonl",
					artifacts: "artifacts/",
					state: "state/",
					rawJsonl: "jsonl/",
				},
				createdAt: new Date().toISOString(),
			}, null, 2));
		}
	}

	function appendEvent(type: string, payload: Record<string, unknown>) {
		if (!runtime) return;
		const line = {
			type,
			at: new Date().toISOString(),
			sessionId: currentSessionId(),
			role: runtime.role,
			agent: runtime.agent.name,
			team: runtime.team?.name || null,
			...payload,
		};
		appendJsonl("events.jsonl", line);
	}

	function expertisePathFor(agent: AgentConfig): string {
		if (!config) return "";
		const expertise = effectiveExpertise(config, agent);
		return expertise?.path
			? resolveArtifact(config.baseDir, expertise.path)
			: resolve(config.expertiseDirAbs, `${slugify(agent.name)}-mental-model.yaml`);
	}

	function expertiseMeta(agent: AgentConfig): ExpertiseReference {
		if (!config) {
			return {
				path: `.pi/expertise/${slugify(agent.name)}-mental-model.yaml`,
				updatable: true,
				maxLines: DEFAULT_EXPERTISE_MAX_LINES,
			};
		}
		const expertise = effectiveExpertise(config, agent);
		return {
			path: expertise?.path || `.pi/expertise/${slugify(agent.name)}-mental-model.yaml`,
			useWhen: expertise?.useWhen,
			updatable: expertise?.updatable ?? true,
			maxLines: expertise?.maxLines || DEFAULT_EXPERTISE_MAX_LINES,
		};
	}

	function expertiseIdentity(agent: AgentConfig): { role: RuntimeRole; team: string } {
		if (config) {
			if (matchesName(config.orchestrator.name, agent.name)) {
				return { role: "orchestrator", team: "global" };
			}
			for (const team of config.teams) {
				if (matchesName(team.lead.name, agent.name)) {
					return { role: "lead", team: team.name };
				}
				if (team.members.some((member) => matchesName(member.name, agent.name))) {
					return { role: "worker", team: team.name };
				}
			}
		}

		return {
			role: runtime?.role || "worker",
			team: runtime?.team?.name || "global",
		};
	}

	function defaultExpertiseDocument(agent: AgentConfig): ExpertiseDocument {
		const identity = expertiseIdentity(agent);
		const meta = expertiseMeta(agent);
		return {
			agent: {
				name: agent.name,
				role: identity.role,
				team: identity.team,
			},
			meta: {
				version: 1,
				max_lines: meta.maxLines || DEFAULT_EXPERTISE_MAX_LINES,
				last_updated: new Date().toISOString(),
			},
			patterns: [],
			risks: [],
			tools: [],
			workflows: [],
			decisions: [],
			lessons: [],
			observations: [],
			open_questions: [],
		};
	}

	function loadExpertiseDocument(agent: AgentConfig): ExpertiseDocument {
		const path = expertisePathFor(agent);
		if (!path || !existsSync(path)) return defaultExpertiseDocument(agent);
		const raw = safeReadText(path).trim();
		if (!raw) return defaultExpertiseDocument(agent);

		try {
			const parsed = parseYamlSubset(raw) as Partial<ExpertiseDocument>;
			const base = defaultExpertiseDocument(agent);
			const merged = {
				...parsed,
				agent: {
					...base.agent,
					...(parsed.agent || {}),
				},
				meta: {
					...base.meta,
					...(parsed.meta || {}),
				},
				patterns: Array.isArray(parsed.patterns) ? parsed.patterns as ExpertiseEntry[] : base.patterns,
				risks: Array.isArray(parsed.risks) ? parsed.risks as ExpertiseEntry[] : base.risks,
				tools: Array.isArray(parsed.tools) ? parsed.tools as ExpertiseEntry[] : base.tools,
				workflows: Array.isArray(parsed.workflows) ? parsed.workflows as ExpertiseEntry[] : base.workflows,
				decisions: Array.isArray(parsed.decisions) ? parsed.decisions as ExpertiseEntry[] : base.decisions,
				lessons: Array.isArray(parsed.lessons) ? parsed.lessons as ExpertiseEntry[] : base.lessons,
				observations: Array.isArray(parsed.observations) ? parsed.observations as ExpertiseEntry[] : base.observations,
				open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions as ExpertiseEntry[] : base.open_questions,
			} as ExpertiseDocument;
			return merged;
		} catch {
			return defaultExpertiseDocument(agent);
		}
	}

	function expertiseCategoryKey(category?: string): string {
		const normalized = (category || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
		switch (normalized) {
			case "pattern":
			case "patterns":
				return "patterns";
			case "risk":
			case "risks":
				return "risks";
			case "tool":
			case "tools":
				return "tools";
			case "workflow":
			case "workflows":
				return "workflows";
			case "decision":
			case "decisions":
				return "decisions";
			case "lesson":
			case "lessons":
				return "lessons";
			case "observation":
			case "observations":
				return "observations";
			case "open_question":
			case "open_questions":
			case "question":
			case "questions":
				return "open_questions";
			default:
				return normalized || "observations";
		}
	}

	function renderExpertiseDocument(doc: ExpertiseDocument): string {
		return stringifyYaml(doc) + "\n";
	}

	function enforceExpertiseLineLimit(doc: ExpertiseDocument): ExpertiseDocument {
		const maxLines = doc.meta.max_lines || DEFAULT_EXPERTISE_MAX_LINES;
		const preferredTrimOrder = [
			"observations",
			"open_questions",
			"lessons",
			"patterns",
			"tools",
			"workflows",
			"decisions",
			"risks",
		];
		const dynamicSections = Object.keys(doc).filter((key) =>
			key !== "agent" &&
			key !== "meta" &&
			Array.isArray(doc[key]) &&
			!preferredTrimOrder.includes(key)
		);
		const trimOrder = [...preferredTrimOrder, ...dynamicSections];

		while (renderExpertiseDocument(doc).split("\n").length > maxLines) {
			const key = trimOrder.find((section) => Array.isArray(doc[section]) && doc[section].length > 0);
			if (!key) break;
			doc[key].shift();
		}

		return doc;
	}

	function saveExpertiseDocument(agent: AgentConfig, doc: ExpertiseDocument) {
		const path = expertisePathFor(agent);
		if (!path) return;
		doc.meta.last_updated = new Date().toISOString();
		writeFileSync(path, renderExpertiseDocument(enforceExpertiseLineLimit(doc)));
	}

	function ensureExpertiseFile(agent: AgentConfig) {
		const path = expertisePathFor(agent);
		if (!path) return;
		if (!existsSync(path)) {
			saveExpertiseDocument(agent, defaultExpertiseDocument(agent));
		}
	}

	function updateExpertise(agent: AgentConfig, task: string, output: string) {
		if (!expertiseMeta(agent).updatable) return;
		ensureExpertiseFile(agent);
		const doc = loadExpertiseDocument(agent);
		const note = buildExpertiseObservation(task, output);
		if (!note) return;
		doc.observations.push({
			date: new Date().toISOString().slice(0, 10),
			note,
		});
		saveExpertiseDocument(agent, doc);
		appendEvent("expertise_update", {
			target: agent.name,
			path: expertisePathFor(agent),
			note,
		});
	}

	function appendMentalModelNote(agent: AgentConfig, note: string, category?: string) {
		if (!expertiseMeta(agent).updatable) return;
		ensureExpertiseFile(agent);
		const doc = loadExpertiseDocument(agent);
		const key = expertiseCategoryKey(category);
		if (!Array.isArray(doc[key])) {
			doc[key] = [];
		}
		const normalizedNote = shortText(note, EXPERTISE_NOTE_MAX_CHARS);
		doc[key].push({
			date: new Date().toISOString().slice(0, 10),
			note: normalizedNote,
		});
		saveExpertiseDocument(agent, doc);
		appendEvent("mental_model_update", {
			target: agent.name,
			path: expertisePathFor(agent),
			category: category || null,
			note: normalizedNote,
		});
	}

	function loadPromptBundle(agent: AgentConfig): string {
		if (!config || !runtime) return "";
		const sections: string[] = [];
		const promptDef = getPromptDefinition(config, agent);
		const declaredSkillRefs = effectiveSkillRefs(config, agent);
		const declaredSkills = declaredSkillRefs.map((skill) => skill.path);
		const declaredTools = normalizeTools(effectiveTools(config, agent), runtime.role);
		const declaredDomain = effectiveDomain(config, agent);
		const declaredExpertise = expertiseMeta(agent);
		const declaredModel = effectiveModel(config, agent);

		sections.push(promptDef.body || `Prompt file missing: ${agent.prompt}`);

		const skillBodies = declaredSkillRefs.map((skillRef) => {
			const fullPath = resolveArtifact(config.baseDir, skillRef.path);
			const raw = safeReadText(fullPath);
			const label = basename(fullPath);
			const useWhen = skillRef.useWhen ? `Use when: ${skillRef.useWhen}\n\n` : "";
			return raw
				? `## Skill: ${label}\n${useWhen}${stripFrontmatter(raw)}`
				: `## Skill: ${label}\n${useWhen}Missing skill file: ${skillRef.path}`;
		});
		if (skillBodies.length > 0) {
			sections.push(skillBodies.join("\n\n"));
		}

		ensureExpertiseFile(agent);
		const expertiseBody = safeReadText(expertisePathFor(agent));
		if (expertiseBody) {
			sections.push(`## Persistent Expertise\n${stripFrontmatter(expertiseBody)}`);
		}

		const domainSummary = domainRulesSummary(config, declaredDomain);
		const contractText = [
			`## Agent Contract`,
			`Declared model: ${declaredModel || "(inherit current session model)"}`,
			`Declared tools: ${declaredTools.join(", ") || "(none)"}`,
			`Declared skills: ${declaredSkillRefs.map((skill) => skill.useWhen ? `${skill.path} [use-when: ${skill.useWhen}]` : skill.path).join(", ") || "(none)"}`,
			`Declared prompt: ${agent.prompt}`,
			`Declared expertise file: ${toConfigRelative(config, expertisePathFor(agent))}`,
			`Expertise use-when: ${declaredExpertise.useWhen || "(none)"}`,
			`Expertise updatable: ${declaredExpertise.updatable ? "true" : "false"}`,
			`Expertise max-lines: ${declaredExpertise.maxLines || DEFAULT_EXPERTISE_MAX_LINES}`,
		].join("\n");
		const domainText = [
			`## Ownership Domain`,
			...(domainSummary.length > 0 ? domainSummary : ["(none)"]),
		].join("\n");

		const runtimeLines = [
			`You are operating inside the "${config.name}" multi-agent runtime.`,
			`Current role: ${runtime.role}.`,
			`Current agent: ${displayName(agent.name)}.`,
			runtime.team ? `Current team: ${runtime.team.name}.` : "Current team: global orchestrator.",
			`Session root: ${currentSessionRoot()}.`,
			`Session id: ${currentSessionId()}.`,
			runtime.role === "orchestrator"
				? "You must coordinate only through team leads. You do not write code directly."
				: runtime.role === "lead"
				? "You must coordinate only through workers in your own team. You do not write code directly."
				: "You are the execution layer. You may use direct tools, but ownership guardrails will block paths outside your domain.",
		];

		if (runtime.role === "orchestrator") {
			const catalog = config.teams.map((team) => {
				const members = team.members.map((member) => displayName(member.name)).join(", ");
				return `- Team "${team.name}" -> lead \`${team.lead.name}\` (${members})`;
			}).join("\n");
			sections.unshift(`## Runtime Catalog\n${catalog}`);
		} else if (runtime.role === "lead" && runtime.team) {
			const catalog = runtime.team.members.map((member) => {
				const tools = normalizeTools(effectiveTools(config, member), "worker").join(", ");
				const domain = domainRulesSummary(config, effectiveDomain(config, member)).join("; ") || "(none)";
				return `- Worker \`${member.name}\` (${tools}) -> ${domain}`;
			}).join("\n");
			sections.unshift(`## Runtime Catalog\n${catalog}`);
		}

		sections.unshift(`## Runtime\n${runtimeLines.join("\n")}\n\n${contractText}\n\n${domainText}`);
		return sections.filter(Boolean).join("\n\n");
	}

	function renderCard(state: CardState, colWidth: number, theme: any): string[] {
		const width = colWidth - 2;
		const statusColor = state.status === "idle" ? "dim"
			: state.status === "running" ? "accent"
			: state.status === "done" ? "success" : "error";
		const statusIcon = state.status === "idle" ? "○"
			: state.status === "running" ? "●"
			: state.status === "done" ? "✓" : "✗";
		const roleLabel = state.role === "lead" ? "Lead" : "Worker";
		const title = theme.fg("accent", theme.bold(shortText(displayName(state.agent.name), width)));
		const meta = state.teamName
			? theme.fg("dim", shortText(`${roleLabel} · ${state.teamName}`, width))
			: theme.fg("dim", roleLabel);
		const status = theme.fg(statusColor, `${statusIcon} ${state.status}${state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : ""}`);
		const task = theme.fg("muted", shortText(state.task || state.agent.description || "idle", width));
		const last = theme.fg("dim", shortText(state.lastLine || "—", width));
		const top = "┌" + "─".repeat(width) + "┐";
		const bot = "└" + "─".repeat(width) + "┘";
		const row = (content: string, visible: string) =>
			theme.fg("dim", "│") + " " + content + " ".repeat(Math.max(0, width - 1 - visibleWidth(visible))) + theme.fg("dim", "│");

		return [
			theme.fg("dim", top),
			row(title, displayName(state.agent.name)),
			row(meta, `${roleLabel}${state.teamName ? ` · ${state.teamName}` : ""}`),
			row(status, `${statusIcon} ${state.status}${state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : ""}`),
			row(task, shortText(state.task || state.agent.description || "idle", width)),
			row(last, shortText(state.lastLine || "—", width)),
			theme.fg("dim", bot),
		];
	}

	function updateWidget() {
		if (!widgetCtx || !runtime) return;

		widgetCtx.ui.setWidget("multi-team", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);
			return {
				render(width: number): string[] {
					if (runtime.children.length === 0 || cards.size === 0) {
						text.setText(theme.fg("dim", `${displayName(runtime.agent.name)} is running as a worker. No child agents available.`));
						return text.render(width);
					}

					const items = Array.from(cards.values());
					const cols = Math.min(runtime.role === "orchestrator" ? 3 : 2, items.length);
					const gap = 1;
					const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
					const lines: string[] = [];

					for (let i = 0; i < items.length; i += cols) {
						const rowItems = items.slice(i, i + cols);
						const cardRows = rowItems.map((item) => renderCard(item, colWidth, theme));
						while (cardRows.length < cols) cardRows.push(Array(7).fill(" ".repeat(colWidth)));
						for (let row = 0; row < cardRows[0].length; row++) {
							lines.push(cardRows.map((card) => card[row] || "").join(" ".repeat(gap)));
						}
					}

					text.setText(lines.join("\n"));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	function initCards() {
		if (!runtime) return;
		cards.clear();
		for (const child of runtime.children) {
			const teamName = runtime.role === "orchestrator"
				? config?.teams.find((team) => matchesName(team.lead.name, child.name))?.name
				: runtime.team?.name;
			cards.set(childKey(child.name), {
				agent: child,
				role: runtime.role === "orchestrator" ? "lead" : "worker",
				teamName,
				status: "idle",
				task: "",
				lastLine: "",
				elapsed: 0,
				runCount: 0,
			});
		}
	}

	function resolveTarget(targetName: string): DispatchTarget | null {
		if (!config || !runtime) return null;

		if (runtime.role === "orchestrator") {
			const team = config.teams.find((item) =>
				matchesName(item.name, targetName) || matchesName(item.lead.name, targetName)
			);
			return team ? { agent: team.lead, role: "lead", team } : null;
		}

		if (runtime.role === "lead" && runtime.team) {
			const worker = runtime.team.members.find((member) => matchesName(member.name, targetName));
			return worker ? { agent: worker, role: "worker", team: runtime.team } : null;
		}

		return null;
	}

	function availableTargetsText(): string {
		if (!runtime || !config) return "";
		if (runtime.role === "orchestrator") {
			return config.teams.map((team) => `${team.name} (${team.lead.name})`).join(", ");
		}
		if (runtime.role === "lead" && runtime.team) {
			return runtime.team.members.map((member) => member.name).join(", ");
		}
		return "(none)";
	}

	function currentModel(ctx: any, fallback?: string): string | null {
		if (fallback && fallback !== "inherit") return fallback;
		if (ctx.model?.provider && ctx.model?.id) return `${ctx.model.provider}/${ctx.model.id}`;
		if (ctx.model?.id) return ctx.model.id;
		return null;
	}

	function buildDelegationPrompt(target: DispatchTarget, task: string): string {
		const parentLabel = `${displayName(runtime!.agent.name)} (${runtime!.role})`;
		const targetRole = target.role === "lead" ? `team lead for ${target.team?.name}` : `worker in ${target.team?.name}`;
		const lines = [
			`Delegated by ${parentLabel} inside the "${config!.name}" multi-agent runtime.`,
			`You are acting as ${targetRole}.`,
			`Session id: ${currentSessionId()}.`,
			`Parent depth: ${currentDepth()}.`,
			"",
			"Task:",
			task,
			"",
			"Return:",
			"1. Outcome",
			"2. Files changed",
			"3. Verification or evidence",
			"4. Risks or blockers",
		];
		if (target.role === "worker") {
			lines.push(
				"",
				"Rules:",
				"- Execute the repo work needed in this turn.",
				"- Do not claim success without concrete operations or verification.",
				"- If blocked, report the blocker directly and stop.",
			);
		}
		return lines.join("\n");
	}

	function outputSignalsNoExecution(output: string): boolean {
		const text = output.toLowerCase();
		return text.includes("did not execute in this turn")
			|| text.includes("didn't execute in this turn")
			|| text.includes("without executing")
			|| text.includes("no operations were executed")
			|| text.includes("no commands were executed")
			|| text.includes("no file changes were made");
	}

	function shouldResumeChildSession(child: DispatchTarget, sessionFile: string): boolean {
		if (!existsSync(sessionFile)) return false;
		return false;
	}

	function dispatchChild(targetName: string, task: string, ctx: any): Promise<{ output: string; exitCode: number; elapsed: number; child?: DispatchTarget }> {
		if (!config || !runtime) {
			return Promise.resolve({ output: "Runtime not initialized.", exitCode: 1, elapsed: 0 });
		}
		if (runtime.role === "worker") {
			return Promise.resolve({ output: "Workers cannot delegate work.", exitCode: 1, elapsed: 0 });
		}

		const child = resolveTarget(targetName);
		if (!child) {
			return Promise.resolve({
				output: `Unknown target "${targetName}". Available: ${availableTargetsText()}`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		const card = cards.get(childKey(child.agent.name));
		if (card?.status === "running") {
			return Promise.resolve({
				output: `${displayName(child.agent.name)} is already running.`,
				exitCode: 1,
				elapsed: 0,
				child,
			});
		}

		if (card) {
			card.status = "running";
			card.task = task;
			card.lastLine = "";
			card.elapsed = 0;
			card.runCount++;
			updateWidget();
		}

		const startTime = Date.now();
		if (card) {
			card.timer = setInterval(() => {
				card.elapsed = Date.now() - startTime;
				updateWidget();
			}, 1000);
		}

		const model = currentModel(ctx, effectiveModel(config, child.agent) || child.agent.model);
		const prompt = buildDelegationPrompt(child, task);
		const extensionPath = resolve(config.baseDir, "extensions", "multi-team.ts");
		const mcpBridgePath = resolve(config.baseDir, "extensions", "mcp-bridge.ts");
		const childTools = normalizeTools(effectiveTools(config, child.agent), child.role);
		const requestedSpawnTools = child.role === "worker"
			? childTools
			: Array.from(new Set([...SAFE_LEAD_TOOLS, ...childTools]));
		const spawnTools = spawnableToolsForSpawn(requestedSpawnTools);
		const sessionFile = resolve(currentSessionRoot(), "state", `${slugify(child.agent.name)}.session.jsonl`);
		const logFile = resolve(currentSessionRoot(), "jsonl", `${Date.now()}-${slugify(runtime.agent.name)}-to-${slugify(child.agent.name)}.jsonl`);
		const resumeSession = shouldResumeChildSession(child, sessionFile);
		const args = [
			"--mode", "json",
			"-p",
			"--no-extensions",
			"-e", extensionPath,
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--thinking", "off",
			"--tools", spawnTools.join(","),
			"--session", sessionFile,
		];
		if (existsSync(mcpBridgePath)) args.splice(6, 0, "-e", mcpBridgePath);
		if (resumeSession) args.push("-c");
		if (model) args.push("--model", model);
		args.push(prompt);

		appendEvent("delegate_start", {
			target: child.agent.name,
			targetRole: child.role,
			targetTeam: child.team?.name || null,
			task,
			logFile,
			sessionFile,
			resumeSession,
		});
		appendConversation(
			"system",
			`Delegation from ${runtime.agent.name} to ${child.agent.name} (${child.role}${child.team ? ` / ${child.team.name}` : ""})\n\n${task}`,
			{
				source: "delegation",
				targetAgent: child.agent.name,
				targetRole: child.role,
				targetTeam: child.team?.name || null,
			},
		);
		mutateSessionIndex((index) => {
			index.counts.delegations = (index.counts.delegations || 0) + 1;
		});

		const textChunks: string[] = [];

		return new Promise((resolvePromise) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					PI_MULTI_CONFIG: config!.configPath,
					PI_MULTI_ROLE: child.role,
					PI_MULTI_AGENT: child.agent.name,
					PI_MULTI_TEAM: child.team?.name || "",
					PI_MULTI_SESSION_ID: currentSessionId(),
					PI_MULTI_SESSION_ROOT: currentSessionRoot(),
					PI_MULTI_PARENT: runtime!.agent.name,
					PI_MULTI_DEPTH: String(currentDepth() + 1),
				},
			});
			childProcesses.set(child.agent.name, proc);

			let buffer = "";
			const toolCalls: string[] = [];

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					appendFileSync(logFile, line + "\n");
					try {
						const event = JSON.parse(line);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "toolcall_start") {
								const toolName = delta.partial?.content?.[delta.contentIndex || 0]?.name
									|| event.message?.content?.[delta.contentIndex || 0]?.name
									|| "";
								if (toolName) toolCalls.push(toolName);
							}
							if (delta?.type === "text_delta") {
								textChunks.push(delta.delta || "");
								if (card) {
									const full = textChunks.join("");
									card.lastLine = full.split("\n").filter((row: string) => row.trim()).pop() || "";
									updateWidget();
								}
							}
						}
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", (chunk: string) => {
				appendFileSync(logFile, JSON.stringify({
					type: "stderr",
					at: new Date().toISOString(),
					data: chunk,
				}) + "\n");
			});

			proc.on("close", (code) => {
				childProcesses.delete(child.agent.name);
				if (buffer.trim()) {
					appendFileSync(logFile, buffer.trim() + "\n");
					try {
						const event = JSON.parse(buffer.trim());
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") textChunks.push(delta.delta || "");
						}
					} catch {}
				}

				if (card?.timer) clearInterval(card.timer);
				const elapsed = Date.now() - startTime;
				const output = textChunks.join("");
				const outputTrimmed = output.trim();
				const realToolCalls = toolCalls.filter((tool) => tool && tool !== "update_mental_model");
				const executionPostureFailure = child.role === "worker"
					&& realToolCalls.length === 0
					&& (outputTrimmed.length === 0 || outputSignalsNoExecution(output));
				const effectiveExitCode = executionPostureFailure
					? (code === 0 || code === null ? 2 : code ?? 2)
					: (code ?? 1);
				const effectiveOutput = executionPostureFailure
					? [
						output || "(empty)",
						"",
						"[Runtime] Worker returned without any concrete tool execution in this turn.",
						`[Runtime] Detected tool calls: ${toolCalls.join(", ") || "(none)"}`,
						`[Runtime] Resumed prior session: ${resumeSession ? "yes" : "no"}`,
					].join("\n")
					: output;

				if (card) {
					card.elapsed = elapsed;
					card.status = effectiveExitCode === 0 ? "done" : "error";
					card.lastLine = effectiveOutput.split("\n").filter((line) => line.trim()).pop() || "";
					updateWidget();
				}

				if (effectiveExitCode === 0) {
					updateExpertise(child.agent, task, effectiveOutput);
				}

					const artifactPath = persistArtifact(
						"delegation-result",
						child.agent.name,
						[
								`# Delegation Result`,
								``,
								`- Target: ${child.agent.name}`,
								`- Target role: ${child.role}`,
								`- Team: ${child.team?.name || "global"}`,
								`- Exit code: ${effectiveExitCode}`,
								`- Elapsed: ${Math.round(elapsed / 1000)}s`,
								`- Tool calls: ${toolCalls.join(", ") || "(none)"}`,
								``,
								`## Task`,
								``,
								task,
								``,
								`## Output`,
								``,
								effectiveOutput || "(empty)",
							].join("\n"),
							{
								target: child.agent.name,
								targetRole: child.role,
								targetTeam: child.team?.name || null,
								exitCode: effectiveExitCode,
								toolCalls,
								executionPostureFailure,
							},
						);

						appendEvent("delegate_end", {
							target: child.agent.name,
							targetRole: child.role,
							exitCode: effectiveExitCode,
							elapsed,
							summary: shortText(firstUsefulLine(effectiveOutput), 200),
							artifactPath,
							toolCalls,
							executionPostureFailure,
						});

					resolvePromise({
						output: effectiveOutput,
						exitCode: effectiveExitCode,
						elapsed,
						child,
					});
			});

			proc.on("error", (err) => {
				childProcesses.delete(child.agent.name);
				if (card?.timer) clearInterval(card.timer);
				if (card) {
					card.status = "error";
					card.lastLine = `Spawn error: ${err.message}`;
					card.elapsed = Date.now() - startTime;
					updateWidget();
				}
					appendEvent("delegate_error", {
						target: child.agent.name,
						error: err.message,
					});
					persistArtifact(
						"delegation-error",
						child.agent.name,
						`Error spawning ${child.agent.name}: ${err.message}\n`,
						{
							target: child.agent.name,
							targetRole: child.role,
							targetTeam: child.team?.name || null,
						},
					);
					resolvePromise({
						output: `Error spawning ${child.agent.name}: ${err.message}`,
					exitCode: 1,
					elapsed: Date.now() - startTime,
					child,
				});
			});
		});
	}

	function protectWorkerPaths(event: any, ctx: any, pending: PendingToolCall | null) {
		if (!config || !runtime) return { block: false };
		if (runtime.role !== "worker") return { block: false };

		const domain = effectiveDomain(config, runtime.agent);
		const domainRules = normalizeDomainRules(config, domain);

		const block = (reason: string) => {
			appendEvent("tool_blocked", {
				tool: event.toolName,
				reason,
				input: event.input,
			});
			blockPendingToolCall(pending, reason);
			ctx.abort();
			return {
				block: true,
				reason: `Blocked by multi-team ownership guardrail: ${reason}\n\nDo not retry with another path. Report the restriction and continue within your domain.`,
			};
		};

		if (isToolCallEventType("read", event) || isToolCallEventType("grep", event) || isToolCallEventType("find", event) || isToolCallEventType("ls", event)) {
			const inputPath = event.input.path ? resolve(config.baseDir, event.input.path) : config.baseDir;
			if (!ruleAllows(inputPath, domainRules, "read")) {
				return block(`read access denied for ${event.input.path || "."}`);
			}
		}

		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const inputPath = resolve(config.baseDir, event.input.path);
			if (!ruleAllows(inputPath, domainRules, "upsert")) {
				return block(`upsert access denied for ${event.input.path}`);
			}
		}

		if (isToolCallEventType("bash", event)) {
			const command = event.input.command as string;
			if (/\bsudo\b/.test(command)) {
				return block("sudo is not allowed inside worker bash.");
			}
			const pathTokens = extractPathLikeTokens(command).map((token) => resolve(config.baseDir, token));
			for (const token of pathTokens) {
				if (!ruleAllows(token, domainRules, "read")) {
					return block(`bash references path outside read scope: ${token}`);
				}
			}
			if (isMutatingBash(command)) {
				const permission: "upsert" | "delete" = isDeleteBash(command) ? "delete" : "upsert";
				for (const token of pathTokens) {
					if (!ruleAllows(token, domainRules, permission)) {
						return block(`bash ${permission} access denied for ${token}`);
					}
				}
			}
		}

		return { block: false };
	}

	pi.registerTool({
		name: "update_mental_model",
		label: "Update Mental Model",
		description: "Append a durable note to the current agent's expertise file.",
		parameters: Type.Object({
			note: Type.String({ description: "The durable insight, pattern, risk, or lesson learned." }),
			category: Type.Optional(Type.String({ description: "Optional category such as pattern, risk, tool, lesson, or workflow." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!runtime) {
				return {
					content: [{ type: "text", text: "Runtime not initialized." }],
					details: { status: "error" },
				};
			}
			if (!expertiseMeta(runtime.agent).updatable) {
				return {
					content: [{ type: "text", text: `Mental model is not updatable for ${runtime.agent.name}.` }],
					details: { status: "error", agent: runtime.agent.name },
				};
			}

			const { note, category } = params as { note: string; category?: string };
			appendMentalModelNote(runtime.agent, note, category);
			const path = config ? expertisePathFor(runtime.agent) : "";
			return {
				content: [{ type: "text", text: `Mental model updated for ${runtime.agent.name}\n${path}` }],
				details: {
					status: "done",
					agent: runtime.agent.name,
					path,
					category: category || null,
					note,
				},
			};
		},

		renderCall(args, theme) {
			const category = (args as any).category ? `[${(args as any).category}] ` : "";
			const note = shortText((args as any).note || "", 60);
			return new Text(
				theme.fg("toolTitle", theme.bold("update_mental_model ")) +
				theme.fg("accent", category) +
				theme.fg("muted", note),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? theme.fg("success", text.text) : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "delegate_agent",
		label: "Delegate Agent",
		description: "Delegate focused work to an allowed child agent. Orchestrators can target team leads. Leads can target workers in their own team.",
		parameters: Type.Object({
			target: Type.String({ description: "Target agent or team name" }),
			task: Type.String({ description: "Focused delegation task" }),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { target, task } = params as { target: string; task: string };
			if (onUpdate) {
				onUpdate({
					content: [{ type: "text", text: `Delegating to ${target}...` }],
					details: { target, task, status: "dispatching" },
				});
			}

			const result = await dispatchChild(target, task, ctx);
			const body = result.output.length > 12000
				? result.output.slice(0, 12000) + "\n\n... [truncated]"
				: result.output;
			const status = result.exitCode === 0 ? "done" : "error";
			const elapsed = Math.round(result.elapsed / 1000);
			return {
				content: [{ type: "text", text: `[${target}] ${status} in ${elapsed}s\n\n${body}` }],
				details: {
					target,
					task,
					status,
					elapsed: result.elapsed,
					exitCode: result.exitCode,
					fullOutput: result.output,
				},
			};
		},

		renderCall(args, theme) {
			const target = (args as any).target || "?";
			const task = shortText((args as any).task || "", 60);
			return new Text(
				theme.fg("toolTitle", theme.bold("delegate_agent ")) +
				theme.fg("accent", target) +
				theme.fg("dim", " — ") +
				theme.fg("muted", task),
				0,
				0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (options.isPartial || details.status === "dispatching") {
				return new Text(
					theme.fg("accent", `● ${details.target || "target"}`) +
					theme.fg("dim", " working..."),
					0,
					0,
				);
			}
			const icon = details.status === "done" ? "✓" : "✗";
			const color = details.status === "done" ? "success" : "error";
			const elapsed = Math.round((details.elapsed || 0) / 1000);
			const header = theme.fg(color, `${icon} ${details.target}`) + theme.fg("dim", ` ${elapsed}s`);
			if (options.expanded && details.fullOutput) {
				const output = details.fullOutput.length > 4000
					? details.fullOutput.slice(0, 4000) + "\n... [truncated]"
					: details.fullOutput;
				return new Text(header + "\n" + theme.fg("muted", output), 0, 0);
			}
			return new Text(header, 0, 0);
		},
	});

	pi.registerCommand("multi-team", {
		description: "Show current multi-team runtime context",
		handler: async (_args, ctx) => {
			if (!config || !runtime) {
				ctx.ui.notify("Multi-team runtime not initialized.", "warning");
				return;
			}
			const tools = normalizeTools(effectiveTools(config, runtime.agent), runtime.role).join(", ");
			const skills = effectiveSkillRefs(config, runtime.agent)
				.map((skill) => skill.useWhen ? `${skill.path} [use-when: ${skill.useWhen}]` : skill.path)
				.join(", ") || "(none)";
			const domain = effectiveDomain(config, runtime.agent);
			const summary = [
				`System: ${config.name}`,
				`Role: ${runtime.role}`,
				`Agent: ${runtime.agent.name}`,
				`Team: ${runtime.team?.name || "(orchestrator)"}`,
				`Model: ${effectiveModel(config, runtime.agent) || "(inherit current session model)"}`,
				`Tools: ${tools}`,
				`Skills: ${skills}`,
				`Expertise: ${toConfigRelative(config, expertisePathFor(runtime.agent))}`,
				`Domain: ${domainRulesSummary(config, domain).join("; ") || "(none)"}`,
				`Session: ${currentSessionId()}`,
				`Children: ${runtime.children.map((child) => child.name).join(", ") || "(none)"}`,
				`Config: ${config.configPath}`,
			].join("\n");
			ctx.ui.notify(summary, "info");
		},
	});

	pi.registerCommand("multi-team-tree", {
		description: "Print the configured multi-team hierarchy",
		handler: async (_args, ctx) => {
			if (!config) {
				ctx.ui.notify("Multi-team config not loaded.", "warning");
				return;
			}
			const lines = [
				`${config.name}`,
				`orchestrator -> ${config.orchestrator.name} [${normalizeTools(effectiveTools(config, config.orchestrator), "orchestrator").join(", ")}]`,
			];
			for (const team of config.teams) {
				lines.push(`team:${team.name} -> ${team.lead.name} [${normalizeTools(effectiveTools(config, team.lead), "lead").join(", ")}]`);
				for (const member of team.members) {
					const tools = normalizeTools(effectiveTools(config, member), "worker").join(", ");
					const domain = domainRulesSummary(config, effectiveDomain(config, member)).join("; ") || "(none)";
					lines.push(`  member -> ${member.name} [${tools}] ${domain}`);
				}
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("stop", {
		description: "Stop running multi-team child agents and return to idle",
		handler: async (args, ctx) => {
			if (!runtime) {
				ctx.ui.notify("Multi-team runtime not initialized.", "warning");
				return;
			}

			const target = args?.trim().toLowerCase();
			const running = Array.from(childProcesses.entries());
			if (running.length === 0) {
				ctx.ui.notify("No running child agents.", "info");
				return;
			}

			const shouldStop = (name: string) =>
				!target || target === "all" || name.toLowerCase() === target;

			let stopped = 0;
			for (const [name, proc] of running) {
				if (!shouldStop(name)) continue;
				try {
					proc.kill("SIGTERM");
				} catch {}
				childProcesses.delete(name);
				stopped++;

				const card = cards.get(childKey(name));
				if (card && card.status === "running") {
					card.status = "error";
					card.lastLine = "Stopped by /stop";
					updateWidget();
				}
			}

			appendEvent("delegate_stop", {
				target: target || "all",
				stopped,
			});

			const label = target ? `target "${target}"` : "all running agents";
			ctx.ui.notify(`Stopped ${stopped} child process(es) for ${label}.`, stopped ? "info" : "warning");
		},
	});

	pi.on("input", async (event, _ctx) => {
		if (!runtime) {
			return { action: "continue" as const };
		}
		const text = extractStructuredText((event as any).message || (event as any).content || (event as any).input || (event as any).text || event);
		if (text) {
			appendConversation("user", text, {
				source: currentParentAgent() ? "delegation" : "user",
			});
		}
		return { action: "continue" as const };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!runtime) return { block: false };
		const pending = createPendingToolCall(event);
		const allowedTools = config ? normalizeTools(effectiveTools(config, runtime.agent), runtime.role) : [];
		if (runtime.role !== "worker" && !allowedTools.includes(event.toolName)) {
			appendEvent("tool_blocked", {
				tool: event.toolName,
				reason: "Non-worker attempted direct tool usage.",
			});
			blockPendingToolCall(pending, "Non-worker attempted direct tool usage.");
			ctx.abort();
			return {
				block: true,
				reason: `Tool "${event.toolName}" is outside this agent's declared contract. Allowed tools: ${allowedTools.join(", ") || "(none)"}.`,
			};
		}
		const guard = protectWorkerPaths(event, ctx, pending);
		if (guard.block) return guard;
		appendToolCallEntry({
			callId: pending.callId,
			phase: "started",
			toolName: pending.toolName,
			input: pending.input,
		});
		return { block: false };
	});

	pi.on("tool_execution_end", async (event) => {
		if (!runtime) return;
		completePendingToolCall(event);
	});

	pi.on("before_agent_start", async (_event, _ctx) => {
		if (!config || !runtime) return {};
		return { systemPrompt: loadPromptBundle(runtime.agent) };
	});

	pi.on("agent_end", async (event, _ctx) => {
		if (!runtime) return;
		const assistantText = extractAssistantMessageText(event.messages || []);
		if (assistantText) {
			appendConversation("assistant", assistantText, {
				source: "assistant",
			});
			if (currentDepth() === 0) {
				persistArtifact(
					"final-response",
					`${runtime.agent.name}-final`,
					assistantText,
					{ agent: runtime.agent.name, role: runtime.role },
				);
			}
		}
		mutateSessionIndex((index) => {
			const processKey = `${process.pid}:${runtime.agent.name}`;
			index.processes = Array.isArray(index.processes) ? index.processes : [];
			const existing = index.processes.find((item: any) => item.key === processKey);
			if (existing) {
				existing.endedAt = new Date().toISOString();
				existing.status = "done";
			}
			if (currentDepth() === 0) {
				index.status = "done";
				index.completedAt = new Date().toISOString();
				index.finalAgent = runtime.agent.name;
				index.finalPreview = shortText(assistantText || "", 240);
			}
		});
	});

	pi.on("session_shutdown", async () => {
		if (!runtime) return;
		mutateSessionIndex((index) => {
			const processKey = `${process.pid}:${runtime!.agent.name}`;
			index.processes = Array.isArray(index.processes) ? index.processes : [];
			const existing = index.processes.find((item: any) => item.key === processKey);
			if (existing && !existing.endedAt) {
				existing.endedAt = new Date().toISOString();
				existing.status = existing.status || "shutdown";
			}
			if (currentDepth() === 0 && index.status !== "done") {
				index.status = "shutdown";
				index.completedAt = new Date().toISOString();
			}
		});
	});

	pi.on("session_start", async (_event, ctx) => {
		loadPiEnv(ctx.cwd);
		applyExtensionDefaults(import.meta.url, ctx);
		widgetCtx = ctx;

		try {
			config = loadConfig(ctx.cwd);
			runtime = resolveRuntime(config);
			ensureSessionLayout();
			ensureExpertiseFile(runtime.agent);
			initCards();
			updateWidget();
			appendEvent("process_start", {
				pid: process.pid,
				parent: process.env.PI_MULTI_PARENT || null,
				depth: currentDepth(),
			});
			mutateSessionIndex((index) => {
				const processKey = `${process.pid}:${runtime!.agent.name}`;
				index.processes = Array.isArray(index.processes) ? index.processes : [];
				if (!index.processes.some((item: any) => item.key === processKey)) {
					index.processes.push({
						key: processKey,
						pid: process.pid,
						agent: runtime!.agent.name,
						role: runtime!.role,
						team: runtime!.team?.name || null,
						parentAgent: currentParentAgent(),
						depth: currentDepth(),
						startedAt: new Date().toISOString(),
						status: "running",
					});
				}
				index.status = "running";
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Multi-team failed to start: ${message}`, "error");
			return;
		}

		if (!runtime) return;

		pi.setActiveTools(normalizeTools(effectiveTools(config!, runtime.agent), runtime.role));

		const label = `${displayName(runtime.agent.name)} · ${runtime.role}${runtime.team ? ` · ${runtime.team.name}` : ""}`;
		ctx.ui.setStatus("multi-team", label);
		ctx.ui.notify(
			`Multi-Team loaded\nSystem: ${config!.name}\nRole: ${runtime.role}\nAgent: ${runtime.agent.name}\nSession: ${currentSessionId()}\n\n` +
			`/multi-team       Runtime summary\n` +
			`/multi-team-tree  Print hierarchy`,
			"info",
		);

		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.id || "no-model";
				const usage = ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);
				const roleLabel = runtime!.team ? `${runtime!.role}:${runtime!.team.name}` : runtime!.role;
				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", roleLabel) +
					theme.fg("muted", " · ") +
					theme.fg("dim", shortText(currentSessionId(), 28));
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}
