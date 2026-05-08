import { useEffect, useMemo, useState } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  AI_PROVIDER_OPTIONS,
  getFeatureAiBaseUrl,
  getFeatureAiEndpoint,
  getFeatureAiModel,
  getFeatureAiProvider,
  setFeatureAiBaseUrl,
  setFeatureAiEndpoint,
  setFeatureAiModel,
  setFeatureAiProvider,
} from "./aiFeatureSettings";
import { useConfig } from "../config/useConfigStore";

export function ContextPanel() {
  const { config } = useConfig();
  const [budget, setBudget] = useState("2048");
  const [autoIndex, setAutoIndex] = useState(true);
  const [autoPromote, setAutoPromote] = useState(false);
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiEndpoint, setAiEndpoint] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const storageKey = useMemo(() => {
    const workspacePath = localStorage.getItem("mah_workspace_path") || "default";
    return `mah_settings_context:${workspacePath}`;
  }, []);

  useEffect(() => {
    const savedProvider = getFeatureAiProvider("context");
    const savedModel = getFeatureAiModel("context");
    const savedBaseUrl = getFeatureAiBaseUrl("context");
    const savedEndpoint = getFeatureAiEndpoint("context");
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setAiProvider(savedProvider);
        setAiModel(savedModel);
        setAiBaseUrl(savedBaseUrl);
        setAiEndpoint(savedEndpoint);
        return;
      }
      const saved = JSON.parse(raw);
      if (typeof saved?.budget === "string") setBudget(saved.budget);
      if (typeof saved?.autoIndex === "boolean") setAutoIndex(saved.autoIndex);
      if (typeof saved?.autoPromote === "boolean") setAutoPromote(saved.autoPromote);
      setAiProvider(typeof saved?.aiProvider === "string" ? saved.aiProvider : savedProvider);
      setAiModel(typeof saved?.aiModel === "string" ? saved.aiModel : savedModel);
      setAiBaseUrl(typeof saved?.aiBaseUrl === "string" ? saved.aiBaseUrl : savedBaseUrl);
      setAiEndpoint(typeof saved?.aiEndpoint === "string" ? saved.aiEndpoint : savedEndpoint);
    } catch {
      setAiProvider(savedProvider);
      setAiModel(savedModel);
      setAiBaseUrl(savedBaseUrl);
      setAiEndpoint(savedEndpoint);
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiProvider("context", aiProvider);
  }, [aiProvider, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiModel("context", aiModel);
  }, [aiModel, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiBaseUrl("context", aiBaseUrl);
  }, [aiBaseUrl, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiEndpoint("context", aiEndpoint);
  }, [aiEndpoint, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        budget,
        autoIndex,
        autoPromote,
        aiProvider,
        aiModel,
        aiBaseUrl,
        aiEndpoint,
      })
    );
  }, [budget, autoIndex, autoPromote, aiProvider, aiModel, aiBaseUrl, aiEndpoint, storageKey, hydrated]);

  const availableModels = (config?.catalog?.available_models ?? []).filter(
    (m) => !!m?.provider && !!m?.model_id
  );
  const dynamicProviders = Array.from(new Set(availableModels.map((m) => m.provider))).filter(Boolean);
  const providerOptions = [
    { value: "", label: "Default (MAH_AI_PROVIDER)" },
    ...AI_PROVIDER_OPTIONS,
    ...dynamicProviders
      .filter((provider) => !AI_PROVIDER_OPTIONS.some((option) => option.value === provider))
      .map((provider) => ({ value: provider, label: provider })),
  ];
  const filteredModels = aiProvider
    ? availableModels.filter((m) => m.provider === aiProvider)
    : availableModels;
  const filteredModelValues = filteredModels.map((m) => `${m.provider}/${m.model_id}`);

  useEffect(() => {
    if (!aiProvider || !aiModel) return;
    const providerPrefix = `${aiProvider}/`;
    if (!aiModel.startsWith(providerPrefix)) {
      setAiModel("");
    }
  }, [aiProvider, aiModel]);

  const aiModelOptions = [
    { value: "", label: "Default (MAH_AI_MODEL)" },
    ...filteredModelValues.map((value) => ({ value, label: value })),
  ];
  if (aiModel && !filteredModelValues.includes(aiModel)) {
    aiModelOptions.push({ value: aiModel, label: `${aiModel} (custom)` });
  }

  return (
    <>
      <SettingsSection title="Context Memory">
        <FormField label="Operational Memory Path" value=".mah/context/operational/" mono copyable disabled />
        <FormField label="Proposal Path" value=".mah/context/proposals/" mono copyable disabled />
        <FormField label="Max Retrieval Budget" type="number" value={budget} onChange={setBudget} min={256} max={8192} suffix="tokens" />
        <ToggleSwitch checked={autoIndex} onChange={setAutoIndex} label="Auto-index on change" />
        <ToggleSwitch checked={autoPromote} onChange={setAutoPromote} label="Auto-promote proposals" />
        <FormField
          label="AI Provider (Propose)"
          type="select"
          value={aiProvider}
          onChange={setAiProvider}
          options={providerOptions}
        />
        <FormField
          label="AI Model (Propose)"
          type="select"
          value={aiModel}
          onChange={setAiModel}
          options={aiModelOptions}
          hint="Used when Content Memory AI propose is enabled"
        />
        <FormField
          label="AI Base URL (optional)"
          value={aiBaseUrl}
          onChange={setAiBaseUrl}
          placeholder="https://api.provider.tld/v1"
        />
        <FormField
          label="AI Endpoint (optional)"
          value={aiEndpoint}
          onChange={setAiEndpoint}
          placeholder="/chat/completions or /responses"
        />
        <FormField label="Index Format" value="markdown + qmd" disabled />
      </SettingsSection>

      <SettingsSection title="Corpus Stats">
        <div className="settings-stats">
          <div className="settings-stat">
            <span className="settings-stat__label">Total Documents</span>
            <span className="settings-stat__value">14</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Operational</span>
            <span className="settings-stat__value">8</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Proposed</span>
            <span className="settings-stat__value">3</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Excluded</span>
            <span className="settings-stat__value">3</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Last Indexed</span>
            <span className="settings-stat__value" style={{ fontSize: 12 }}>2026-04-25 21:30</span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
