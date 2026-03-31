import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

let envLoaded = false;

function stripMatchingQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function parseDotEnv(raw: string): Record<string, string> {
	const out: Record<string, string> = {};

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const normalized = trimmed.startsWith("export ")
			? trimmed.slice("export ".length).trim()
			: trimmed;

		const separator = normalized.indexOf("=");
		if (separator <= 0) continue;

		const key = normalized.slice(0, separator).trim();
		if (!/^[A-Z0-9_]+$/i.test(key)) continue;

		const value = stripMatchingQuotes(normalized.slice(separator + 1).trim());
		out[key] = value;
	}

	return out;
}

export function loadPiEnv(cwd: string) {
	if (envLoaded) return;

	const candidates = [
		process.env.PI_ENV_FILE?.trim() ? resolve(cwd, process.env.PI_ENV_FILE.trim()) : "",
		resolve(cwd, "multi-agents", ".env"),
		resolve(cwd, ".env"),
	].filter(Boolean);

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const parsed = parseDotEnv(readFileSync(candidate, "utf-8"));
		for (const [key, value] of Object.entries(parsed)) {
			if (process.env[key] == null || process.env[key] === "") {
				process.env[key] = value;
			}
		}
	}

	envLoaded = true;
}
