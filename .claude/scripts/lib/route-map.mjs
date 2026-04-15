import { readFileSync } from "node:fs";

const TOP_LEVEL_SCOPES = ["systems", "roles", "teams", "team_roles", "intents", "agents"];
const POLICY_SCOPES = ["systems", "roles", "teams", "team_roles", "intents", "agents"];

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function normalizeModelRef(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.includes(",")) {
    const [provider, ...rest] = raw.split(",");
    const model = rest.join(",").trim();
    return provider.trim() && model ? raw : null;
  }

  const slash = raw.indexOf("/");
  if (slash <= 0 || slash >= raw.length - 1) return null;
  const provider = raw.slice(0, slash).trim();
  const model = raw.slice(slash + 1).trim();
  return provider && model ? raw : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateRoutingTable(table, label, issues) {
  if (table == null) return;
  if (!isRecord(table)) {
    issues.push(`${label} must be an object`);
    return;
  }

  for (const [key, value] of Object.entries(table)) {
    if (!key.trim()) {
      issues.push(`${label} contains an empty key`);
      continue;
    }
    if (!normalizeModelRef(value)) {
      issues.push(`${label}.${key} must be a non-empty model ref (provider,model or provider/model)`);
    }
  }
}

function validateScope(scope, label, issues, allowedScopes) {
  if (scope == null) return;
  if (!isRecord(scope)) {
    issues.push(`${label} must be an object`);
    return;
  }

  for (const scopeName of allowedScopes) {
    validateRoutingTable(scope[scopeName], `${label}.${scopeName}`, issues);
  }
}

export function validateRouteMapObject(routeMap) {
  const issues = [];
  if (!isRecord(routeMap)) {
    issues.push("route map must be a JSON object");
    return {
      ok: false,
      issues,
      summary: null,
    };
  }

  const defaultPolicy = typeof routeMap.default_policy === "string" ? routeMap.default_policy.trim() : "";
  if (!defaultPolicy) {
    issues.push("missing default_policy");
  }

  const policyEntries = isRecord(routeMap.policies) ? Object.entries(routeMap.policies) : [];

  if (!isRecord(routeMap.policies)) {
    issues.push("missing policies object");
  } else {
    for (const [policyName, policyConfig] of policyEntries) {
      if (!policyName.trim()) {
        issues.push("policies contains an empty key");
        continue;
      }
      if (!isRecord(policyConfig)) {
        issues.push(`policies.${policyName} must be an object`);
      }
    }

    if (defaultPolicy) {
      const hasDefaultPolicy = Object.prototype.hasOwnProperty.call(routeMap.policies, defaultPolicy);
      if (!hasDefaultPolicy) {
        issues.push(`default_policy "${defaultPolicy}" is not defined under policies`);
      } else if (!isRecord(routeMap.policies[defaultPolicy])) {
        issues.push(`default_policy "${defaultPolicy}" must reference an object policy definition`);
      }
    }
  }

  validateScope(routeMap, "route_map", issues, TOP_LEVEL_SCOPES);

  const policyNames = policyEntries
    .filter(([, policyConfig]) => isRecord(policyConfig))
    .map(([policyName]) => policyName);

  for (const policyName of policyNames) {
    validateScope(routeMap.policies[policyName], `policies.${policyName}`, issues, POLICY_SCOPES);
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      defaultPolicy,
      policyCount: policyNames.length,
      policies: policyNames.sort((a, b) => a.localeCompare(b)),
      scopes: TOP_LEVEL_SCOPES.filter((name) => isRecord(routeMap[name])),
    },
  };
}

export function loadAndValidateRouteMap(filePath) {
  const routeMap = readJson(filePath);
  return validateRouteMapObject(routeMap);
}

export function summarizeRouteMap(filePath) {
  const result = loadAndValidateRouteMap(filePath);
  if (!result.ok) {
    throw new Error(result.issues[0] || "invalid route map");
  }
  return result.summary;
}

export function stableRouteMapSignature(routeMap) {
  return JSON.stringify(routeMap, Object.keys(routeMap).sort());
}
