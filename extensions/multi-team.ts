/**
 * Multi-Team — hierarchical multi-agent orchestration inspired by layered teams
 *
 * Roles:
 * - Orchestrator: delegates to team leads only
 * - Lead: delegates to workers in its own team only
 * - Worker: executes code tasks directly within its ownership domain
 *
 * The runtime is driven by a selected crew config (typically .pi/crew/<crew>/multi-team.yaml)
 * plus shared assets from the MAH overlay, which prefers ~/.mah/ and falls back to the local repo.
 *
 * Usage:
 *   pi -e extensions/multi-team.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, relative, resolve } from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
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
	recursive?: boolean;
	approval_required?: boolean;
	approval_mode?: "explicit_tui";
	grant_scope?: "single_path" | "subtree" | "single_op";
}

interface NormalizedDomainRule {
	path: string;
	absolutePath: string;
	read: boolean;
	upsert: boolean;
	delete: boolean;
	recursive: boolean;
	approval_required: boolean;
	approval_mode?: "explicit_tui";
	grant_scope: "single_path" | "subtree" | "single_op";
	index: number;
}

interface DomainApprovalGrant {
	id: string;
	agentName: string;
	absolutePath: string;
	operation: "read" | "upsert" | "delete";
	scope: "single_path" | "subtree" | "single_op";
	grantedAt: string;
	rulePath: string;
}

interface PendingDomainApproval {
	id: string;
	agentName: string;
	toolName: string;
	absolutePath: string;
	relativePath: string;
	operation: "read" | "upsert" | "delete";
	scope: "single_path" | "subtree" | "single_op";
	requestedAt: string;
	rulePath: string;
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
	model_fallbacks?: string[];
	tools?: string[] | string;
	skills?: Array<string | SkillReference>;
	expertise?: string | ExpertiseReference;
	domain?: DomainConfig | DomainRule[];
	domain_profile?: string | string[];
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
	domain_profiles?: Record<string, DomainRule[]>;
}

interface ResolvedConfig extends MultiTeamConfig {
	baseDir: string;
	repoRoot: string;
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
	timer?: any;
}

const DEFAULT_WORKER_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const SAFE_LEAD_TOOLS = ["read", "grep", "find", "ls"];
const SELF_EXTENSION_PATH = fileURLToPath(import.meta.url);
const EXTENSIONS_DIR = dirname(SELF_EXTENSION_PATH);
const SELF_MCP_BRIDGE_PATH = resolve(EXTENSIONS_DIR, "mcp-bridge.ts");
const SPAWNABLE_TOOL_NAMES = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"delegate_agent",
	"delegate_agents_parallel",
	"update_expertise_model",
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
const EXPERTISE_IDEAL_NOTE_CHARS = 160;
const EXPERTISE_DECAY_AFTER_DAYS = 14;
const EXPERTISE_SIMILARITY_THRESHOLD = 0.55;
const pendingDomainApprovals: PendingDomainApproval[] = [];
const domainApprovalGrants: DomainApprovalGrant[] = [];
let domainApprovalSequence = 0;

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
	if (limit <= 0) return "";
	if (visibleWidth(normalized) <= limit) return normalized;
	return truncateToWidth(normalized, limit);
}

function shortTextChars(value: string, limit = 180): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (limit <= 0) return "";
	return normalized.length > limit ? normalized.slice(0, Math.max(0, limit - 3)) + "..." : normalized;
}

function sanitizeTaskDescription(value: string, limit = 200): string {
	const ansiEscapeRe = /\u001b\[[0-9;]*m/g;
	const cavemanBlockRe = /\[CAVEMAN_CREW\][\s\S]*?\[\/CAVEMAN_CREW\]/g;
	const routingBlockRe = /\n*Routing note from orchestrator:\n(?:- .*\n?)*/gi;
	const cleanLine = (line: string) => line
		.replace(/^#+\s*/, "")
		.replace(/^[-*]\s*/, "")
		.replace(/\s+/g, " ")
		.trim();
	const isBoilerplate = (line: string) =>
		/^routing note from orchestrator:?$/i.test(line)
		|| /^requested worker target/i.test(line)
		|| /^requested worker targets/i.test(line)
		|| /^team:/i.test(line)
		|| /^delegate internally only/i.test(line)
		|| /^\[\/?caveman_crew\]/i.test(line);

	const stripped = (value || "")
		.replace(ansiEscapeRe, "")
		.replace(cavemanBlockRe, "")
		.replace(routingBlockRe, "\n");
	const collapsed = stripped
		.split("\n")
		.map(cleanLine)
		.filter((line) => line && !isBoilerplate(line))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return shortText(collapsed, limit);
}

/**
 * Derive task type from task description keywords.
 * @param {string} task
 * @returns {string}
 */
function deriveTaskType(task: string): string {
	const t = (task || "").toLowerCase();
	if (t.includes("fix") || t.includes("bug")) return "bugfix";
	if (t.includes("implement") || t.includes("build") || t.includes("write") || t.includes("add") || t.includes("create")) return "implementation";
	if (t.includes("test") || t.includes("verify") || t.includes("check")) return "testing";
	if (t.includes("review") || t.includes("audit")) return "review";
	if (t.includes("refactor")) return "refactoring";
	if (t.includes("doc") || t.includes("readme") || t.includes("comment")) return "documentation";
	if (t.includes("security") || t.includes("vuln")) return "security";
	return "general";
}

