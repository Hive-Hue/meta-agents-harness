export const AI_PROVIDER_OPTIONS = [
  { value: "zai", label: "Z.ai (zai)" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "codex-oauth", label: "Codex OAuth" },
  { value: "minimax", label: "MiniMax" },
];

type FeatureScope = "expertise" | "context";

function providerKey(scope: FeatureScope) {
  return `mah_ai_${scope}_provider`;
}

function modelKey(scope: FeatureScope) {
  return `mah_ai_${scope}_model`;
}

function baseUrlKey(scope: FeatureScope) {
  return `mah_ai_${scope}_base_url`;
}

function endpointKey(scope: FeatureScope) {
  return `mah_ai_${scope}_endpoint`;
}

export function getFeatureAiProvider(scope: FeatureScope): string {
  return localStorage.getItem(providerKey(scope)) || "";
}

export function setFeatureAiProvider(scope: FeatureScope, provider: string): void {
  localStorage.setItem(providerKey(scope), provider.trim());
}

export function getFeatureAiModel(scope: FeatureScope): string {
  return localStorage.getItem(modelKey(scope)) || "";
}

export function setFeatureAiModel(scope: FeatureScope, model: string): void {
  localStorage.setItem(modelKey(scope), model.trim());
}

export function getFeatureAiBaseUrl(scope: FeatureScope): string {
  return localStorage.getItem(baseUrlKey(scope)) || "";
}

export function setFeatureAiBaseUrl(scope: FeatureScope, baseUrl: string): void {
  localStorage.setItem(baseUrlKey(scope), baseUrl.trim());
}

export function getFeatureAiEndpoint(scope: FeatureScope): string {
  return localStorage.getItem(endpointKey(scope)) || "";
}

export function setFeatureAiEndpoint(scope: FeatureScope, endpoint: string): void {
  localStorage.setItem(endpointKey(scope), endpoint.trim());
}

export function getFeatureAiCliOptions(scope: FeatureScope): {
  provider: string;
  model: string;
  baseUrl: string;
  endpoint: string;
} {
  let provider = getFeatureAiProvider(scope).trim();
  let model = getFeatureAiModel(scope).trim();
  const baseUrl = getFeatureAiBaseUrl(scope).trim();
  const endpoint = getFeatureAiEndpoint(scope).trim();

  // UI model selector stores provider/model_id; CLI expects just model_id.
  const slashIdx = model.indexOf("/");
  if (slashIdx > 0) {
    const modelProvider = model.slice(0, slashIdx).trim();
    const modelId = model.slice(slashIdx + 1).trim();
    if (!provider) provider = modelProvider;
    // Always pass pure model id to CLI.
    model = modelId;
    // If provider/model pair is inconsistent, prefer model's provider.
    if (modelProvider && provider && provider !== modelProvider) {
      provider = modelProvider;
    }
  }

  return { provider, model, baseUrl, endpoint };
}
