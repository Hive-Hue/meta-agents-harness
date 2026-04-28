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

export function ExpertisePanel() {
  const { config } = useConfig();
  const [autoSeed, setAutoSeed] = useState(true);
  const [retention, setRetention] = useState("30");
  const [validatedThreshold, setValidatedThreshold] = useState("0.6");
  const [restrictedThreshold, setRestrictedThreshold] = useState("0.3");
  const [governanceCycle, setGovernanceCycle] = useState("weekly");
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiEndpoint, setAiEndpoint] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const storageKey = useMemo(() => {
    const workspacePath = localStorage.getItem("mah_workspace_path") || "default";
    return `mah_settings_expertise:${workspacePath}`;
  }, []);

  useEffect(() => {
    const savedProvider = getFeatureAiProvider("expertise");
    const savedModel = getFeatureAiModel("expertise");
    const savedBaseUrl = getFeatureAiBaseUrl("expertise");
    const savedEndpoint = getFeatureAiEndpoint("expertise");
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
      if (typeof saved?.autoSeed === "boolean") setAutoSeed(saved.autoSeed);
      if (typeof saved?.retention === "string") setRetention(saved.retention);
      if (typeof saved?.validatedThreshold === "string") setValidatedThreshold(saved.validatedThreshold);
      if (typeof saved?.restrictedThreshold === "string") setRestrictedThreshold(saved.restrictedThreshold);
      if (typeof saved?.governanceCycle === "string") setGovernanceCycle(saved.governanceCycle);
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
    setFeatureAiProvider("expertise", aiProvider);
  }, [aiProvider, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiModel("expertise", aiModel);
  }, [aiModel, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiBaseUrl("expertise", aiBaseUrl);
  }, [aiBaseUrl, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setFeatureAiEndpoint("expertise", aiEndpoint);
  }, [aiEndpoint, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        autoSeed,
        retention,
        validatedThreshold,
        restrictedThreshold,
        governanceCycle,
        aiProvider,
        aiModel,
        aiBaseUrl,
        aiEndpoint,
      })
    );
  }, [autoSeed, retention, validatedThreshold, restrictedThreshold, governanceCycle, aiProvider, aiModel, aiBaseUrl, aiEndpoint, storageKey, hydrated]);

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
      <SettingsSection title="Expertise Governance">
        <ToggleSwitch checked={autoSeed} onChange={setAutoSeed} label="Auto-seed on crew creation" />
        <FormField label="Evidence Retention Window" type="number" value={retention} onChange={setRetention} min={1} max={365} suffix="days" />
        <FormField label="Confidence Threshold (Validated)" type="number" value={validatedThreshold} onChange={setValidatedThreshold} min={0} max={1} suffix="0-1" />
        <FormField label="Confidence Threshold (Restricted)" type="number" value={restrictedThreshold} onChange={setRestrictedThreshold} min={0} max={1} suffix="0-1" />
        <FormField
          label="Governance Cycle"
          type="select"
          value={governanceCycle}
          onChange={setGovernanceCycle}
          options={[
            { value: "weekly", label: "Weekly" },
            { value: "biweekly", label: "Biweekly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
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
          hint="Used when AI-powered propose is enabled"
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
      </SettingsSection>

      <SettingsSection title="Catalog Stats">
        <div className="settings-stats">
          <div className="settings-stat">
            <span className="settings-stat__label">Total Agents</span>
            <span className="settings-stat__value">10</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Validated</span>
            <span className="settings-stat__value">10</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Experimental</span>
            <span className="settings-stat__value">0</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Restricted</span>
            <span className="settings-stat__value">0</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Evidence Events</span>
            <span className="settings-stat__value">47</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Last Sync</span>
            <span className="settings-stat__value" style={{ fontSize: 13 }}>2026-04-25</span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