function middleEllipsis(value: string, limit: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (limit <= 0) return "";
	if (normalized.length <= limit) return normalized;
	if (limit <= 3) return ".".repeat(limit);

	const remaining = limit - 3;
	const head = Math.ceil(remaining / 2);
	const tail = Math.floor(remaining / 2);
	return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

function formatTokenCount(value: number): string {
	if (value < 1000) return `${Math.round(value)}`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
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
		.map((part) => {
			const stripped = part.replace(/^['"]|['"]$/g, "");
			return stripped.replace(/\\(.)/g, "$1").replace(/''/g, "'");
		});
}

function parseScalarToken(token: string): any {
	if (token === "[]") return [];
	if (token === "{}") return {};
	if (token.startsWith("[") && token.endsWith("]")) return parseInlineArray(token);
	if (token.startsWith(`"`) && token.endsWith(`"`)) {
		return token.slice(1, -1).replace(/\\(.)/g, "$1");
	}
	if (token.startsWith(`'`) && token.endsWith(`'`)) {
		return token.slice(1, -1).replace(/''/g, "'");
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

function isBlockScalarToken(token: string): boolean {
	return token === ">" || token === ">-" || token === "|" || token === "|-";
}

function consumeBlockScalar(
	lines: ParsedYamlLine[],
	startIndex: number,
	parentIndent: number,
	token: string,
): { value: string; index: number } {
	const chunks: string[] = [];
	let index = startIndex;
	while (index < lines.length) {
		const line = lines[index];
		if (line.indent <= parentIndent) break;
		chunks.push(line.content);
		index += 1;
	}
	const separator = token.startsWith("|") ? "\n" : " ";
	return { value: chunks.join(separator).trim(), index };
}

function isYamlKeyLine(content: string): boolean {
	// A line is treated as a YAML key only if the first colon appears in key-position.
	// Lines where ':' is embedded in URLs, inline key=value text, or
	// semicolon-delimited prose are NOT key lines.
	const colonIndex = content.indexOf(":");
	if (colonIndex === -1) return false;
	// A valid YAML key must be at the start of the line (after optional whitespace).
	// The key part (before the colon) must be a bare identifier: letters, digits,
	// hyphens, underscores, and dots — no spaces, no '=', no '/', no ';'.
	const keyPart = content.slice(0, colonIndex).trimEnd();
	if (keyPart.length === 0) return false;
	if (keyPart.includes(" ")) return false;
	if (keyPart.includes("=")) return false;
	if (keyPart.includes("/")) return false;
	if (keyPart.includes(";")) return false;
	// The character immediately after the colon must be whitespace, end-of-string,
	// or the start of an inline value (anything but another identifier char).
	// This distinguishes "key:" from "validate:config" or "http://...".
	const afterColon = content.slice(colonIndex + 1);
	if (afterColon.length > 0 && !/^[\s/"'#\[\-{]/.test(afterColon)) return false;
	// Valid YAML key pattern: bare identifier (letters, digits, hyphens, underscores, dots).
	return /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(keyPart);
}

function consumeWrappedScalar(
	lines: ParsedYamlLine[],
	startIndex: number,
	parentIndent: number,
): { value: string; index: number } {
	const chunks: string[] = [];
	let index = startIndex;
	while (index < lines.length) {
		const line = lines[index];
		if (line.indent <= parentIndent) break;
		if (line.content.startsWith("- ")) break;
		if (isYamlKeyLine(line.content)) break;
		chunks.push(line.content.trim());
		index += 1;
	}
	return { value: chunks.join(" ").trim(), index };
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
				const wrapped = consumeWrappedScalar(lines, index + 1, indent);
				items.push([parseScalarToken(rest), wrapped.value].filter(Boolean).join(" ").trim());
				index = wrapped.index;
				continue;
			}

			const item: Record<string, any> = {};
			const key = rest.slice(0, colonIndex).trim();
			const valueToken = rest.slice(colonIndex + 1).trim();

			if (valueToken) {
				if (isBlockScalarToken(valueToken)) {
					const block = consumeBlockScalar(lines, index + 1, indent, valueToken);
					item[key] = block.value;
					index = block.index;
				} else {
					const wrapped = consumeWrappedScalar(lines, index + 1, indent);
					item[key] = [parseScalarToken(valueToken), wrapped.value].filter(Boolean).join(" ").trim();
					index = wrapped.index;
				}
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
					if (isBlockScalarToken(siblingValueToken)) {
						const block = consumeBlockScalar(lines, index + 1, sibling.indent, siblingValueToken);
						item[siblingKey] = block.value;
						index = block.index;
					} else {
						const wrapped = consumeWrappedScalar(lines, index + 1, sibling.indent);
						item[siblingKey] = [parseScalarToken(siblingValueToken), wrapped.value].filter(Boolean).join(" ").trim();
						index = wrapped.index;
					}
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
			if (isBlockScalarToken(valueToken)) {
				const block = consumeBlockScalar(lines, index + 1, indent, valueToken);
				object[key] = block.value;
				index = block.index;
			} else {
				const wrapped = consumeWrappedScalar(lines, index + 1, indent);
				object[key] = [parseScalarToken(valueToken), wrapped.value].filter(Boolean).join(" ").trim();
				index = wrapped.index;
			}
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

function findRepoRoot(startPath: string): string {
	let current = resolve(startPath);
	while (true) {
		if (existsSync(resolve(current, "meta-agents.yaml"))) return current;
		const parent = dirname(current);
		if (parent === current) return startPath;
		current = parent;
	}
}

function getPromptDefinition(config: ResolvedConfig, agent: AgentConfig): PromptDefinition {
	const promptPath = resolveArtifact(config.repoRoot, agent.prompt);
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

	// 1. Collect rules from domain_profile (defined in the config)
	let profileRules: DomainRule[] = [];
	const profileName = agent.domain_profile || metadata?.domain_profile;
	if (profileName) {
		const profiles = Array.isArray(profileName) ? profileName : [profileName];
		for (const name of profiles) {
			if (config.domain_profiles?.[name]) {
				profileRules.push(...config.domain_profiles[name]);
			}
		}
	}

	// 2. Collect explicit domain rules from the agent config
	const explicitRules = Array.isArray(agent.domain)
		? agent.domain
		: Array.isArray(agent.domain?.rules)
			? agent.domain.rules
			: [];

	// 3. Collect domain rules from the metadata (prompt frontmatter)
	let metadataRules: DomainRule[] = [];
	if (metadata?.domain) {
		metadataRules = Array.isArray(metadata.domain)
			? metadata.domain
			: (Array.isArray(metadata.domain.rules) ? metadata.domain.rules : []);
	}

	const rules = [...profileRules, ...explicitRules, ...metadataRules];

	if (rules.length > 0) {
		return { rules };
	}

	// 4. Fallback to legacy read/write paths if no rules found
	const read = !Array.isArray(agent.domain) ? agent.domain?.read || metadata?.domain?.read || metadata?.read_paths || [] : [];
	const write = !Array.isArray(agent.domain) ? agent.domain?.write || metadata?.domain?.write || metadata?.write_paths || [] : [];

	return {
		read: Array.isArray(read) ? read : [],
		write: Array.isArray(write) ? write : [],
	};
}

function resolveConfigPath(cwd: string): string {
	const envPath = process.env.MAH_MULTI_CONFIG?.trim() || process.env.PI_MULTI_CONFIG?.trim();
	if (envPath) {
		const absolute = resolve(cwd, envPath);
		if (!existsSync(absolute)) {
			throw new Error(`MAH_MULTI_CONFIG points to a missing file: ${absolute}`);
		}
		return absolute;
	}

	const runtimeName = `${process.env.MAH_RUNTIME || ""}`.trim().toLowerCase();
	const runtimeMarker = runtimeName === "kilo" ? ".kilo" : ".pi";

	const envCrew = process.env.MAH_ACTIVE_CREW?.trim() || process.env.PI_MULTI_CREW?.trim();
	if (envCrew) {
		const byCrew = resolve(cwd, runtimeMarker, "crew", envCrew, "multi-team.yaml");
		if (!existsSync(byCrew)) {
			throw new Error(`Active crew "${envCrew}" was set but config was not found at ${byCrew}`);
		}
		return byCrew;
	}

	const activeCrewPath = resolve(cwd, runtimeMarker, ".active-crew.json");
	if (existsSync(activeCrewPath)) {
		try {
			const active = JSON.parse(readFileSync(activeCrewPath, "utf-8")) as { source_config?: string };
			const source = typeof active?.source_config === "string" ? active.source_config.trim() : "";
			if (source) {
				const resolved = resolve(cwd, source);
				if (existsSync(resolved)) return resolved;
			}
		} catch {
			// ignore malformed metadata and continue with discovery
		}
	}

	const legacyCandidates = [
		resolve(cwd, "multi-team.yaml"),
		resolve(cwd, runtimeMarker, "multi-team.yaml"),
	];
	for (const candidate of legacyCandidates) {
		if (existsSync(candidate)) return candidate;
	}

	const crewRoot = resolve(cwd, runtimeMarker, "crew");
	const crewCandidates: string[] = [];
	if (existsSync(crewRoot)) {
		for (const entry of readdirSync(crewRoot)) {
			const crewDir = resolve(crewRoot, entry);
			let isDir = false;
			try {
				isDir = statSync(crewDir).isDirectory();
			} catch {
				isDir = false;
			}
			if (!isDir) continue;
			const candidate = resolve(crewDir, "multi-team.yaml");
			if (existsSync(candidate)) crewCandidates.push(candidate);
		}
	}
	crewCandidates.sort();

	if (crewCandidates.length === 1) {
		return crewCandidates[0];
	}
	if (crewCandidates.length > 1) {
		const options = crewCandidates.map((candidate) => `- ${candidate}`).join("\n");
		throw new Error(
			`Multiple crew configs found. Select a crew first or set MAH_MULTI_CONFIG.\n${options}`
		);
	}

	throw new Error("Could not find a multi-team config. Set MAH_MULTI_CONFIG or create .kilo/.pi crew config.");
}

function loadConfig(cwd: string): ResolvedConfig {
	const configPath = resolveConfigPath(cwd);
	const baseDir = dirname(configPath);
	const repoRoot = findRepoRoot(baseDir);
	const raw = parseYamlSubset(readFileSync(configPath, "utf-8")) as MultiTeamConfig;

	if (!raw?.orchestrator) {
		throw new Error("multi-team.yaml is missing the orchestrator block.");
	}
	if (!Array.isArray(raw.teams) || raw.teams.length === 0) {
		throw new Error("multi-team.yaml must define at least one team.");
	}

	const runtimeName = `${process.env.MAH_RUNTIME || ""}`.trim().toLowerCase();
	const runtimeMarker = runtimeName === "kilo" ? ".kilo" : ".pi";
	const crewRoot = resolve(cwd, runtimeMarker, "crew");
	const relativeToCrewRoot = relative(crewRoot, baseDir);
	const isCrewScoped = relativeToCrewRoot !== "" && !relativeToCrewRoot.startsWith("..");
	const defaultSessionDir = isCrewScoped ? "sessions" : `${runtimeMarker}/multi-team/sessions`;
	const defaultExpertiseDir = isCrewScoped ? "expertise" : `${runtimeMarker}/expertise`;

	return {
		...raw,
		baseDir,
		repoRoot,
		configPath,
		sessionDirAbs: resolve(baseDir, raw.session_dir || defaultSessionDir),
		expertiseDirAbs: resolve(baseDir, raw.expertise_dir || defaultExpertiseDir),
	};
}

function resolveArtifact(repoRoot: string, target: string): string {
	return resolve(repoRoot, target);
}

function cosineSimilarityTokens(a: string, b: string): number {
	const tokenize = (s: string): Set<string> =>
		new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean));
	const setA = tokenize(a);
	const setB = tokenize(b);
	if (setA.size === 0 || setB.size === 0) return 0;
	let dot = 0;
	for (const t of setA) {
		if (setB.has(t)) dot++;
	}
	return dot / (Math.sqrt(setA.size) * Math.sqrt(setB.size));
}

function notesAreSimilar(a: string, b: string): boolean {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1) > 0.7) return false;
	return cosineSimilarityTokens(a, b) >= EXPERTISE_SIMILARITY_THRESHOLD;
}

function daysBetweenDates(a: string, b: string): number {
	const parse = (d: string) => {
		const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!match) return Date.now();
		return Date.UTC(+match[1], +match[2] - 1, +match[3]);
	};
	return Math.abs(parse(a) - parse(b)) / (1000 * 60 * 60 * 24);
}

function isNoteStale(date: string): boolean {
	return daysBetweenDates(date, new Date().toISOString().slice(0, 10)) > EXPERTISE_DECAY_AFTER_DAYS;
}

function compressNote(note: string): string {
	const normalized = note.replace(/\s+/g, ' ').trim();
	if (normalized.length <= EXPERTISE_IDEAL_NOTE_CHARS) return normalized;
	const prefix = normalized.slice(0, EXPERTISE_IDEAL_NOTE_CHARS - 6);
	return prefix + ' [...]';
}

function normalizeTools(tools: AgentConfig["tools"], role: RuntimeRole): string[] {
	let normalized: string[];
	if (Array.isArray(tools) && tools.length > 0) {
		normalized = [...tools];
	} else if (typeof tools === "string" && tools.trim()) {
		normalized = tools.split(",").map((tool) => tool.trim()).filter(Boolean);
	} else if (role === "worker") {
		normalized = [...DEFAULT_WORKER_TOOLS];
	} else {
		normalized = ["delegate_agent", "delegate_agents_parallel"];
	}
	normalized = Array.from(new Set(normalized));
	if (role !== "worker" && normalized.includes("delegate_agent") && !normalized.includes("delegate_agents_parallel")) {
		normalized.push("delegate_agents_parallel");
	}
	return normalized;
}

function spawnableToolsForSpawn(tools: string[]): string[] {
	return Array.from(new Set(tools.filter((tool) => SPAWNABLE_TOOL_NAMES.has(tool))));
}

function matchesName(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase() || slugify(left) === slugify(right);
}

function resolveRuntime(config: ResolvedConfig): RuntimeState {
	const role = (process.env.MAH_MULTI_ROLE as RuntimeRole | undefined) || (process.env.PI_MULTI_ROLE as RuntimeRole | undefined) || "orchestrator";
	const agentName = process.env.MAH_MULTI_AGENT?.trim() || process.env.PI_MULTI_AGENT?.trim();
	const teamName = process.env.MAH_MULTI_TEAM?.trim() || process.env.PI_MULTI_TEAM?.trim();

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
	const rawRules = Array.isArray(domain)
		? domain
		: domain?.rules && domain.rules.length > 0
			? domain.rules
			: legacyDomainToRules(domain?.read || [fallbackRead], domain?.write || []);
	return expandDomainRules(config.repoRoot, rawRules);
}

function expandDomainRules(repoRoot: string, rules: DomainRule[]): NormalizedDomainRule[] {
	const expanded: NormalizedDomainRule[] = [];
	let syntheticIndex = rules.length;

	for (const rule of rules) {
		const trimmed = rule.path.trim();
		const hasGlob = trimmed.includes("*");
		const isRecursive = !!rule.recursive;

		// If the path uses glob patterns (* or **), expand against the filesystem
		if (hasGlob) {
			const expandedPaths = expandGlobPatterns(repoRoot, trimmed);
			for (const absPath of expandedPaths) {
				expanded.push({
					path: relative(repoRoot, absPath) || ".",
					absolutePath: absPath,
					read: !!rule.read,
					upsert: !!rule.upsert,
					delete: !!rule.delete,
					recursive: false,
					approval_required: !!rule.approval_required,
					approval_mode: rule.approval_mode,
					grant_scope: rule.grant_scope || "single_path",
					index: syntheticIndex++,
				});
			}
			// Always keep the glob pattern itself as a runtime matcher
			// so new files created after config load still match
			expanded.push({
				path: trimmed,
				absolutePath: resolve(repoRoot, trimmed.replace(/\*+.*$/, "")),
				read: !!rule.read,
				upsert: !!rule.upsert,
				delete: !!rule.delete,
				recursive: true,
				approval_required: !!rule.approval_required,
				approval_mode: rule.approval_mode,
				grant_scope: rule.grant_scope || "subtree",
				index: syntheticIndex++,
			});
			continue;
		}

		// If recursive is set without a glob, enable recursive prefix matching
		expanded.push({
			path: trimmed,
			absolutePath: resolve(repoRoot, trimmed),
			read: !!rule.read,
			upsert: !!rule.upsert,
			delete: !!rule.delete,
			recursive: isRecursive,
			approval_required: !!rule.approval_required,
			approval_mode: rule.approval_mode,
			grant_scope: rule.grant_scope || (isRecursive ? "subtree" : "single_path"),
			index: syntheticIndex++,
		});
	}

	return expanded;
}

function expandGlobPatterns(repoRoot: string, pattern: string): string[] {
	const results: string[] = [];
	const basePrefix = pattern.replace(/\*+.*$/, "");
	const baseDir = resolve(repoRoot, basePrefix);

	if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) return results;

	// Collect all files/dirs recursively from baseDir
	function walk(dir: string, depth: number): void {
		if (depth > 10) return; // Safety limit
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = resolve(dir, entry);
			try {
				const stat = statSync(fullPath);
				results.push(fullPath);
				if (stat.isDirectory()) {
					walk(fullPath, depth + 1);
				}
			} catch {
				// Skip entries we can't stat
			}
		}
	}

	walk(baseDir, 0);
	return results;
}

function matchingDomainRule(targetPath: string, rules: NormalizedDomainRule[]): NormalizedDomainRule | null {
	const matches = rules.filter((rule) => {
		const normalized = rule.absolutePath.endsWith("/") ? rule.absolutePath.slice(0, -1) : rule.absolutePath;

		// Exact match or prefix match (recursive)
		if (targetPath === normalized || targetPath.startsWith(normalized + "/")) {
			return true;
		}

		// For glob-based rules (recursive from wildcard expansion),
		// check if the target is a descendant of the glob's base directory
		if (rule.recursive) {
			const relToRule = relative(rule.absolutePath, targetPath);
			if (!relToRule.startsWith("..") && relToRule !== targetPath) {
				return true;
			}
		}

		return false;
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

function isInteractiveApprovalAvailable(): boolean {
	return process.env.PI_MULTI_HEADLESS !== "1" && !!process.stdin.isTTY && !!process.stdout.isTTY;
}

function matchingGrant(agentName: string, targetPath: string, permission: "read" | "upsert" | "delete"): DomainApprovalGrant | null {
	const matches = domainApprovalGrants.filter((grant) => {
		if (grant.agentName !== agentName || grant.operation !== permission) return false;
		if (grant.scope === "single_op" || grant.scope === "single_path") {
			return grant.absolutePath === targetPath;
		}
		const relToGrant = relative(grant.absolutePath, targetPath);
		return !relToGrant.startsWith("..") && relToGrant !== targetPath;
	});
	if (matches.length === 0) return null;
	return matches[matches.length - 1] || null;
}

function consumeGrantIfNeeded(grant: DomainApprovalGrant | null) {
	if (!grant || grant.scope !== "single_op") return;
	const index = domainApprovalGrants.findIndex((item) => item.id === grant.id);
	if (index >= 0) domainApprovalGrants.splice(index, 1);
}

function evaluateDomainPermission(agentName: string, targetPath: string, rules: NormalizedDomainRule[], permission: "read" | "upsert" | "delete") {
	const rule = matchingDomainRule(targetPath, rules);
	if (!rule || !rule[permission]) {
		return { allowed: false, reason: `${permission} access denied for ${targetPath}` };
	}
	if (!rule.approval_required) {
		return { allowed: true, viaApproval: false as const, rule };
	}
	const grant = matchingGrant(agentName, targetPath, permission);
	if (grant) {
		consumeGrantIfNeeded(grant);
		return { allowed: true, viaApproval: true as const, rule, grant };
	}
	return {
		allowed: false,
		reason: `${permission} requires explicit TUI approval for ${targetPath}`,
		approvalRequired: true as const,
		rule,
	};
}

function domainRulesSummary(config: ResolvedConfig, domain: DomainConfig | DomainRule[] | undefined): string[] {
	// Show the ORIGINAL rules (pre-expansion) to avoid blowing up the prompt
	// with thousands of per-file entries from wildcard patterns.
	const rawRules = Array.isArray(domain)
		? domain
		: domain?.rules && domain.rules.length > 0
			? domain.rules
			: legacyDomainToRules(domain?.read || ["."], domain?.write || []);
	return rawRules.map((rule) => {
		const hasGlob = rule.path.includes("*");
		const label = hasGlob ? rule.path + "**" : rule.path;
		const approval = rule.approval_required ? ` approval:${rule.approval_mode || "explicit_tui"}/${rule.grant_scope || "single_path"}` : "";
		return `${label} [read:${!!rule.read} upsert:${!!rule.upsert} delete:${!!rule.delete}${approval}]`;
	});
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

function redactSensitiveString(value: string): string {
	return `${value || ""}`
		.replace(/\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/g, "$1=[REDACTED]")
		.replace(/\b(authorization\s*:\s*)(bearer\s+)?([^\s,]+)/gi, "$1$2[REDACTED]")
		.replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|password|secret)["']?\s*[:=]\s*)(["'][^"']*["']|[^\s,}\]]+)/gi, "$1\"[REDACTED]\"")
		.replace(/\b(?:sk-or-v1|ctx7sk|ghp|gho|github_pat|xox[baprs]-|AIza)[A-Za-z0-9._-]+\b/g, "[REDACTED]")
		.replace(/\bBearer\s+[A-Za-z0-9._-]+\b/g, "Bearer [REDACTED]");
}

function redactSensitiveValue(value: any, keyName = ""): any {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") {
		if (/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|password|secret)/i.test(keyName)) {
			return "[REDACTED]";
		}
		return redactSensitiveString(value);
	}
	if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, keyName));
	if (typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, redactSensitiveValue(item, key)]),
	);
}

