import { useCallback, useEffect, useState } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { StatusBadge } from "../../components/ui/StatusBadge";

type GatewayStatus = "idle" | "checking" | "online" | "offline";

type GatewaySettings = {
  MAH_HERMES_GATEWAY_URL: string;
  MAH_HERMES_GATEWAY_API_KEY: string;
  MAH_HERMES_GATEWAY_MODEL: string;
};

type GatewayModel = {
  id: string;
  label: string;
};

type HealthPayload = {
  ok: boolean;
  status?: number;
  endpoint?: string;
  message?: string;
};

const DEFAULT_SETTINGS: GatewaySettings = {
  MAH_HERMES_GATEWAY_URL: "http://127.0.0.1:8642",
  MAH_HERMES_GATEWAY_API_KEY: "",
  MAH_HERMES_GATEWAY_MODEL: "",
};

export function HermesGatewaySettingsPanel() {
  const [settings, setSettings] = useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<GatewayStatus>("idle");
  const [statusHint, setStatusHint] = useState("Gateway ainda não verificado.");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState("");

  const loadGatewayConfig = useCallback(async () => {
    setLoadingConfig(true);
    setError(null);
    setSuccess("");
    try {
      const resp = await fetch("/api/mah/hermes-gateway/config");
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to load gateway config");
      }
      const next = payload?.settings || {};
      const merged: GatewaySettings = {
        MAH_HERMES_GATEWAY_URL: typeof next.MAH_HERMES_GATEWAY_URL === "string" ? next.MAH_HERMES_GATEWAY_URL : DEFAULT_SETTINGS.MAH_HERMES_GATEWAY_URL,
        MAH_HERMES_GATEWAY_API_KEY: typeof next.MAH_HERMES_GATEWAY_API_KEY === "string" ? next.MAH_HERMES_GATEWAY_API_KEY : "",
        MAH_HERMES_GATEWAY_MODEL: typeof next.MAH_HERMES_GATEWAY_MODEL === "string" ? next.MAH_HERMES_GATEWAY_MODEL : "",
      };
      setSettings(merged);
      setSelectedModel((prev) => prev || merged.MAH_HERMES_GATEWAY_MODEL);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const saveGatewayConfig = useCallback(async () => {
    setSavingConfig(true);
    setError(null);
    setSuccess("");
    try {
      const resp = await fetch("/api/mah/hermes-gateway/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...settings,
            MAH_HERMES_GATEWAY_MODEL: selectedModel,
          },
        }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to save gateway config");
      }
      setSuccess("Hermes Gateway config salva em .env.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingConfig(false);
    }
  }, [selectedModel, settings]);

  const checkHealth = useCallback(async () => {
    setStatus("checking");
    setStatusHint("Verificando conectividade com Hermes Gateway...");
    setError(null);
    try {
      const resp = await fetch("/api/mah/hermes-gateway/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: settings.MAH_HERMES_GATEWAY_URL,
          apiKey: settings.MAH_HERMES_GATEWAY_API_KEY,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "gateway health check failed");
      }
      const health = (payload?.health || {}) as HealthPayload;
      if (health.ok) {
        setStatus("online");
        setStatusHint(`Gateway online (${health.endpoint || "endpoint"}, status ${health.status || 200}).`);
      } else {
        setStatus("offline");
        setStatusHint(health.message || "Gateway retornou resposta inválida.");
      }
    } catch (err) {
      setStatus("offline");
      const msg = err instanceof Error ? err.message : String(err);
      setStatusHint(msg);
      setError(msg);
    }
  }, [settings.MAH_HERMES_GATEWAY_API_KEY, settings.MAH_HERMES_GATEWAY_URL]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/hermes-gateway/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: settings.MAH_HERMES_GATEWAY_URL,
          apiKey: settings.MAH_HERMES_GATEWAY_API_KEY,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to load gateway models");
      }
      const list = Array.isArray(payload?.models) ? payload.models : [];
      const normalized: GatewayModel[] = list
        .map((item: Record<string, unknown>) => ({
          id: `${item?.id || ""}`.trim(),
          label: `${item?.label || item?.id || ""}`.trim(),
        }))
        .filter((item: GatewayModel) => item.id.length > 0);
      setModels(normalized);
      if (!selectedModel && normalized.length > 0) {
        setSelectedModel(settings.MAH_HERMES_GATEWAY_MODEL || normalized[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  }, [selectedModel, settings.MAH_HERMES_GATEWAY_API_KEY, settings.MAH_HERMES_GATEWAY_MODEL, settings.MAH_HERMES_GATEWAY_URL]);

  useEffect(() => {
    void loadGatewayConfig();
  }, [loadGatewayConfig]);

  const gatewayBadge =
    status === "online"
      ? { tone: "completed" as const, label: "Online" }
      : status === "offline"
        ? { tone: "failed" as const, label: "Offline" }
        : { tone: "running" as const, label: status === "checking" ? "Checking" : "Idle" };

  return (
    <>
      <SettingsSection title="Hermes Gateway" defaultOpen={true}>
        <div className="settings-btn-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <StatusBadge tone={gatewayBadge.tone} label={gatewayBadge.label} />
          <button className="settings-btn" type="button" onClick={() => void checkHealth()} disabled={status === "checking"}>
            {status === "checking" ? "Checking..." : "Health"}
          </button>
        </div>

        <FormField
          label="Gateway URL"
          value={settings.MAH_HERMES_GATEWAY_URL}
          onChange={(value) => setSettings((prev) => ({ ...prev, MAH_HERMES_GATEWAY_URL: value }))}
          mono={true}
          disabled={savingConfig || loadingConfig}
          placeholder="http://127.0.0.1:8642"
        />

        <FormField
          label="API Key (optional)"
          value={settings.MAH_HERMES_GATEWAY_API_KEY}
          onChange={(value) => setSettings((prev) => ({ ...prev, MAH_HERMES_GATEWAY_API_KEY: value }))}
          mono={true}
          disabled={savingConfig || loadingConfig}
          placeholder="Bearer token"
        />

        <FormField
          label="Default Model"
          type="select"
          value={selectedModel}
          onChange={setSelectedModel}
          disabled={savingConfig || loadingConfig}
          options={[
            { value: "", label: "auto" },
            ...models.map((model) => ({ value: model.id, label: model.label })),
          ]}
        />

        <div className="settings-btn-row">
          <button className="settings-btn" type="button" onClick={() => void loadModels()} disabled={loadingModels || savingConfig}>
            {loadingModels ? "Loading Models..." : "Load Models"}
          </button>
          <button className="settings-btn" type="button" onClick={() => void loadGatewayConfig()} disabled={loadingConfig || savingConfig}>
            {loadingConfig ? "Reloading..." : "Reload"}
          </button>
          <button className="settings-btn settings-btn--primary" type="button" onClick={() => void saveGatewayConfig()} disabled={savingConfig || loadingConfig}>
            {savingConfig ? "Saving..." : "Save"}
          </button>
        </div>

        <p className="settings-field__hint">{statusHint}</p>
        {error && <p className="settings-context-tools__error">{error}</p>}
        {success && <p className="settings-context-tools__success">{success}</p>}
      </SettingsSection>
    </>
  );
}
