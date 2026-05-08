import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

export interface MahConfig {
  version?: number;
  name?: string;
  description?: string;
  runtimes?: Record<string, { model_overrides?: Record<string, string> }>;
  catalog?: {
    models?: Record<string, string>;
    model_fallbacks?: Record<string, string[]>;
    available_models?: Array<{ provider: string; model_id: string; display_name?: string }>;
  };
  domain_profiles?: Record<
    string,
    Array<{ path: string; read?: boolean; edit?: boolean; bash?: boolean }>
  >;
  crews?: Array<{
    id: string;
    display_name?: string;
    agents?: Array<{
      id: string;
      role: string;
      team: string;
      model_ref: string;
      skills?: string[];
      domain_profile?: string | string[];
    }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface ConfigState {
  config: MahConfig | null;
  serverConfig: MahConfig | null;
  loading: boolean;
  error: string | null;
  isDirty: boolean;
  updateConfig: (patch: Partial<MahConfig>) => void;
  saveConfig: () => Promise<void>;
  reloadConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigState | null>(null);

function workspaceScopedKey(base: string): string {
  const workspacePath = localStorage.getItem("mah_workspace_path") || "default";
  return `${base}:${workspacePath}`;
}

function hydrateCatalogFromStorage(config: MahConfig): MahConfig {
  const availableKey = workspaceScopedKey("mah_settings_available_models");
  const fallbacksKey = workspaceScopedKey("mah_settings_model_fallbacks");
  const nextCatalog = { ...(config.catalog ?? {}) };

  try {
    const rawAvailable = localStorage.getItem(availableKey);
    if (rawAvailable) {
      const parsed = JSON.parse(rawAvailable);
      if (Array.isArray(parsed)) {
        nextCatalog.available_models = parsed.filter((item) =>
          item &&
          typeof item === "object" &&
          typeof item.provider === "string" &&
          typeof item.model_id === "string"
        );
      }
    }
  } catch {
    // ignore malformed persisted data
  }

  try {
    const rawFallbacks = localStorage.getItem(fallbacksKey);
    if (rawFallbacks) {
      const parsed = JSON.parse(rawFallbacks);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        nextCatalog.model_fallbacks = Object.fromEntries(
          Object.entries(parsed).map(([role, values]) => [
            role,
            Array.isArray(values) ? values.filter((item) => typeof item === "string") : [],
          ])
        );
      }
    }
  } catch {
    // ignore malformed persisted data
  }

  return { ...config, catalog: nextCatalog };
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MahConfig | null>(null);
  const [serverConfig, setServerConfig] = useState<MahConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const serverRef = useRef<string>("");

  const isDirty =
    config !== null &&
    serverConfig !== null &&
    JSON.stringify(config) !== JSON.stringify(serverConfig);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mah/config");
      const data = (await res.json()) as {
        ok: boolean;
        config?: MahConfig;
        error?: string;
      };
      if (!data.ok || !data.config) {
        setError(data.error ?? "failed to load config");
        setLoading(false);
        return;
      }
      const hydratedConfig = hydrateCatalogFromStorage(data.config);
      setConfig(hydratedConfig);
      setServerConfig(hydratedConfig);
      serverRef.current = JSON.stringify(hydratedConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const updateConfig = useCallback((patch: Partial<MahConfig>) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
  }, []);

  const saveConfig = useCallback(async () => {
    if (!config) return;
    setError(null);
    try {
      const res = await fetch("/api/mah/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
      };
      if (!data.ok) {
        setError(data.error ?? "save failed");
        return;
      }
      setServerConfig(config);
      serverRef.current = JSON.stringify(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [config]);

  const reloadConfig = useCallback(async () => {
    await fetchConfig();
  }, [fetchConfig]);

  return (
    <ConfigContext.Provider
      value={{
        config,
        serverConfig,
        loading,
        error,
        isDirty,
        updateConfig,
        saveConfig,
        reloadConfig,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return ctx;
}