function compactArtifactContent(content: string, limit = 20000): string {
	const sanitized = redactSensitiveString(content);
	if (sanitized.length <= limit) return sanitized;
	const keep = Math.max(2000, Math.floor((limit - 32) / 2));
	return `${sanitized.slice(0, keep)}\n\n...[truncated]...\n\n${sanitized.slice(-keep)}`;
}

// --- Artifact reference system ---
// Instead of relaying raw output through prompts (which bloats context),
// delegation results are persisted as artifacts and only compact references
// (path + content hash + summary + byte size) flow through the prompt.
// This keeps context lean while preserving full data for on-demand reads.

interface ArtifactRef {
	path: string;
	hash: string;
	summary: string;
	bytes: number;
}

const ARTIFACT_REF_INLINE_THRESHOLD = 600; // Below this, inline output; above, use ref.

function contentHash(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function buildArtifactRef(artifactPath: string, output: string): ArtifactRef {
	return {
		path: artifactPath,
		hash: contentHash(output),
		summary: firstUsefulLine(output),
		bytes: Buffer.byteLength(output, "utf-8"),
	};
}

function formatArtifactRef(ref: ArtifactRef): string {
	return `[artifact] ${ref.path} (hash=${ref.hash}, ${ref.bytes}B) — ${ref.summary}`;
}

function formatArtifactRefBlock(refs: ArtifactRef[]): string {
	if (refs.length === 0) return "";
	return "## Artifact References\n\n" + refs.map(formatArtifactRef).join("\n");
}

function buildDelegationResultContent(
	target: string,
	status: string,
	elapsed: number,
	output: string,
	artifactPath: string | null,
	header = "",
): string {
	// Small outputs: inline for immediate readability.
	if (output.length <= ARTIFACT_REF_INLINE_THRESHOLD && artifactPath) {
		const ref = buildArtifactRef(artifactPath, output);
		return `${header}[${target}] ${status} in ${elapsed}s (${ref.bytes}B)\n\n${output}\n\n${formatArtifactRef(ref)}`;
	}
	// Large outputs: summary + ref only. Parent reads artifact on demand.
	if (artifactPath) {
		const ref = buildArtifactRef(artifactPath, output);
		return `${header}[${target}] ${status} in ${elapsed}s\n\n${formatArtifactRef(ref)}\n\nUse read("${ref.path}") to retrieve the full output when needed.`;
	}
	// No artifact path (error cases): inline whatever we have.
	return `${header}[${target}] ${status} in ${elapsed}s\n\n${output}`;
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
	if (value === null || value === undefined) return "''";
	const text = String(value);
	return `'${text.replace(/'/g, "''")}'`;
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
	let currentThinkingLevel = "minimal";
	let widgetCtx: any;
	let sessionId = "";
	let sessionRoot = "";
	let toolCallSequence = 0;
	const pendingToolCalls: PendingToolCall[] = [];
	const cards = new Map<string, CardState>();
	const childProcesses = new Map<string, ChildProcessWithoutNullStreams>();
	const activeDelegations = new Map<string, Promise<any>>();

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
		appendFileSync(sessionPath(relativePath), JSON.stringify(redactSensitiveValue(payload)) + "\n");
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
			} catch { }
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

	function pendingApprovalKey(agentName: string, absolutePath: string, operation: "read" | "upsert" | "delete") {
		return `${agentName}::${operation}::${absolutePath}`;
	}

	function findPendingDomainApproval(agentName: string, absolutePath: string, operation: "read" | "upsert" | "delete") {
		return pendingDomainApprovals.find((item) => pendingApprovalKey(item.agentName, item.absolutePath, item.operation) === pendingApprovalKey(agentName, absolutePath, operation)) || null;
	}

	function requestDomainApproval(args: {
		agentName: string;
		toolName: string;
		absolutePath: string;
		relativePath: string;
		operation: "read" | "upsert" | "delete";
		rule: NormalizedDomainRule;
	}) {
		const existing = findPendingDomainApproval(args.agentName, args.absolutePath, args.operation);
		if (existing) return existing;
		const pending: PendingDomainApproval = {
			id: `approval-${process.pid}-${Date.now()}-${++domainApprovalSequence}`,
			agentName: args.agentName,
			toolName: args.toolName,
			absolutePath: args.absolutePath,
			relativePath: args.relativePath,
			operation: args.operation,
			scope: args.rule.grant_scope || "single_path",
			requestedAt: new Date().toISOString(),
			rulePath: args.rule.path,
		};
		pendingDomainApprovals.push(pending);
		appendEvent("domain_approval_requested", {
			approval_id: pending.id,
			target_agent: pending.agentName,
			path: pending.relativePath,
			operation: pending.operation,
			scope: pending.scope,
			tool: pending.toolName,
			rule_path: pending.rulePath,
		});
		return pending;
	}

	function formatPendingDomainApproval(pending: PendingDomainApproval) {
		return `#${pending.id} agent=${pending.agentName} op=${pending.operation} scope=${pending.scope} path=${pending.relativePath}`;
	}

	function findPendingApprovalBySelector(selector: string) {
		const trimmed = selector.trim();
		if (!trimmed || trimmed === "latest") {
			return pendingDomainApprovals[pendingDomainApprovals.length - 1] || null;
		}
		return pendingDomainApprovals.find((item) => item.id === trimmed || item.relativePath === trimmed || item.agentName === trimmed) || null;
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
		const sessionRelativePath = relative(currentSessionRoot(), fullPath);
		const repoRelativePath = relative(config.repoRoot, fullPath);
		writeFileSync(fullPath, compactArtifactContent(content));
		appendJsonl("artifacts/index.jsonl", {
			type: "artifact",
			at: new Date().toISOString(),
			sessionId: currentSessionId(),
			kind,
			label,
			path: sessionRelativePath,
			...sessionProcessInfo(),
			...redactSensitiveValue(metadata),
		});
		mutateSessionIndex((index) => {
			index.counts.artifacts = (index.counts.artifacts || 0) + 1;
		});
		return repoRelativePath;
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
			? resolveArtifact(config.repoRoot, expertise.path)
			: resolve(config.expertiseDirAbs, `${slugify(agent.name)}-expertise-model.yaml`);
	}

	function expertiseMeta(agent: AgentConfig): ExpertiseReference {
		if (!config) {
			return {
				path: `.pi/crew/dev/expertise/${slugify(agent.name)}-expertise-model.yaml`,
				updatable: true,
				maxLines: DEFAULT_EXPERTISE_MAX_LINES,
			};
		}
		const expertise = effectiveExpertise(config, agent);
		return {
			path: expertise?.path || toConfigRelative(config, resolve(config.expertiseDirAbs, `${slugify(agent.name)}-expertise-model.yaml`)),
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

	const MAX_EXPERTISE_FILE_BYTES = 32_000;
	const MAX_EXPERTISE_INJECTION_BYTES = 24_000;
	const ABSOLUTE_EXPERTISE_LINE_CAP = 500;

	function renderExpertiseDocument(doc: ExpertiseDocument): string {
		return stringifyYaml(doc) + "\n";
	}

	function truncateOversizedNotes(doc: ExpertiseDocument): void {
		const dynamicSections = Object.keys(doc).filter(
			(key) => key !== "agent" && key !== "meta" && Array.isArray(doc[key])
		);
		for (const section of dynamicSections) {
			const items = doc[section] as ExpertiseEntry[];
			for (let i = 0; i < items.length; i++) {
				if (items[i].note && items[i].note.length > EXPERTISE_NOTE_MAX_CHARS) {
					items[i] = { ...items[i], note: shortText(items[i].note, EXPERTISE_NOTE_MAX_CHARS) };
				}
			}
		}
	}

	function deduplicateAndMerge(doc: ExpertiseDocument): { merged: number } {
		let merged = 0;
		const dynamicSections = Object.keys(doc).filter(
			(key) => key !== "agent" && key !== "meta" && Array.isArray(doc[key])
		);
		for (const section of dynamicSections) {
			const items = doc[section] as ExpertiseEntry[];
			const keep: ExpertiseEntry[] = [];
			for (const item of items) {
				const existingIdx = keep.findIndex((k) => notesAreSimilar(k.note, item.note));
				if (existingIdx >= 0) {
					const existing = keep[existingIdx];
					if (item.note.length > existing.note.length || item.date >= existing.date) {
						keep[existingIdx] = item;
					}
					merged++;
				} else {
					keep.push(item);
				}
			}
			doc[section] = keep;
		}
		return { merged };
	}

	function evictStaleAndLowSignal(doc: ExpertiseDocument): { evicted: number } {
		let evicted = 0;
		const trimOrder = ["open_questions", "observations", "lessons", "workflows", "patterns", "tools", "decisions", "risks"];
		for (const section of trimOrder) {
			const items = doc[section] as ExpertiseEntry[];
			if (!Array.isArray(items)) continue;
			if (section === "open_questions") {
				const active = items.filter((item) => !isNoteStale(item.date));
				evicted += items.length - active.length;
				doc[section] = active;
			}
		}
		return { evicted };
	}

	function compressAllNotes(doc: ExpertiseDocument): void {
		const dynamicSections = Object.keys(doc).filter(
			(key) => key !== "agent" && key !== "meta" && Array.isArray(doc[key])
		);
		for (const section of dynamicSections) {
			const items = doc[section] as ExpertiseEntry[];
			for (let i = 0; i < items.length; i++) {
				if (items[i].note && items[i].note.length > EXPERTISE_IDEAL_NOTE_CHARS) {
					items[i] = { ...items[i], note: compressNote(items[i].note) };
				}
			}
		}
	}

	function enforceExpertiseLineLimit(doc: ExpertiseDocument): { doc: ExpertiseDocument; stats: { deduplicated: number; evicted: number; compressed: boolean } } {
		const absoluteCap = ABSOLUTE_EXPERTISE_LINE_CAP;
		const configuredMax = typeof doc.meta.max_lines === "number" ? doc.meta.max_lines : DEFAULT_EXPERTISE_MAX_LINES;
		const maxLines = Math.min(configuredMax, absoluteCap);

		// Phase 1: truncate any notes that exceed the hard character limit
		truncateOversizedNotes(doc);

		// Phase 2: deduplicate similar notes (merge, keep best version)
		const { merged: deduplicated } = deduplicateAndMerge(doc);

		// Phase 3: evict stale low-signal entries (open_questions older than decay threshold)
		const { evicted } = evictStaleAndLowSignal(doc);

		const preferredTrimOrder = [
			"open_questions",
			"observations",
			"lessons",
			"workflows",
			"patterns",
			"tools",
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

		// Phase 4: compress verbose notes to ideal length when approaching budget
		let compressed = false;
		if (renderExpertiseDocument(doc).split("\n").length > maxLines * 0.8 ||
			Buffer.byteLength(renderExpertiseDocument(doc), "utf-8") > MAX_EXPERTISE_FILE_BYTES * 0.8) {
			compressAllNotes(doc);
			compressed = true;
		}

		// Phase 5: line-limit enforcement (evict oldest from lowest-priority sections)
		while (renderExpertiseDocument(doc).split("\n").length > maxLines) {
			const key = trimOrder.find((section) => Array.isArray(doc[section]) && doc[section].length > 0);
			if (!key) break;
			doc[key].shift();
		}

		// Phase 6: byte-size safety — final hard cap
		if (Buffer.byteLength(renderExpertiseDocument(doc), "utf-8") > MAX_EXPERTISE_FILE_BYTES) {
			while (Buffer.byteLength(renderExpertiseDocument(doc), "utf-8") > MAX_EXPERTISE_FILE_BYTES) {
				const key = trimOrder.find((section) => Array.isArray(doc[section]) && doc[section].length > 0);
				if (!key) break;
				doc[key].shift();
			}
		}

		return { doc, stats: { deduplicated, evicted, compressed } };
	}

	function saveExpertiseDocument(agent: AgentConfig, doc: ExpertiseDocument) {
		const path = expertisePathFor(agent);
		if (!path) return;
		doc.meta.last_updated = new Date().toISOString();
		const { doc: enforced, stats } = enforceExpertiseLineLimit(doc);
		const rendered = renderExpertiseDocument(enforced);
		const byteSize = Buffer.byteLength(rendered, "utf-8");

		if (byteSize > MAX_EXPERTISE_FILE_BYTES) {
			const emergency = defaultExpertiseDocument(agent);
			emergency.meta.last_updated = doc.meta.last_updated;
			emergency.observations.push({
				date: new Date().toISOString().slice(0, 10),
				note: `[Expertise file was corrupted (${byteSize} bytes) and has been reset. Previous entries were lost.]`,
			});
			appendEvent("expertise_corruption_reset", {
				path,
				originalSize: byteSize,
				recoveredEntries: 0,
			});
			writeFileSync(path, renderExpertiseDocument(emergency));
			return;
		}

		writeFileSync(path, rendered);

		// Log enforcement stats when meaningful work happened
		if (stats.deduplicated > 0 || stats.evicted > 0 || stats.compressed) {
			appendEvent("expertise_enforcement", {
				path,
				byteSize,
				...stats,
			});
		}
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
		appendEvent("expertise_model_update", {
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
			const fullPath = resolveArtifact(config.repoRoot, skillRef.path);
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
		const expertisePath = expertisePathFor(agent);
		const expertiseBody = safeReadText(expertisePath);
		if (expertiseBody) {
			// Validate expertise file before injection — reject oversized files
			// that would exhaust the model context window.
			const expertiseBytes = Buffer.byteLength(expertiseBody, "utf-8");
			const expertiseLines = expertiseBody.split("\n").length;
			if (expertiseBytes > MAX_EXPERTISE_INJECTION_BYTES || expertiseLines > ABSOLUTE_EXPERTISE_LINE_CAP) {
				appendEvent("expertise_injection_skipped", {
					path: expertisePath,
					bytes: expertiseBytes,
					lines: expertiseLines,
					maxBytes: MAX_EXPERTISE_INJECTION_BYTES,
					maxLines: ABSOLUTE_EXPERTISE_LINE_CAP,
				});
				sections.push(`## Persistent Expertise
(skipped — expertise file is ${formatTokenCount(expertiseBytes)}B / ${expertiseLines} lines, exceeds budget of ${formatTokenCount(MAX_EXPERTISE_INJECTION_BYTES)}B / ${ABSOLUTE_EXPERTISE_LINE_CAP} lines. Path: ${expertisePath})`);
				// Attempt to fix the file on the fly for next run
				try {
					const doc = loadExpertiseDocument(agent);
					const { doc: enforced } = enforceExpertiseLineLimit(doc);
					writeFileSync(expertisePath, renderExpertiseDocument(enforced));
				} catch (fixErr) {
					appendEvent("expertise_fix_failed", { path: expertisePath, error: String(fixErr) });
				}
			} else {
				sections.push(`## Persistent Expertise\n${stripFrontmatter(expertiseBody)}`);
			}
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
		const contentWidth = Math.max(1, width - 1);
		const statusColor = state.status === "idle" ? "dim"
			: state.status === "running" ? "accent"
				: state.status === "done" ? "success" : "error";

		// Status icons — animated spinner for running
		const CARD_SPINNERS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const spinIdx = Math.floor(Date.now() / 80) % CARD_SPINNERS.length;
		const statusIcon = state.status === "idle" ? "○"
			: state.status === "running" ? CARD_SPINNERS[spinIdx]
				: state.status === "done" ? "✓" : "✗";

		// Role badge with icon
		const roleIcon = state.role === "lead" ? "◆" : "◇";
		const roleLabel = state.role === "lead" ? "Lead" : "Worker";

		// Title row
		const titleText = shortText(displayName(state.agent.name), contentWidth - 2);

		// Meta row: role badge + team
		const metaText = shortText(`${roleIcon} ${state.teamName ? `${roleLabel} · ${state.teamName}` : roleLabel}`, contentWidth);

		// Status row: icon + status + elapsed + run count
		const elapsedText = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
		const runLabel = state.runCount > 0 ? ` #${state.runCount}` : "";
		const statusText = shortText(`${statusIcon} ${state.status}${elapsedText}${runLabel}`, contentWidth);

		// Task row
		const taskText = shortText(state.task || state.agent.description || "idle", contentWidth);

		// Last line preview (truncated)
		const hasLastLine = state.status === "running" && !!state.lastLine.trim();
		const lastLineText = hasLastLine
			? shortText(`↳ ${state.lastLine.trim()}`, contentWidth)
			: "";

		// Card assembly
		const title = theme.fg("accent", theme.bold(titleText));
		const meta = theme.fg("dim", metaText);
		const status = theme.fg(statusColor, statusText);
		const task = theme.fg("muted", taskText);

		// Top border with status-colored accent
		const accentWidth = Math.min(width, 4);
		const topAccent = theme.fg(statusColor, "━".repeat(accentWidth));
		const topRest = theme.fg("dim", "─".repeat(Math.max(0, width - accentWidth)));
		const top = theme.fg("dim", "┌") + topAccent + topRest + theme.fg("dim", "┐");
		const bot = theme.fg("dim", "└") + theme.fg("dim", "─".repeat(width)) + theme.fg("dim", "┘");

		const row = (content: string, visible: string) => {
			const safeVisible = truncateToWidth(visible, contentWidth);
			const safeContent = truncateToWidth(content, contentWidth);
			return theme.fg("dim", "│") + " " + safeContent + " ".repeat(Math.max(0, contentWidth - visibleWidth(safeVisible))) + theme.fg("dim", "│");
		};

		// Progress bar for running agents
		let progressRow = "";
		if (state.status === "running") {
			const barWidth = Math.max(4, contentWidth - 2);
			const elapsed = Math.round(state.elapsed / 1000);
			const cycle = elapsed % barWidth;
			const barChars = Array(barWidth).fill("─");
			// Animated sweep
			for (let k = 0; k < 3 && cycle + k < barWidth; k++) {
				barChars[cycle + k] = "━";
			}
			const barStr = barChars.join("");
			const barVisible = ` ${barStr} `;
			progressRow = theme.fg("dim", "│") + " " +
				theme.fg("accent", barStr) +
				" ".repeat(Math.max(0, contentWidth - visibleWidth(barStr))) +
				theme.fg("dim", "│");
		}

		const rows = [
			top,
			row(title, titleText),
			row(meta, metaText),
			row(status, statusText),
			row(task, taskText),
		];

		if (hasLastLine) {
			rows.push(row(theme.fg("dim", lastLineText), lastLineText));
		}

		if (progressRow) {
			rows.push(progressRow);
		}

		rows.push(bot);
		return rows;
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
					const lines: string[] = [];

					// ── Header summary bar (opencode-style) ──
					const running = items.filter((c) => c.status === "running").length;
					const done = items.filter((c) => c.status === "done").length;
					const errored = items.filter((c) => c.status === "error").length;
					const idle = items.filter((c) => c.status === "idle").length;

					const WIDGET_SPINNERS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
					const wSpinIdx = Math.floor(Date.now() / 80) % WIDGET_SPINNERS.length;
					const spinChar = running > 0 ? WIDGET_SPINNERS[wSpinIdx] : "●";

					const headerParts: string[] = [];
					headerParts.push(theme.fg("accent", theme.bold(` ${spinChar} Agents`)));
					if (running > 0) headerParts.push(theme.fg("accent", ` ${running} running`));
					if (done > 0) headerParts.push(theme.fg("success", ` ${done} done`));
					if (errored > 0) headerParts.push(theme.fg("error", ` ${errored} error`));
					if (idle > 0) headerParts.push(theme.fg("dim", ` ${idle} idle`));

					const headerLeft = headerParts.join(theme.fg("dim", " ·"));
					const roleName = runtime.role === "orchestrator" ? "Orchestrator" : "Lead";
					const headerRight = theme.fg("dim", `${roleName} `);
					const headerPad = Math.max(0, width - visibleWidth(headerLeft) - visibleWidth(headerRight));
					lines.push(truncateToWidth(headerLeft + " ".repeat(headerPad) + headerRight, width));
					lines.push(theme.fg("accent", "━".repeat(Math.min(4, width))) + theme.fg("dim", "─".repeat(Math.max(0, width - 4))));

					// ── Cards grid ──
					const cols = Math.min(runtime.role === "orchestrator" ? 3 : 2, items.length);
					const gap = 1;
					const colWidth = Math.floor((width - gap * (cols - 1)) / cols);

					for (let i = 0; i < items.length; i += cols) {
						const rowItems = items.slice(i, i + cols);
						const cardRows = rowItems.map((item) => renderCard(item, colWidth, theme));

						// Normalize card heights (cards now vary in height)
						const maxHeight = Math.max(...cardRows.map((cr) => cr.length));
						for (const cr of cardRows) {
							while (cr.length < maxHeight) {
								cr.push(" ".repeat(colWidth));
							}
						}

						// Fill remaining columns with blanks
						while (cardRows.length < cols) cardRows.push(Array(maxHeight).fill(" ".repeat(colWidth)));

						for (let row = 0; row < maxHeight; row++) {
							lines.push(cardRows.map((card) => card[row] || "").join(" ".repeat(gap)));
						}
					}

					// ── Footer status bar ──
					const totalElapsed = items.reduce((sum, c) => sum + (c.status !== "idle" ? c.elapsed : 0), 0);
					const totalRuns = items.reduce((sum, c) => sum + c.runCount, 0);
					const footerLeft = theme.fg("dim", ` ${items.length} agents · ${totalRuns} total runs`);
					const footerRight = totalElapsed > 0
						? theme.fg("dim", `${Math.round(totalElapsed / 1000)}s elapsed `)
						: "";
					const footerPad = Math.max(0, width - visibleWidth(footerLeft) - visibleWidth(footerRight));
					lines.push(theme.fg("dim", "─".repeat(width)));
					lines.push(truncateToWidth(footerLeft + " ".repeat(footerPad) + footerRight, width));

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

	function resolveWorkerOwnerLead(targetName: string): { lead: AgentConfig; team: TeamConfig; worker: AgentConfig } | null {
		if (!config || !runtime || runtime.role !== "orchestrator") return null;
		for (const team of config.teams) {
			const worker = team.members.find((member) => matchesName(member.name, targetName));
			if (worker) return { lead: team.lead, team, worker };
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

	function usageTotalsFromSessionLines(raw: string): { input: number; output: number; cost: number } {
		let input = 0;
		let output = 0;
		let cost = 0;
		for (const line of `${raw || ""}`.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line);
				if (parsed?.type !== "message" || parsed?.message?.role !== "assistant") continue;
				input += parsed.message?.usage?.input || 0;
				output += parsed.message?.usage?.output || 0;
				cost += parsed.message?.usage?.cost?.total || 0;
			} catch { }
		}
		return { input, output, cost };
	}

	function branchUsageTotals(ctx: any): { input: number; output: number; cost: number } {
		let input = 0;
		let output = 0;
		let cost = 0;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			const message = entry.message as AssistantMessage;
			input += message.usage?.input || 0;
			output += message.usage?.output || 0;
			cost += message.usage?.cost?.total || 0;
		}
		return { input, output, cost };
	}

	function crewUsageTotals(excludeAgentName?: string): { input: number; output: number; cost: number } {
		const totals = { input: 0, output: 0, cost: 0 };
		const stateDir = resolve(currentSessionRoot(), "state");
		if (!existsSync(stateDir)) return totals;
		const excluded = excludeAgentName ? `${slugify(excludeAgentName)}.session.jsonl` : "";
		for (const entry of readdirSync(stateDir)) {
			if (!entry.endsWith(".session.jsonl")) continue;
			if (excluded && entry === excluded) continue;
			const filePath = resolve(stateDir, entry);
			try {
				if (!statSync(filePath).isFile()) continue;
				const usage = usageTotalsFromSessionLines(readFileSync(filePath, "utf-8"));
				totals.input += usage.input;
				totals.output += usage.output;
				totals.cost += usage.cost;
			} catch { }
		}
		return totals;
	}

	function buildDelegationPrompt(target: DispatchTarget, task: string): string {
		const parentLabel = `${displayName(runtime!.agent.name)} (${runtime!.role})`;
		const targetRole = target.role === "lead" ? `team lead for ${target.team?.name}` : `worker in ${target.team?.name}`;
		const workerRoster = target.role === "lead"
			? (target.team?.members || []).map((member) => member.name)
			: [];
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
			"1. Outcome (one sentence)",
			"2. Files changed (list or 'none')",
			"3. Artifact references (if delegation returned artifact refs, forward them verbatim)",
			"4. Risks or blockers (if any)",
		];
		if (target.role === "lead") {
			lines.push(
				"",
				"Authoritative worker roster for your team:",
				`- ${workerRoster.join(", ") || "(none)"}`,
				"",
				"Lead rules:",
				"- Use the roster above as the source of truth for worker names in this turn.",
				"- If asked for team status, report each worker from this roster.",
				"- If status cannot be confirmed, mark worker status as unknown (do not claim missing roster).",
				"- Use delegate_agent or delegate_agents_parallel to ping workers when needed.",
				"",
				"Artifact reference protocol:",
				"- When a worker returns [artifact] refs in its result, FORWARD THOSE REFS VERBATIM in your response.",
				"- Do NOT summarize or rephrase artifact refs — they contain paths and hashes the parent needs.",
				"- Do NOT read the artifact files and relay their content — the parent will read them on demand.",
				"- If you need to check worker output yourself, read the artifact, but still forward the ref.",
				"- Your response should be: outcome + files changed + forwarded artifact refs + blockers.",
			);
		}
		if (target.role === "worker") {
			lines.push(
				"",
				"Rules:",
				"- Execute the repo work needed in this turn.",
				"- Do not claim success without concrete operations or verification.",
				"- If blocked, report the blocker directly and stop.",
				`- Note: Your work root is the repository root (regardless of your prompt depth).`,
				`- All paths passed to tools (read, write, ls, edit, etc.) should be relative to the repository root.`,
				`- Do not use ".." to reach the repository root.`,
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

	function outputSignalsBlocked(output: string): boolean {
		const text = output.toLowerCase();
		return text.includes("blocked by ")
			|| text.includes("ownership guardrail")
			|| text.includes("access denied")
			|| text.includes("permission denied")
			|| text.includes("read access denied")
			|| text.includes("rate limit")
			|| text.includes("429")
			|| text.includes("no api key found")
			|| text.includes("missing api key");
	}

	function sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
	}

	function isRetryableDelegationFailure(output: string): boolean {
		const text = output.toLowerCase();
		return text.includes("lock file is already being held")
			|| text.includes("startup, global settings")
			|| text.includes("startup, project settings")
			|| text.includes("no api key found for openai-codex")
			|| text.includes("no models match pattern \"openai-codex/")
			|| text.includes("no models match pattern 'openai-codex/");
	}

	function isModelFallbackFailure(output: string): boolean {
		const text = output.toLowerCase();
		return text.includes("no endpoints available matching your guardrail restrictions")
			|| text.includes("no models match pattern")
			|| text.includes("model not found")
			|| text.includes("provider returned error")
			|| text.includes("404 no endpoints available");
	}

	function isKiloRuntimeConfig(configRef: ResolvedConfig | null | undefined): boolean {
		const configPath = `${configRef?.configPath || ""}`;
		return configPath.includes("/.kilo/") || configPath.includes("\\.kilo\\");
	}

	function delegationRuntimeCli(configRef: ResolvedConfig | null | undefined): string {
		const runtimeFromEnv = `${process.env.MAH_RUNTIME || ""}`.trim().toLowerCase();
		if (runtimeFromEnv === "kilo") return "kilo";
		if (runtimeFromEnv === "pi") return "pi";
		return isKiloRuntimeConfig(configRef) ? "kilo" : "pi";
	}

	function modelCandidates(ctx: any, child: DispatchTarget): string[] {
		if (isKiloRuntimeConfig(config)) return [];
		const primary = currentModel(ctx, effectiveModel(config!, child.agent) || child.agent.model);
		const fallbacks = Array.isArray(child.agent.model_fallbacks) ? child.agent.model_fallbacks : [];
		return Array.from(new Set([primary, ...fallbacks].map((item) => `${item || ""}`.trim()).filter(Boolean)));
	}

	function shouldResumeChildSession(child: DispatchTarget, sessionFile: string): boolean {
		if (!existsSync(sessionFile)) return false;
		return false;
	}

	async function dispatchChildWithRetry(
		targetName: string,
		task: string,
		ctx: any,
		options?: {
			maxAttempts?: number;
			baseDelayMs?: number;
			onRetry?: (attempt: number, maxAttempts: number, reason: string) => void;
		},
	): Promise<{ output: string; exitCode: number; elapsed: number; child?: DispatchTarget; artifactPath?: string; attempts: number; retried: boolean }> {
		const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
		const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 350);
		const child = config && runtime ? resolveTarget(targetName) : null;
		const candidates = child ? modelCandidates(ctx, child) : [];
		let modelIndex = 0;
		let attempt = 0;
		let lastResult: { output: string; exitCode: number; elapsed: number; child?: DispatchTarget; artifactPath?: string } = {
			output: "Delegation did not run.",
			exitCode: 1,
			elapsed: 0,
		};

		while (attempt < maxAttempts) {
			attempt += 1;
			const modelOverride = candidates[modelIndex] || "";
			lastResult = await dispatchChild(targetName, task, ctx, { modelOverride: modelOverride || undefined });
			if (lastResult.exitCode === 0) {
				return { ...lastResult, attempts: attempt, retried: attempt > 1 };
			}
			if (isModelFallbackFailure(lastResult.output) && modelIndex < candidates.length - 1) {
				modelIndex += 1;
				options?.onRetry?.(
					attempt + 1,
					maxAttempts,
					`switching model to ${candidates[modelIndex]} after ${shortText(firstUsefulLine(lastResult.output), 120)}`,
				);
				continue;
			}
			if (!isRetryableDelegationFailure(lastResult.output) || attempt >= maxAttempts) {
				break;
			}
			const delayMs = baseDelayMs * attempt;
			options?.onRetry?.(attempt + 1, maxAttempts, shortText(firstUsefulLine(lastResult.output), 180));
			await sleep(delayMs);
		}

		return { ...lastResult, attempts: attempt, retried: attempt > 1 };
	}

	function dispatchChild(
		targetName: string,
		task: string,
		ctx: any,
		options?: { modelOverride?: string; thinkingLevel?: string },
	): Promise<{ output: string; exitCode: number; elapsed: number; child?: DispatchTarget; artifactPath?: string }> {
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

		const activeKey = `${runtime!.agent.name}:${targetName}`;
		if (activeDelegations.has(activeKey)) {
			return Promise.resolve({
				output: `${displayName(targetName)} is already being delegated by ${runtime!.agent.name}. Please wait for the current delegation to complete before issuing another.`,
				exitCode: 1,
				elapsed: 0,
				child,
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
			card.timer = (globalThis.setInterval(() => {
				card.elapsed = Date.now() - startTime;
				updateWidget();
			}, 1000) as any);
			if (typeof card.timer?.unref === "function") {
				card.timer.unref();
			}
		}

		const model = options?.modelOverride || currentModel(ctx, effectiveModel(config, child.agent) || child.agent.model);
		const prompt = buildDelegationPrompt(child, task);
		const extensionPath = SELF_EXTENSION_PATH;
		const mcpBridgePath = SELF_MCP_BRIDGE_PATH;
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
			"--thinking", options?.thinkingLevel ?? currentThinkingLevel,
			"--session", sessionFile,
		];
		if (spawnTools.length > 0) {
			args.splice(args.indexOf("--session"), 0, "--tools", spawnTools.join(","));
		}
		if (existsSync(mcpBridgePath)) args.splice(args.indexOf("-e"), 0, "-e", mcpBridgePath);
		if (resumeSession) args.push("-c");
		if (model && !isKiloRuntimeConfig(config)) args.push("--model", model);
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
		const stderrChunks: string[] = [];
		const collectedAssistantTexts = new Set<string>();
		let functionallyDone = false;

		let resolvePromise: (res: { output: string; exitCode: number; elapsed: number; child?: DispatchTarget; artifactPath?: string }) => void;
		const resultPromise = new Promise<{ output: string; exitCode: number; elapsed: number; child?: DispatchTarget; artifactPath?: string }>((resolve) => {
			resolvePromise = resolve;
		});

		activeDelegations.set(activeKey, resultPromise);
		resultPromise.then(() => activeDelegations.delete(activeKey)).catch(() => activeDelegations.delete(activeKey));

		const delegationCli = delegationRuntimeCli(config);
		const proc = spawn(delegationCli, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				MAH_MULTI_CONFIG: config!.configPath,
				MAH_MULTI_ROLE: child.role,
				MAH_MULTI_AGENT: child.agent.name,
				MAH_MULTI_TEAM: child.team?.name || "",
				MAH_MULTI_SESSION_ID: currentSessionId(),
				MAH_MULTI_SESSION_ROOT: currentSessionRoot(),
				MAH_MULTI_PARENT: runtime!.agent.name,
				MAH_MULTI_DEPTH: String(currentDepth() + 1),
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
					const pushAssistantText = (text: string) => {
						const raw = text || "";
						if (!raw) return;
						const trimmed = raw.trim();
						if (!trimmed) {
							// For pure whitespace deltas, we still want to add them to textChunks
							// but we don't need to update the card.lastLine again
							textChunks.push(raw);
							return;
						}

						textChunks.push(raw);
						if (card) {
							const fullCurrentResponse = textChunks.join("");
							const lines = fullCurrentResponse.split("\n").filter((row) => row.trim());
							card.lastLine = lines.pop() || "";
							updateWidget();
						}
					};
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "toolcall_start") {
							const toolName = delta.partial?.content?.[delta.contentIndex || 0]?.name
								|| event.message?.content?.[delta.contentIndex || 0]?.name
								|| "";
							if (toolName) toolCalls.push(toolName);
						}
						if (delta?.type === "text_delta") {
							pushAssistantText(delta.delta || "");
						}
					}

					if (event.type === "turn_end" || event.type === "agent_end") {
						// Only fallback to full messages if we didn't receive any streaming deltas
						if (textChunks.length === 0) {
							const fromMessages = extractAssistantMessageText(event.messages || []);
							if (fromMessages) pushAssistantText(fromMessages);
							const fromEvent = extractStructuredText(event.message || event.output || event.response || event.final || event.result);
							if (fromEvent) pushAssistantText(fromEvent);
						}
					}
				} catch { }
			}
		});

		proc.stderr!.setEncoding("utf-8");
		proc.stderr!.on("data", (chunk: string) => {
			stderrChunks.push(chunk);
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
					// Only fallback if we don't have deltas
					if (textChunks.length === 0) {
						const fromMessages = extractAssistantMessageText(event.messages || []);
						if (fromMessages && !collectedAssistantTexts.has(fromMessages)) {
							collectedAssistantTexts.add(fromMessages);
							textChunks.push(fromMessages);
						}
						const fromEvent = extractStructuredText(event.message || event.output || event.response || event.final || event.result);
						if (fromEvent && !collectedAssistantTexts.has(fromEvent)) {
							collectedAssistantTexts.add(fromEvent);
							textChunks.push(fromEvent);
						}
					}
				} catch { }
			}

			if (card?.timer) clearInterval(card.timer);
			const elapsed = Date.now() - startTime;
			const output = textChunks.join("");
			const stderrOutput = stderrChunks.join("").trim();
			const childExitCode = code ?? 1;
			const realToolCalls = toolCalls.filter((tool) => tool && tool !== "update_expertise_model");

			const executionPostureFailure = child.role === "worker"
				&& childExitCode === 0
				&& realToolCalls.length === 0
				&& !outputSignalsBlocked(output);
			const effectiveExitCode = executionPostureFailure ? 2 : childExitCode;
			let effectiveOutput = executionPostureFailure
				? [
					output || "(empty)",
					"",
					"[Runtime] Worker returned without any concrete tool execution in this turn.",
					`[Runtime] Detected tool calls: ${toolCalls.join(", ") || "(none)"}`,
					`[Runtime] Resumed prior session: ${resumeSession ? "yes" : "no"}`,
				].join("\n")
				: output;

			if (effectiveExitCode !== 0 && !effectiveOutput.trim() && stderrOutput) {
				const compactStderr = stderrOutput.length > 6000 ? stderrOutput.slice(-6000) : stderrOutput;
				effectiveOutput = `[stderr]\n${compactStderr}`;
			}

			if (card) {
				if (!functionallyDone || effectiveExitCode !== 0) {
					if (!functionallyDone) {
						card.status = effectiveExitCode === 0 ? "done" : "error";
					} else if (effectiveExitCode !== 0 && effectiveExitCode !== 137 && code !== null) {
						card.status = "error";
					}
				}
				card.elapsed = elapsed;
				if (!card.lastLine || card.lastLine.startsWith("Running") || card.lastLine === "Done (Functional)") {
					card.lastLine = effectiveOutput.split("\n").filter((line) => line.trim()).pop() || (effectiveExitCode === 0 ? "Done" : `Error ${effectiveExitCode}`);
				}
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
				artifactPath,
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
			appendEvent("delegate_error", { target: child.agent.name, error: err.message });
			resolvePromise({
				output: `Error spawning ${child.agent.name}: ${err.message}`,
				exitCode: 1,
				elapsed: Date.now() - startTime,
				child,
			});
		});

		return resultPromise;
	}

	function protectWorkerPaths(event: any, ctx: any, pending: PendingToolCall | null) {
		if (!config || !runtime) return { block: false };

		const domain = effectiveDomain(config, runtime.agent);
		const domainRules = normalizeDomainRules(config, domain);
		const approvalBlock = (absolutePath: string, operation: "read" | "upsert" | "delete", toolName: string, rule: NormalizedDomainRule) => {
			const relativePath = toConfigRelative(config, absolutePath);
			if (!isInteractiveApprovalAvailable()) {
				return block(`explicit TUI approval required for ${operation} access to ${relativePath}, but this session is headless/non-interactive`);
			}
			const approval = requestDomainApproval({
				agentName: runtime.agent.name,
				toolName,
				absolutePath,
				relativePath,
				operation,
				rule,
			});
			ctx.ui.notify(
				[
					"Domain approval required",
					formatPendingDomainApproval(approval),
					`Approve in this TUI with: /approve-domain ${approval.id}`,
					`Or deny with: /deny-domain ${approval.id}`,
				].join("\n"),
				"warning",
			);
			return block(`approval required for ${operation} access to ${relativePath}; approve with /approve-domain ${approval.id}`);
		};

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
			const inputPath = event.input.path ? resolve(config.repoRoot, event.input.path) : config.repoRoot;
			const evaluation = evaluateDomainPermission(runtime.agent.name, inputPath, domainRules, "read");
			if (!evaluation.allowed && evaluation.approvalRequired && evaluation.rule) {
				return approvalBlock(inputPath, "read", event.toolName, evaluation.rule);
			}
			if (!evaluation.allowed) {
				return block(`read access denied for ${event.input.path || "."}`);
			}
		}

		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const inputPath = resolve(config.repoRoot, event.input.path || ".");
			const evaluation = evaluateDomainPermission(runtime.agent.name, inputPath, domainRules, "upsert");
			if (!evaluation.allowed && evaluation.approvalRequired && evaluation.rule) {
				return approvalBlock(inputPath, "upsert", event.toolName, evaluation.rule);
			}
			if (!evaluation.allowed) {
				return block(`upsert access denied for ${event.input.path || "."}`);
			}
		}

		if (isToolCallEventType("bash", event)) {
			const command = event.input.command as string;
			if (/\bsudo\b/.test(command)) {
				return block("sudo is not allowed inside worker bash.");
			}
			const pathTokens = extractPathLikeTokens(command).map((token) => resolve(config.repoRoot, token));
			for (const token of pathTokens) {
				const evaluation = evaluateDomainPermission(runtime.agent.name, token, domainRules, "read");
				if (!evaluation.allowed && evaluation.approvalRequired && evaluation.rule) {
					return approvalBlock(token, "read", event.toolName, evaluation.rule);
				}
				if (!evaluation.allowed) {
					return block(`bash references path outside read scope: ${token}`);
				}
			}
			if (isMutatingBash(command)) {
				const permission: "upsert" | "delete" = isDeleteBash(command) ? "delete" : "upsert";
				for (const token of pathTokens) {
					const evaluation = evaluateDomainPermission(runtime.agent.name, token, domainRules, permission);
					if (!evaluation.allowed && evaluation.approvalRequired && evaluation.rule) {
						return approvalBlock(token, permission, event.toolName, evaluation.rule);
					}
					if (!evaluation.allowed) {
						return block(`bash ${permission} access denied for ${token}`);
					}
				}
			}
		}

		return { block: false };
	}

	pi.registerTool({
		name: "update_expertise_model",
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
					content: [{ type: "text", text: `Expertise model is not updatable for ${runtime.agent.name}.` }],
					details: { status: "error", agent: runtime.agent.name },
				};
			}

			const { note, category } = params as { note: string; category?: string };
			appendMentalModelNote(runtime.agent, note, category);
			const path = config ? expertisePathFor(runtime.agent) : "";
			return {
				content: [{ type: "text", text: `Expertise model updated for ${runtime.agent.name}\n${path}` }],
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
			const note = shortTextChars((args as any).note || "", 60);
			return new Text(
				theme.fg("toolTitle", theme.bold("update_expertise_model ")) +
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
			let effectiveTarget = target;
			let effectiveTask = task;
			let rerouted: null | { originalTarget: string; lead: string; team: string; worker: string } = null;

			if (runtime?.role === "orchestrator" && !resolveTarget(target)) {
				const owner = resolveWorkerOwnerLead(target);
				if (owner) {
					effectiveTarget = owner.lead.name;
					effectiveTask = `${task}\n\nRouting note from orchestrator:\n- Requested worker target: ${owner.worker.name}\n- Team: ${owner.team.name}\n- Delegate internally ONLY to this worker and return worker-specific status/evidence.`;
					rerouted = {
						originalTarget: target,
						lead: owner.lead.name,
						team: owner.team.name,
						worker: owner.worker.name,
					};
				}
			}

			if (onUpdate) {
				onUpdate({
					content: [{ type: "text", text: `Delegating to ${effectiveTarget}...` }],
					details: {
						target: effectiveTarget,
						task: effectiveTask,
						status: "dispatching",
						rerouted,
					},
				});
			}

			const result = await dispatchChild(effectiveTarget, effectiveTask, ctx);
			const status = result.exitCode === 0 ? "done" : "error";
			const elapsed = Math.round(result.elapsed / 1000);
			const header = rerouted
				? `[rerouted ${rerouted.originalTarget} -> ${rerouted.lead}] `
				: "";
			const body = buildDelegationResultContent(
				effectiveTarget, status, elapsed, result.output,
				result.artifactPath || null, header,
			);

			// Record evidence (best-effort — never block delegation result)
			;(async () => {
				try {
					const { recordEvidence } = await import("../scripts/expertise-evidence-store.mjs");
					const crew = process.env.MAH_ACTIVE_CREW || "dev";
					await recordEvidence({
						expertise_id: `${crew}:${effectiveTarget}`,
						outcome: result.exitCode === 0 ? "success" : "failure",
						task_type: deriveTaskType(effectiveTask),
						task_description: sanitizeTaskDescription(effectiveTask, 200),
						duration_ms: Math.round(result.elapsed),
						source_agent: runtime!.agent.name,
						source_session: currentSessionId() || "unknown",
					});
				} catch {
					// best-effort
				}
			})();

			return {
				content: [{ type: "text", text: body }],
				details: {
					target: effectiveTarget,
					task: effectiveTask,
					status,
					elapsed: result.elapsed,
					exitCode: result.exitCode,
					fullOutput: result.output,
					artifactPath: result.artifactPath || null,
					rerouted,
				},
			}
		},
		renderCall(args, theme) {
			const target = (args as any).target || "?";
			const task = shortTextChars((args as any).task || "", 60);
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

	pi.registerTool({
		name: "delegate_agents_parallel",
		label: "Delegate Agents Parallel",
		description: "Delegate the same focused task to multiple allowed child agents in parallel.",
		parameters: Type.Object({
			targets: Type.Array(
				Type.String({ description: "Target agent or team name." }),
				{ minItems: 1, maxItems: 12 },
			),
			task: Type.String({ description: "Focused delegation task sent to each target." }),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { targets, task } = params as { targets: string[]; task: string };
			const cleanedTargets = Array.from(
				new Set((targets || []).map((target) => `${target || ""}`.trim()).filter(Boolean)),
			);

			if (cleanedTargets.length === 0) {
				return {
					content: [{ type: "text", text: "No valid targets provided." }],
					details: { status: "error", total: 0, successCount: 0, failedCount: 0, results: [] },
				};
			}

			const reroutedWorkersByLead = new Map<string, { teamName: string; workers: Set<string> }>();
			const unresolvedTargets: string[] = [];
			const effectiveTargets: string[] = [];

			for (const target of cleanedTargets) {
				const direct = resolveTarget(target);
				if (direct) {
					if (!effectiveTargets.includes(direct.agent.name)) effectiveTargets.push(direct.agent.name);
					continue;
				}

				const owner = resolveWorkerOwnerLead(target);
				if (owner) {
					if (!effectiveTargets.includes(owner.lead.name)) effectiveTargets.push(owner.lead.name);
					const current = reroutedWorkersByLead.get(owner.lead.name) || { teamName: owner.team.name, workers: new Set<string>() };
					current.workers.add(owner.worker.name);
					reroutedWorkersByLead.set(owner.lead.name, current);
					continue;
				}

				unresolvedTargets.push(target);
			}

			if (effectiveTargets.length === 0) {
				return {
					content: [{ type: "text", text: `No resolvable targets. Requested: ${cleanedTargets.join(", ")}` }],
					details: {
						status: "error",
						targets: cleanedTargets,
						unresolvedTargets,
						total: 0,
						successCount: 0,
						failedCount: 0,
						results: [],
					},
				};
			}

			const alreadyDelegating: string[] = [];
			const uniqueEffectiveTargets: string[] = [];
			const parentKey = runtime!.agent.name;
			for (const target of effectiveTargets) {
				const activeKey = `${parentKey}:${target}`;
				if (activeDelegations.has(activeKey)) {
					alreadyDelegating.push(target);
				} else {
					uniqueEffectiveTargets.push(target);
				}
			}
			const effectiveTargetsFiltered = uniqueEffectiveTargets;
			const skippedForActive = alreadyDelegating.length;

			if (effectiveTargetsFiltered.length === 0 && skippedForActive > 0) {
				return {
					content: [{
						type: "text",
						text: `All targets are already being delegated by ${parentKey}. Please wait for current delegations to complete. Skipped: ${alreadyDelegating.join(", ")}`,
					}],
					details: {
						status: "error",
						targets: effectiveTargets,
						alreadyDelegating,
						total: effectiveTargets.length,
						successCount: 0,
						failedCount: skippedForActive,
						elapsed: 0,
						results: [],
					},
				};
			}

			if (onUpdate) {
				const reroutedCount = Array.from(reroutedWorkersByLead.values())
					.reduce((sum, item) => sum + item.workers.size, 0);
				const skippedMsg = skippedForActive > 0 ? ` (${skippedForActive} already active, skipped)` : "";
				const updateLine = reroutedCount > 0
					? `Delegating in parallel to ${effectiveTargetsFiltered.length} targets${skippedMsg} (rerouted ${reroutedCount} worker targets via leads)...`
					: `Delegating in parallel to ${effectiveTargetsFiltered.length} targets${skippedMsg}...`;
				onUpdate({
					content: [{ type: "text", text: updateLine }],
					details: {
						status: "dispatching",
						total: effectiveTargetsFiltered.length,
						completed: 0,
						targets: effectiveTargetsFiltered,
						alreadyDelegating,
						reroutedWorkersByLead: Array.from(reroutedWorkersByLead.entries()).map(([lead, info]) => ({
							lead,
							team: info.teamName,
							workers: Array.from(info.workers),
						})),
						unresolvedTargets,
					},
				});
			}

			const startedAt = Date.now();
			let completed = 0;

			const results = await Promise.all(
				effectiveTargetsFiltered.map(async (target, index) => {
					try {
						const rerouteInfo = reroutedWorkersByLead.get(target);
						const scopedTask = rerouteInfo
							? `${task}\n\nRouting note from orchestrator:\n- Requested worker targets for your team: ${Array.from(rerouteInfo.workers).join(", ")}\n- Team: ${rerouteInfo.teamName}\n- Delegate internally ONLY to these workers and return per-worker status/evidence.`
							: task;
						// Soft stagger to reduce auth/settings lock contention spikes.
						if (index > 0) {
							await sleep(Math.min(600, index * 120));
						}
						const result = await dispatchChildWithRetry(target, scopedTask, ctx, {
							maxAttempts: 3,
							baseDelayMs: 350,
							onRetry: (nextAttempt, maxAttempts, reason) => {
								if (!onUpdate) return;
								onUpdate({
									content: [{ type: "text", text: `Retrying ${target} (${nextAttempt}/${maxAttempts})` }],
									details: {
										status: "dispatching",
										total: effectiveTargetsFiltered.length,
										completed,
										target,
										retrying: true,
										reason,
									},
								});
							},
						});
						completed += 1;
						if (onUpdate) {
							onUpdate({
								content: [{ type: "text", text: `Parallel delegation progress: ${completed}/${effectiveTargetsFiltered.length} (${target})` }],
								details: { status: "dispatching", total: effectiveTargetsFiltered.length, completed, target },
							});
						}
						return { target, ...result };
					} catch (error) {
						completed += 1;
						const message = error instanceof Error ? error.message : String(error);
						if (onUpdate) {
							onUpdate({
								content: [{ type: "text", text: `Parallel delegation progress: ${completed}/${effectiveTargetsFiltered.length} (${target})` }],
								details: { status: "dispatching", total: effectiveTargetsFiltered.length, completed, target, error: message },
							});
						}
						return {
							target,
							output: `Error delegating to ${target}: ${message}`,
							exitCode: 1,
							elapsed: 0,
							attempts: 1,
							retried: false,
						};
					}
				}),
			);

			const elapsed = Date.now() - startedAt;
			const requestedTotal = cleanedTargets.length;
			const dispatchedTotal = effectiveTargetsFiltered.length;
			const successCount = results.filter((result) => result.exitCode === 0).length;
			const failedCount = requestedTotal - successCount - skippedForActive;
			const status = failedCount + skippedForActive === requestedTotal ? "error" : successCount === requestedTotal - skippedForActive ? "done" : "partial";

			const body = results.map((result) => {
				const icon = result.exitCode === 0 ? "✓" : "✗";
				const content = buildDelegationResultContent(
					result.target,
					result.exitCode === 0 ? "done" : "error",
					Math.round(result.elapsed / 1000),
					result.output,
					result.artifactPath || null,
				);
				return [
					`### ${icon} ${result.target}`,
					content,
				].join("\n");
			}).join("\n\n");

			// Record evidence for each target (best-effort — never block result)
			;(async () => {
				try {
					const { recordEvidence } = await import("../scripts/expertise-evidence-store.mjs");
					const crew = process.env.MAH_ACTIVE_CREW || "dev";
					for (const result of results) {
						try {
							await recordEvidence({
								expertise_id: `${crew}:${result.target}`,
								outcome: result.exitCode === 0 ? "success" : "failure",
								task_type: deriveTaskType(task),
								task_description: sanitizeTaskDescription(task, 200),
								duration_ms: Math.round(result.elapsed),
								source_agent: runtime!.agent.name,
								source_session: currentSessionId() || "unknown",
							});
						} catch {
							// best-effort per-target
						}
					}
				} catch {
					// best-effort
				}
			})();

			const rerouteSummary = Array.from(reroutedWorkersByLead.entries())
				.map(([lead, info]) => `- ${lead} (${info.teamName}): ${Array.from(info.workers).join(", ")}`)
				.join("\n");
			const unresolvedSummary = unresolvedTargets.length > 0
				? `\n\n### ✗ unresolved targets\n${unresolvedTargets.map((target) => `- ${target}`).join("\n")}`
				: "";
			const detailsHeader = rerouteSummary
				? `\n\n[reroute]\n${rerouteSummary}`
				: "";

			return {
				content: [{
					type: "text",
					text: `[parallel] ${status} ${successCount}/${requestedTotal} succeeded in ${Math.round(elapsed / 1000)}s${detailsHeader}${unresolvedSummary}${skippedForActive > 0 ? `\n\n[skipped - already active] ${alreadyDelegating.join(", ")}` : ""}\n\n${body}`,
				}],
				details: {
					status,
					targets: effectiveTargetsFiltered,
					requestedTargets: cleanedTargets,
					total: requestedTotal,
					dispatchedTotal,
					successCount,
					failedCount,
					elapsed,
					unresolvedTargets,
					alreadyDelegating: skippedForActive > 0 ? alreadyDelegating : undefined,
					reroutedWorkersByLead: Array.from(reroutedWorkersByLead.entries()).map(([lead, info]) => ({
						lead,
						team: info.teamName,
						workers: Array.from(info.workers),
					})),
					results: results.map((result) => ({
						target: result.target,
						exitCode: result.exitCode,
						elapsed: result.elapsed,
						attempts: result.attempts || 1,
						retried: !!result.retried,
						output: result.output,
					})),
				},
			};
		},

		renderCall(args, theme) {
			const targets = Array.isArray((args as any).targets) ? (args as any).targets : [];
			const task = shortTextChars((args as any).task || "", 60);
			return new Text(
				theme.fg("toolTitle", theme.bold("delegate_agents_parallel ")) +
				theme.fg("accent", `${targets.length || 0} targets`) +
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
				const completed = typeof details.completed === "number" ? details.completed : 0;
				const total = typeof details.total === "number" ? details.total : 0;
				return new Text(
					theme.fg("accent", "● parallel delegation") +
					theme.fg("dim", ` ${completed}/${total}`),
					0,
					0,
				);
			}

			const status = details.status === "done" ? "done" : details.status === "partial" ? "partial" : "error";
			const icon = status === "done" ? "✓" : status === "partial" ? "◐" : "✗";
			const color = status === "done" ? "success" : status === "partial" ? "warning" : "error";
			const elapsed = Math.round((details.elapsed || 0) / 1000);
			const successCount = details.successCount || 0;
			const total = details.total || 0;

			if (options.expanded && Array.isArray(details.results)) {
				const lines = details.results.map((item: any) => {
					const itemIcon = item.exitCode === 0 ? "✓" : "✗";
					const itemColor = item.exitCode === 0 ? "success" : "error";
					const itemElapsed = Math.round((item.elapsed || 0) / 1000);
					const attempts = item.attempts && item.attempts > 1
						? theme.fg("warning", ` · retries:${item.attempts - 1}`)
						: "";
					return theme.fg(itemColor, `${itemIcon} ${item.target}`) + theme.fg("dim", ` ${itemElapsed}s`) + attempts;
				});
				return new Text(
					theme.fg(color, `${icon} parallel delegation`) +
					theme.fg("dim", ` ${successCount}/${total} ${elapsed}s`) +
					"\n" +
					lines.join("\n"),
					0,
					0,
				);
			}

			return new Text(
				theme.fg(color, `${icon} parallel delegation`) +
				theme.fg("dim", ` ${successCount}/${total} ${elapsed}s`),
				0,
				0,
			);
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

	async function stopAllAgents(target: string | undefined, ctx: ExtensionContext) {
		if (!runtime) return;

		const targetLower = target?.trim().toLowerCase();
		const running = Array.from(childProcesses.entries());
		if (running.length === 0) {
			if (target) ctx.ui.notify("No running child agents.", "info");
			return;
		}

		const shouldStop = (name: string) =>
			!targetLower || targetLower === "all" || name.toLowerCase() === targetLower;

		let stopped = 0;
		for (const [name, proc] of running) {
			if (!shouldStop(name)) continue;
			try {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (childProcesses.has(name)) {
						try { proc.kill("SIGKILL"); } catch { }
						childProcesses.delete(name);
					}
				}, 1000);
			} catch { }
			childProcesses.delete(name);
			stopped++;

			const card = cards.get(childKey(name));
			if (card && card.status === "running") {
				card.status = "error";
				card.lastLine = target ? "Stopped by /stop" : "Stopped by [Shutdown]";
				updateWidget();
			}
		}

		appendEvent("delegate_stop", {
			target: target || "all",
			stopped,
		});

		if (stopped > 0 && ctx?.ui) {
			try {
				const label = target ? `target "${target}"` : "all running agents";
				ctx.ui.notify(`Stopped ${stopped} child process(es) for ${label}.`, "info");
			} catch { }
		}
	}

	pi.registerCommand("stop", {
		description: "Stop running multi-team child agents and return to idle",
		handler: async (args, ctx) => {
			if (!runtime) {
				ctx.ui.notify("Multi-team runtime not initialized.", "warning");
				return;
			}
			await stopAllAgents(args, ctx);
		},
	});

	pi.registerCommand("thinking", {
		description: "Control thinking level for child agents: /thinking [off|minimal|low|medium|high|xhigh]",
		handler: async (args, ctx) => {
			const commandText = args.trim() ? `/thinking ${args.trim()}` : "/thinking";
			const result = await handleThinkingCommand(commandText);
			if (result.response) {
				ctx.ui.notify(result.response, "info");
			}
		},
	});

	pi.registerCommand("domain-approvals", {
		description: "List pending domain approval requests and active temporary grants.",
		handler: async (_args, ctx) => {
			const pendingLines = pendingDomainApprovals.length > 0
				? pendingDomainApprovals.map((item) => `  pending ${formatPendingDomainApproval(item)}`)
				: ["  pending none"];
			const grantLines = domainApprovalGrants.length > 0
				? domainApprovalGrants.map((item) => `  grant #${item.id} agent=${item.agentName} op=${item.operation} scope=${item.scope} path=${item.absolutePath}`)
				: ["  grant none"];
			ctx.ui.notify(["Domain approvals", ...pendingLines, ...grantLines].join("\n"), "info");
		},
	});

	pi.registerCommand("approve-domain", {
		description: "Approve a pending domain request: /approve-domain [approval-id|latest]",
		handler: async (args, ctx) => {
			if (!isInteractiveApprovalAvailable()) {
				ctx.ui.notify("Domain approval is unavailable in headless/non-interactive mode.", "warning");
				return;
			}
			const pending = findPendingApprovalBySelector(args || "latest");
			if (!pending) {
				ctx.ui.notify("No matching pending domain approval request.", "warning");
				return;
			}
			const grant: DomainApprovalGrant = {
				id: pending.id,
				agentName: pending.agentName,
				absolutePath: pending.absolutePath,
				operation: pending.operation,
				scope: pending.scope,
				grantedAt: new Date().toISOString(),
				rulePath: pending.rulePath,
			};
			domainApprovalGrants.push(grant);
			const index = pendingDomainApprovals.findIndex((item) => item.id === pending.id);
			if (index >= 0) pendingDomainApprovals.splice(index, 1);
			appendEvent("domain_approval_granted", {
				approval_id: pending.id,
				target_agent: pending.agentName,
				path: pending.relativePath,
				operation: pending.operation,
				scope: pending.scope,
			});
			ctx.ui.notify(`Approved ${formatPendingDomainApproval(pending)}`, "info");
		},
	});

	pi.registerCommand("deny-domain", {
		description: "Deny and clear a pending domain request: /deny-domain [approval-id|latest]",
		handler: async (args, ctx) => {
			const pending = findPendingApprovalBySelector(args || "latest");
			if (!pending) {
				ctx.ui.notify("No matching pending domain approval request.", "warning");
				return;
			}
			const index = pendingDomainApprovals.findIndex((item) => item.id === pending.id);
			if (index >= 0) pendingDomainApprovals.splice(index, 1);
			appendEvent("domain_approval_denied", {
				approval_id: pending.id,
				target_agent: pending.agentName,
				path: pending.relativePath,
				operation: pending.operation,
				scope: pending.scope,
			});
			ctx.ui.notify(`Denied ${formatPendingDomainApproval(pending)}`, "info");
		},
	});

	pi.on("input", async (event, _ctx) => {
		if (!runtime) {
			return { action: "continue" as const };
		}
		const text = extractStructuredText((event as any).message || (event as any).content || (event as any).input || (event as any).text || event);
		if (text) {
			if (text.startsWith("/compact")) {
				return handleCompactCommand(text);
			}
			if (text.startsWith("/thinking")) {
				return handleThinkingCommand(text);
			}
			appendConversation("user", text, {
				source: currentParentAgent() ? "delegation" : "user",
			});
		}
		return { action: "continue" as const };
	});

	async function handleCompactCommand(text: string): Promise<{ action: string; response?: string }> {
		const args = text.slice("/compact".length).trim();
		const parts = args.split(/\s+/).filter(Boolean);
		let keepRecent = 20;
		let maxTokens = 150000;
		let dryRun = false;
		for (let i = 0; i < parts.length; i++) {
			if (parts[i] === "--keep" || parts[i] === "-k") {
				keepRecent = parseInt(parts[i + 1]) || keepRecent;
				i++;
			} else if (parts[i] === "--tokens" || parts[i] === "-t") {
				maxTokens = parseInt(parts[i + 1]) || maxTokens;
				i++;
			} else if (parts[i] === "--dry-run" || parts[i] === "-n") {
				dryRun = true;
			} else if (parts[i] === "--help" || parts[i] === "-h") {
				return {
					action: "respond",
					response: `**/compact** - Compact session to reduce token count

Usage: /compact [options]

Options:
  -k, --keep <N>      Keep N most recent conversation turns (default: 20)
  -t, --tokens <N>   Target max tokens (default: 150000)
  -n, --dry-run      Show what would be compacted without applying
  -h, --help         Show this help

Examples:
  /compact              Compact to ~150k tokens, keep 20 turns
  /compact --keep 50   Keep 50 recent turns
  /compact --tokens 80000  Target 80k tokens
  /compact --dry-run    Preview compaction without changes`
				};
			}
		}

		if (!sessionRoot || !existsSync(sessionRoot)) {
			return { action: "respond", response: "No active session found." };
		}

		const convPath = resolve(sessionRoot, "conversation.jsonl");
		if (!existsSync(convPath)) {
			return { action: "respond", response: "No conversation file found." };
		}

		const lines = readFileSync(convPath, "utf-8").split("\n").filter(Boolean);
		const totalLines = lines.length;
		const estimatedTokens = totalLines * 150;

		if (dryRun) {
			return {
				action: "respond",
				response: `**Compaction Preview**\n` +
					`- Current turns: ${totalLines}\n` +
					`- Estimated tokens: ~${estimatedTokens.toLocaleString()}\n` +
					`- Target tokens: ~${maxTokens.toLocaleString()}\n` +
					`- Would keep: ${Math.min(totalLines, keepRecent * 2)} turns\n` +
					`- Would remove: ${Math.max(0, totalLines - keepRecent * 2)} turns`
			};
		}

		const targetTurns = Math.max(keepRecent * 2, Math.ceil(maxTokens / 150));
		const keptLines = lines.slice(-targetTurns);
		const removedCount = totalLines - keptLines.length;

		if (keptLines.length < lines.length) {
			writeFileSync(convPath, keptLines.join("\n") + "\n");
		}

		const newTokens = keptLines.length * 150;
		const savedTokens = estimatedTokens - newTokens;

		appendEvent("session_compacted", {
			beforeTurns: totalLines,
			afterTurns: keptLines.length,
			beforeTokens: estimatedTokens,
			afterTokens: newTokens,
			savedTokens,
			keepRecent,
			maxTokens,
		});

		return {
			action: "respond",
			response: `**Session Compacted** ✓\n` +
				`- Before: ~${estimatedTokens.toLocaleString()} tokens (${totalLines} turns)\n` +
				`- After: ~${newTokens.toLocaleString()} tokens (${keptLines.length} turns)\n` +
				`- Saved: ~${savedTokens.toLocaleString()} tokens (${Math.round(savedTokens / estimatedTokens * 100)}% reduction)\n` +
				`- Removed: ${removedCount} conversation turns`
		};
	}

	const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

	async function handleThinkingCommand(text: string): Promise<{ action: string; response?: string }> {
		const args = text.slice("/thinking".length).trim();
		const parts = args.split(/\s+/).filter(Boolean);
		const subcommand = parts[0]?.toLowerCase();

		if (!subcommand || subcommand === "status" || subcommand === "show") {
			return {
				action: "respond",
				response: `**Thinking Level**: ${currentThinkingLevel}\n\nValid levels: ${VALID_THINKING_LEVELS.join(", ")}`
			};
		}

		if (subcommand === "help") {
			return {
				action: "respond",
				response: `**/thinking** - Control thinking level for child agents
Usage: /thinking [level|help]

Valid levels:
  off      No thinking
  minimal  Minimal reasoning (default)
  low      Low reasoning
  medium   Medium reasoning
  high     High reasoning
  xhigh    Extra high reasoning

Examples:
  /thinking        Show current level
  /thinking high   Set to high reasoning
  /thinking medium Set to medium reasoning
  /thinking help   Show this help

Note: Controls thinking level for delegated child agents only.`
			};
		}

		if (VALID_THINKING_LEVELS.includes(subcommand)) {
			currentThinkingLevel = subcommand;
			return {
				action: "respond",
				response: `Thinking level set to **${currentThinkingLevel}**`
			};
		}

		return {
			action: "respond",
			response: `Invalid thinking level "${subcommand}". Valid levels: ${VALID_THINKING_LEVELS.join(", ")}`
		};
	}

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
		if (widgetCtx) {
			await stopAllAgents(undefined, widgetCtx);
		}
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

	// Robust signal handling for ghost processes
	const handleExit = async () => {
		if (childProcesses.size > 0 && widgetCtx) {
			await stopAllAgents(undefined, widgetCtx);
		}
	};
	process.on("SIGINT", handleExit);
	process.on("SIGTERM", handleExit);

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
			`/multi-team-tree  Print hierarchy\n` +
			`/thinking         Control thinking level`,
			"info",
		);

		const hintFile = resolve(ctx.cwd, ".pi", ".mah_hint_nl");
		let hintCount = 0;
		try { if (existsSync(hintFile)) hintCount = parseInt(readFileSync(hintFile, "utf-8"), 10) || 0; } catch { }
		const showNewlineHint = hintCount < 3;
		if (showNewlineHint) {
			try { writeFileSync(hintFile, String(hintCount + 1)); } catch { }
		}

		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => { },
			invalidate() { },
			render(width: number): string[] {
				const model = (ctx.model?.id || "no-model").trim();
				const usage = ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const barSlots = width < 84 ? 6 : width < 110 ? 8 : 10;
				const filled = Math.round((pct / 100) * barSlots);
				const bar = "#".repeat(filled) + "-".repeat(barSlots - filled);

				let modelLabel = model;
				let roleLabel = runtime!.team ? `${runtime!.role}:${runtime!.team.name}` : runtime!.role;
				const sessionId = currentSessionId();
				let sessionLabel = sessionId;

				const separator = " · ";
				const buildPlainLeft = () => ` ${modelLabel}${separator}${roleLabel}${separator}${sessionLabel}`;

				const branchTotals = branchUsageTotals(ctx);
				const crewTotals = crewUsageTotals(runtime?.role === "orchestrator" ? undefined : runtime?.agent.name);
				const tokIn = branchTotals.input + crewTotals.input;
				const tokOut = branchTotals.output + crewTotals.output;
				const cost = branchTotals.cost + crewTotals.cost;

				const pctLabel = `${Math.round(pct)}% `;
				const tokenInLabel = formatTokenCount(tokIn);
				const tokenOutLabel = formatTokenCount(tokOut);
				const costLabel = `$${cost.toFixed(cost < 0.01 ? 4 : 3)}`;

				const rightCandidates = [
					theme.fg("success", tokenInLabel) +
					theme.fg("dim", " in ") +
					theme.fg("accent", tokenOutLabel) +
					theme.fg("dim", " out ") +
					theme.fg("warning", costLabel) +
					theme.fg("muted", " crew") +
					theme.fg("muted", " · ") +
					theme.fg("dim", `[${bar}] ${pctLabel}`),
					theme.fg("success", tokenInLabel) +
					theme.fg("dim", "↑ ") +
					theme.fg("accent", tokenOutLabel) +
					theme.fg("dim", "↓ ") +
					theme.fg("warning", `${costLabel} `) +
					theme.fg("muted", "crew ") +
					theme.fg("muted", "· ") +
					theme.fg("dim", `[${bar}] ${pctLabel}`),
					theme.fg("success", tokenInLabel) +
					theme.fg("dim", "/") +
					theme.fg("accent", tokenOutLabel) +
					theme.fg("dim", " ") +
					theme.fg("dim", `[${bar}] ${pctLabel}`),
					theme.fg("dim", `[${bar}] ${pctLabel}`),
				];

				let right = rightCandidates[rightCandidates.length - 1];
				let maxLeft = Math.max(16, width - visibleWidth(right) - 1);

				if (buildPlainLeft().length > maxLeft) {
					modelLabel = shortText(modelLabel, 16);
				}
				if (buildPlainLeft().length > maxLeft) {
					roleLabel = shortText(roleLabel, 22);
				}
				if (buildPlainLeft().length > maxLeft) {
					const fixed = (` ${modelLabel}${separator}${roleLabel}${separator}`).length;
					const budget = Math.max(10, maxLeft - fixed);
					sessionLabel = middleEllipsis(sessionId, budget);
				}

				for (const candidate of rightCandidates) {
					const candidateMaxLeft = Math.max(16, width - visibleWidth(candidate) - 1);
					if (buildPlainLeft().length <= candidateMaxLeft) {
						right = candidate;
						maxLeft = candidateMaxLeft;
						break;
					}
				}

				if (buildPlainLeft().length > maxLeft) {
					const fixed = (` ${modelLabel}${separator}${roleLabel}${separator}`).length;
					const budget = Math.max(8, maxLeft - fixed);
					sessionLabel = middleEllipsis(sessionId, budget);
				}

				const left = theme.fg("dim", ` ${modelLabel}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", roleLabel) +
					theme.fg("muted", " · ") +
					theme.fg("dim", sessionLabel);

				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				const footerStr = truncateToWidth(left + pad + right, width);

				if (showNewlineHint) {
					const hintMsg = theme.fg("dim", " Tip: ") + theme.fg("accent", "\\ + ↵") + theme.fg("dim", " to new line");
					return [hintMsg, footerStr];
				}

				return [footerStr];
			},
		}));
	});
}
