import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/ui/Icon";
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

type ContextAction = "index" | "rebuild" | "search" | "index_qdrant" | "index_pgvector" | "proxy_health" | null;

type ContextSearchHit = {
  id: string;
  score: number;
  reasons: string;
};

type CorpusStats = {
  totalDocuments: number;
  operational: number;
  proposed: number;
  excluded: number;
  lastIndexed: string;
};

type ContextSettingsPayload = {
  MAH_VECTOR_RETRIEVAL: string;
  MAH_QMD_PATH: string;
  MAH_PVECTOR_URL: string;
  MAH_PVECTOR_COLLECTION: string;
  MAH_PGVECTOR_DSN: string;
  MAH_PGVECTOR_TABLE: string;
  MAH_PGVECTOR_COLLECTION_MODE: "none" | "column" | "payload";
};

type PersistentMemoryAction = "list" | "stats" | "search" | "add" | "replace" | "remove" | "compact" | "capture" | null;

type PersistentMemoryUsage = {
  used_chars: number;
  char_limit: number;
  entry_count: number;
  entry_limit: number;
  usage_percent: number;
};

type PersistentMemoryEntry = {
  id: string;
  content: string;
  source?: string;
  tags?: string[];
  use_count?: number;
  updated_at?: string;
  created_at?: string;
};

type PersistentMemoryMatch = {
  id: string;
  score: number;
  reasons?: string[];
  content: string;
  source?: string;
  tags?: string[];
};

type PersistentMemoryResult = {
  crew?: string;
  agent?: string;
  file_path?: string;
  usage?: PersistentMemoryUsage;
  entries?: PersistentMemoryEntry[];
  matches?: PersistentMemoryMatch[];
  added?: PersistentMemoryEntry[];
  removed?: PersistentMemoryEntry;
  evicted?: Array<{ id?: string; content?: string }>;
};

const DEFAULT_CONTEXT_SETTINGS: ContextSettingsPayload = {
  MAH_VECTOR_RETRIEVAL: "0",
  MAH_QMD_PATH: "qmd",
  MAH_PVECTOR_URL: "",
  MAH_PVECTOR_COLLECTION: "mah-context",
  MAH_PGVECTOR_DSN: "postgresql://mah:mah@localhost:5432/mah_context",
  MAH_PGVECTOR_TABLE: "context_vectors",
  MAH_PGVECTOR_COLLECTION_MODE: "none",
};

function formatNowForUi() {
  return new Date().toLocaleString();
}

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

  const [runningAction, setRunningAction] = useState<ContextAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string>("");
  const [statsLoading, setStatsLoading] = useState(false);
  const [searchAgent, setSearchAgent] = useState("");
  const [searchTask, setSearchTask] = useState("");
  const [searchCapability, setSearchCapability] = useState("");
  const [searchResults, setSearchResults] = useState<ContextSearchHit[]>([]);
  const [searchSummary, setSearchSummary] = useState<{
    provider?: string;
    confidence?: string;
    totalCandidates?: number;
  } | null>(null);
  const [corpusStats, setCorpusStats] = useState<CorpusStats>({
    totalDocuments: 0,
    operational: 0,
    proposed: 0,
    excluded: 0,
    lastIndexed: "—",
  });
  const [contextSettings, setContextSettings] = useState<ContextSettingsPayload>(DEFAULT_CONTEXT_SETTINGS);
  const [contextSettingsLoading, setContextSettingsLoading] = useState(false);
  const [contextSettingsSaving, setContextSettingsSaving] = useState(false);
  const [contextSettingsError, setContextSettingsError] = useState<string | null>(null);
  const [contextSettingsSuccess, setContextSettingsSuccess] = useState<string>("");
  const [memoryCrew, setMemoryCrew] = useState("dev");
  const [memoryAgent, setMemoryAgent] = useState("");
  const [memoryTask, setMemoryTask] = useState("");
  const [memoryLimit, setMemoryLimit] = useState("5");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryOldText, setMemoryOldText] = useState("");
  const [memorySource, setMemorySource] = useState("manual");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryTargetPercent, setMemoryTargetPercent] = useState("70");
  const [memoryFromSession, setMemoryFromSession] = useState("");
  const [memoryFromPath, setMemoryFromPath] = useState("");
  const [memoryNoCompact, setMemoryNoCompact] = useState(false);
  const [memoryRunningAction, setMemoryRunningAction] = useState<PersistentMemoryAction>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memorySuccess, setMemorySuccess] = useState("");
  const [memoryUsage, setMemoryUsage] = useState<PersistentMemoryUsage | null>(null);
  const [memoryFilePath, setMemoryFilePath] = useState("");
  const [memoryEntries, setMemoryEntries] = useState<PersistentMemoryEntry[]>([]);
  const [memoryMatches, setMemoryMatches] = useState<PersistentMemoryMatch[]>([]);
  const [memoryLastAction, setMemoryLastAction] = useState<"list" | "stats" | "search" | null>(null);

  const storageKey = useMemo(() => {
    const workspacePath = localStorage.getItem("mah_workspace_path") || "default";
    return `mah_settings_context:${workspacePath}`;
  }, []);
  const indexStampKey = useMemo(() => `${storageKey}:lastIndexed`, [storageKey]);

  const runMah = useCallback(async (args: string[]) => {
    const resp = await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const payload = await resp.json();
    if (!resp.ok || !payload?.ok) {
      throw new Error(payload?.stderr || payload?.error || "Command failed");
    }
    return payload.stdout ? JSON.parse(payload.stdout) : {};
  }, []);

  const loadContextSettings = useCallback(async () => {
    setContextSettingsLoading(true);
    setContextSettingsError(null);
    setContextSettingsSuccess("");
    try {
      const resp = await fetch("/api/mah/context-settings");
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to load context settings");
      }
      const settings = (payload?.settings || {}) as Partial<ContextSettingsPayload>;
      setContextSettings({
        MAH_VECTOR_RETRIEVAL: settings.MAH_VECTOR_RETRIEVAL === "1" ? "1" : "0",
        MAH_QMD_PATH: typeof settings.MAH_QMD_PATH === "string" ? settings.MAH_QMD_PATH : DEFAULT_CONTEXT_SETTINGS.MAH_QMD_PATH,
        MAH_PVECTOR_URL: typeof settings.MAH_PVECTOR_URL === "string" ? settings.MAH_PVECTOR_URL : DEFAULT_CONTEXT_SETTINGS.MAH_PVECTOR_URL,
        MAH_PVECTOR_COLLECTION: typeof settings.MAH_PVECTOR_COLLECTION === "string" ? settings.MAH_PVECTOR_COLLECTION : DEFAULT_CONTEXT_SETTINGS.MAH_PVECTOR_COLLECTION,
        MAH_PGVECTOR_DSN: typeof settings.MAH_PGVECTOR_DSN === "string" ? settings.MAH_PGVECTOR_DSN : DEFAULT_CONTEXT_SETTINGS.MAH_PGVECTOR_DSN,
        MAH_PGVECTOR_TABLE: typeof settings.MAH_PGVECTOR_TABLE === "string" ? settings.MAH_PGVECTOR_TABLE : DEFAULT_CONTEXT_SETTINGS.MAH_PGVECTOR_TABLE,
        MAH_PGVECTOR_COLLECTION_MODE:
          settings.MAH_PGVECTOR_COLLECTION_MODE === "column" || settings.MAH_PGVECTOR_COLLECTION_MODE === "payload"
            ? settings.MAH_PGVECTOR_COLLECTION_MODE
            : "none",
      });
    } catch (error) {
      setContextSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setContextSettingsLoading(false);
    }
  }, []);

  const saveContextSettings = useCallback(async () => {
    setContextSettingsSaving(true);
    setContextSettingsError(null);
    setContextSettingsSuccess("");
    try {
      const resp = await fetch("/api/mah/context-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: contextSettings }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || "failed to save context settings");
      }
      setContextSettingsSuccess("Context vector config saved to .env.");
    } catch (error) {
      setContextSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setContextSettingsSaving(false);
    }
  }, [contextSettings]);

  const applyPreset = useCallback((preset: "qdrant" | "pgvector" | "qmd") => {
    setContextSettings((prev) => {
      if (preset === "qdrant") {
        return {
          ...prev,
          MAH_VECTOR_RETRIEVAL: "1",
          MAH_QMD_PATH: "qmd",
          MAH_PVECTOR_URL: "http://localhost:8080",
          MAH_PVECTOR_COLLECTION: "mah-context",
          MAH_PGVECTOR_COLLECTION_MODE: "none",
        };
      }
      if (preset === "pgvector") {
        return {
          ...prev,
          MAH_VECTOR_RETRIEVAL: "1",
          MAH_QMD_PATH: "qmd",
          MAH_PVECTOR_URL: "http://localhost:8080",
          MAH_PVECTOR_COLLECTION: "mah-context",
          MAH_PGVECTOR_DSN: "postgresql://mah:mah@localhost:5432/mah_context",
          MAH_PGVECTOR_TABLE: "context_vectors",
          MAH_PGVECTOR_COLLECTION_MODE: "column",
        };
      }
      return {
        ...prev,
        MAH_VECTOR_RETRIEVAL: "1",
        MAH_QMD_PATH: "qmd",
        MAH_PVECTOR_URL: "",
        MAH_PGVECTOR_COLLECTION_MODE: "none",
      };
    });
    setContextSettingsError(null);
    setContextSettingsSuccess(`Preset '${preset}' applied. Save Vector Config to persist.`);
  }, []);

  const refreshCorpusStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [docsData, proposalsData] = await Promise.all([
        runMah(["context", "list", "--json"]),
        runMah(["context", "proposals", "list", "--json"]),
      ]);
      const docs = Array.isArray(docsData?.documents) ? docsData.documents : [];
      const proposals = Array.isArray(proposalsData?.proposals) ? proposalsData.proposals : [];
      const rejected = proposals.filter((proposal: { status?: string }) => proposal?.status === "rejected").length;
      const storedLastIndexed = localStorage.getItem(indexStampKey) || "—";
      setCorpusStats({
        totalDocuments: docs.length + proposals.length,
        operational: docs.length,
        proposed: proposals.length,
        excluded: rejected,
        lastIndexed: storedLastIndexed,
      });
    } catch {
      const storedLastIndexed = localStorage.getItem(indexStampKey) || "—";
      setCorpusStats((prev) => ({ ...prev, lastIndexed: storedLastIndexed }));
    } finally {
      setStatsLoading(false);
    }
  }, [indexStampKey, runMah]);

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

  useEffect(() => {
    void refreshCorpusStats();
  }, [refreshCorpusStats]);

  useEffect(() => {
    void loadContextSettings();
  }, [loadContextSettings]);

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

  const crewOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const crew of config?.crews ?? []) {
      if (typeof crew?.id === "string" && crew.id.trim()) unique.add(crew.id.trim());
    }
    return Array.from(unique).map((value) => ({ value, label: value }));
  }, [config?.crews]);

  const agentOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const crew of config?.crews ?? []) {
      const crewId = typeof crew?.id === "string" ? crew.id : "crew";
      for (const agent of crew?.agents ?? []) {
        if (!agent?.id) continue;
        if (!unique.has(agent.id)) unique.set(agent.id, `${agent.id} (${crewId})`);
      }
    }
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
  }, [config?.crews]);

  const memoryAgentOptions = useMemo(() => {
    const selectedCrew = (config?.crews ?? []).find((crew) => `${crew?.id || ""}`.trim() === memoryCrew);
    const crewAgents = Array.isArray(selectedCrew?.agents) ? selectedCrew.agents : [];
    const directOptions = crewAgents
      .map((agent) => `${agent?.id || ""}`.trim())
      .filter(Boolean)
      .map((value) => ({ value, label: value }));
    if (directOptions.length > 0) return directOptions;
    return agentOptions.map((opt) => ({ value: opt.value, label: opt.value }));
  }, [config?.crews, memoryCrew, agentOptions]);

  useEffect(() => {
    if (searchAgent || agentOptions.length === 0) return;
    setSearchAgent(agentOptions[0].value);
  }, [searchAgent, agentOptions]);

  useEffect(() => {
    if (memoryCrew || crewOptions.length === 0) return;
    setMemoryCrew(crewOptions[0].value);
  }, [memoryCrew, crewOptions]);

  useEffect(() => {
    if (memoryAgentOptions.length === 0) return;
    if (memoryAgent && memoryAgentOptions.some((opt) => opt.value === memoryAgent)) return;
    setMemoryAgent(memoryAgentOptions[0].value);
  }, [memoryAgent, memoryAgentOptions]);

  const runIndex = useCallback(async (rebuild: boolean) => {
    setRunningAction(rebuild ? "rebuild" : "index");
    setActionError(null);
    setActionSuccess("");
    try {
      const args = rebuild ? ["context", "index", "--rebuild", "--json"] : ["context", "index", "--json"];
      const result = await runMah(args);
      const lastIndexed = formatNowForUi();
      localStorage.setItem(indexStampKey, lastIndexed);
      setActionSuccess(
        `Index updated: ${result.total_documents ?? 0} docs (${result.new ?? 0} new, ${result.updated ?? 0} updated, ${result.removed ?? 0} removed).`
      );
      await refreshCorpusStats();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningAction(null);
    }
  }, [indexStampKey, refreshCorpusStats, runMah]);

  const runSearch = useCallback(async () => {
    if (!searchAgent.trim() || !searchTask.trim()) return;
    setRunningAction("search");
    setActionError(null);
    setActionSuccess("");
    try {
      const args = ["context", "find", "--agent", searchAgent.trim(), "--task", searchTask.trim(), "--json"];
      if (searchCapability.trim()) args.push("--capability", searchCapability.trim());
      const result = await runMah(args);
      const matches = Array.isArray(result?.matched_docs) ? result.matched_docs : [];
      const parsed: ContextSearchHit[] = matches.map((entry: Record<string, unknown>) => {
        const metadata = (entry?.metadata as Record<string, unknown> | undefined) || {};
        const reasons = Array.isArray(entry?.reasons)
          ? entry.reasons.filter((item): item is string => typeof item === "string")
          : [];
        return {
          id: (metadata.doc_id as string) || (metadata.file as string) || (entry.id as string) || "unknown",
          score: typeof entry?.score === "number" ? entry.score : 0,
          reasons: reasons.join("; "),
        };
      });
      setSearchResults(parsed);
      setSearchSummary({
        provider: typeof result?.retrieval_provider === "string" ? result.retrieval_provider : "file",
        confidence: typeof result?.confidence === "string" ? result.confidence : "unknown",
        totalCandidates: typeof result?.total_candidates === "number" ? result.total_candidates : undefined,
      });
      setActionSuccess(`Search completed: ${parsed.length} match(es).`);
    } catch (error) {
      setSearchResults([]);
      setSearchSummary(null);
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningAction(null);
    }
  }, [runMah, searchAgent, searchCapability, searchTask]);

  const runVectorAction = useCallback(async (action: "index_qdrant" | "index_pgvector" | "proxy_health") => {
    setRunningAction(action);
    setActionError(null);
    setActionSuccess("");
    try {
      const resp = await fetch("/api/mah/context-vector-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await resp.json();
      if (!resp.ok || !payload?.ok) {
        throw new Error(payload?.error || payload?.stderr || `vector action failed (${action})`);
      }

      if (action === "proxy_health") {
        const status = payload?.payload?.status ? String(payload.payload.status) : "ok";
        const backend = payload?.payload?.backend ? String(payload.payload.backend) : "proxy";
        setActionSuccess(`Proxy health OK (${backend}, status=${status}).`);
      } else {
        const stdout = typeof payload?.stdout === "string" ? payload.stdout : "";
        const short = stdout.split("\n").find((line: string) => line.trim()) || "completed";
        setActionSuccess(`${action === "index_qdrant" ? "Qdrant index" : "pgvector index"} finished: ${short}`);
        const lastIndexed = formatNowForUi();
        localStorage.setItem(indexStampKey, lastIndexed);
        await refreshCorpusStats();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningAction(null);
    }
  }, [indexStampKey, refreshCorpusStats]);

  const fetchPersistentMemory = useCallback(
    async (
      action: Exclude<PersistentMemoryAction, null>,
      payload: Record<string, unknown>,
    ): Promise<PersistentMemoryResult> => {
      const readActions = new Set(["list", "stats", "search"]);
      if (readActions.has(action)) {
        const params = new URLSearchParams();
        params.set("action", action);
        for (const [key, value] of Object.entries(payload)) {
          const normalized = `${value ?? ""}`.trim();
          if (normalized) params.set(key, normalized);
        }
        const resp = await fetch(`/api/mah/context-memory?${params.toString()}`);
        const data = await resp.json();
        if (!resp.ok || !data?.ok) {
          throw new Error(data?.error || "persistent memory request failed");
        }
        return (data?.result || {}) as PersistentMemoryResult;
      }

      const resp = await fetch("/api/mah/context-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || "persistent memory mutation failed");
      }
      return (data?.result || {}) as PersistentMemoryResult;
    },
    [],
  );

  const applyPersistentMemoryResult = useCallback(
    (action: Exclude<PersistentMemoryAction, null>, result: PersistentMemoryResult) => {
      if (result.usage) setMemoryUsage(result.usage);
      if (typeof result.file_path === "string") setMemoryFilePath(result.file_path);
      if (action === "list") {
        setMemoryEntries(Array.isArray(result.entries) ? result.entries : []);
        setMemoryMatches([]);
        setMemoryLastAction("list");
        return;
      }
      if (action === "search") {
        setMemoryMatches(Array.isArray(result.matches) ? result.matches : []);
        setMemoryLastAction("search");
        return;
      }
      if (action === "stats") {
        setMemoryLastAction("stats");
      }
    },
    [],
  );

  const runMemoryReadAction = useCallback(
    async (action: "list" | "stats" | "search") => {
      if (!memoryCrew.trim() || !memoryAgent.trim()) return;
      if (action === "search" && !memoryTask.trim()) return;
      setMemoryRunningAction(action);
      setMemoryError(null);
      setMemorySuccess("");
      try {
        const payload: Record<string, unknown> = {
          crew: memoryCrew.trim(),
          agent: memoryAgent.trim(),
        };
        if (action === "search") {
          payload.task = memoryTask.trim();
          const parsedLimit = Number.parseInt(memoryLimit, 10);
          if (Number.isFinite(parsedLimit) && parsedLimit > 0) payload.limit = parsedLimit;
        }
        const result = await fetchPersistentMemory(action, payload);
        applyPersistentMemoryResult(action, result);
        if (action === "search") {
          const count = Array.isArray(result.matches) ? result.matches.length : 0;
          setMemorySuccess(`Persistent memory search completed: ${count} match(es).`);
        } else if (action === "stats") {
          setMemorySuccess("Persistent memory stats refreshed.");
        } else {
          const count = Array.isArray(result.entries) ? result.entries.length : 0;
          setMemorySuccess(`Persistent memory loaded: ${count} entr${count === 1 ? "y" : "ies"}.`);
        }
      } catch (error) {
        setMemoryError(error instanceof Error ? error.message : String(error));
      } finally {
        setMemoryRunningAction(null);
      }
    },
    [applyPersistentMemoryResult, fetchPersistentMemory, memoryAgent, memoryCrew, memoryLimit, memoryTask],
  );

  const runMemoryWriteAction = useCallback(
    async (action: "add" | "replace" | "remove" | "compact" | "capture") => {
      if (!memoryCrew.trim() || !memoryAgent.trim()) return;
      if (action === "add" && !memoryContent.trim()) return;
      if (action === "replace" && (!memoryOldText.trim() || !memoryContent.trim())) return;
      if (action === "remove" && !memoryOldText.trim()) return;
      if (action === "capture" && !memoryFromSession.trim() && !memoryFromPath.trim()) return;

      setMemoryRunningAction(action);
      setMemoryError(null);
      setMemorySuccess("");
      try {
        const payload: Record<string, unknown> = {
          crew: memoryCrew.trim(),
          agent: memoryAgent.trim(),
        };
        if (action === "add") {
          payload.content = memoryContent.trim();
          if (memorySource.trim()) payload.source = memorySource.trim();
          if (memoryTags.trim()) payload.tags = memoryTags.trim();
        } else if (action === "replace") {
          payload.oldText = memoryOldText.trim();
          payload.content = memoryContent.trim();
          if (memorySource.trim()) payload.source = memorySource.trim();
        } else if (action === "remove") {
          payload.oldText = memoryOldText.trim();
        } else if (action === "compact") {
          const parsedTarget = Number.parseInt(memoryTargetPercent, 10);
          if (Number.isFinite(parsedTarget) && parsedTarget > 0) payload.targetPercent = parsedTarget;
        } else if (action === "capture") {
          if (memoryFromSession.trim()) payload.fromSession = memoryFromSession.trim();
          if (memoryFromPath.trim()) payload.fromPath = memoryFromPath.trim();
          const parsedLimit = Number.parseInt(memoryLimit, 10);
          if (Number.isFinite(parsedLimit) && parsedLimit > 0) payload.limit = parsedLimit;
          if (memoryTags.trim()) payload.tags = memoryTags.trim();
          if (memoryNoCompact) payload.noCompact = true;
        }

        const result = await fetchPersistentMemory(action, payload);
        if (result.usage) setMemoryUsage(result.usage);
        if (typeof result.file_path === "string") setMemoryFilePath(result.file_path);
        if (action === "capture") {
          const captureResult = result as PersistentMemoryResult & { capture?: { added?: unknown[] } };
          const added = Array.isArray(captureResult.added)
            ? captureResult.added.length
            : Array.isArray(captureResult.capture?.added)
              ? captureResult.capture.added.length
              : 0;
          setMemorySuccess(`Capture completed. Added ${added} durable entr${added === 1 ? "y" : "ies"}.`);
        } else {
          setMemorySuccess(`Persistent memory action '${action}' completed.`);
        }
        await runMemoryReadAction("list");
      } catch (error) {
        setMemoryError(error instanceof Error ? error.message : String(error));
      } finally {
        setMemoryRunningAction(null);
      }
    },
    [
      fetchPersistentMemory,
      memoryAgent,
      memoryContent,
      memoryCrew,
      memoryFromPath,
      memoryFromSession,
      memoryLimit,
      memoryNoCompact,
      memoryOldText,
      memorySource,
      memoryTags,
      memoryTargetPercent,
      runMemoryReadAction,
    ],
  );

  useEffect(() => {
    if (!memoryCrew.trim() || !memoryAgent.trim()) return;
    void runMemoryReadAction("list");
  }, [memoryCrew, memoryAgent, runMemoryReadAction]);

  return (
    <>
      <div className="settings-context-sticky-stats" role="status" aria-live="polite">
        <div className="settings-stats">
          <div className="settings-stat">
            <span className="settings-stat__label">Total Documents</span>
            <span className="settings-stat__value">{statsLoading ? "..." : corpusStats.totalDocuments}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Operational</span>
            <span className="settings-stat__value">{statsLoading ? "..." : corpusStats.operational}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Proposed</span>
            <span className="settings-stat__value">{statsLoading ? "..." : corpusStats.proposed}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Excluded</span>
            <span className="settings-stat__value">{statsLoading ? "..." : corpusStats.excluded}</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Last Indexed</span>
            <span className="settings-stat__value" style={{ fontSize: 12 }}>
              {corpusStats.lastIndexed}
            </span>
          </div>
        </div>
      </div>

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

        <div className="settings-context-config">
          <div className="settings-context-tools__header">Vector Runtime Config</div>
          <p className="settings-context-tools__hint">
            Connected to workspace <code>.env</code>. Changes here update MAH runtime vars used by <code>mah context find</code> and WebUI actions.
          </p>
          <ToggleSwitch
            checked={contextSettings.MAH_VECTOR_RETRIEVAL === "1"}
            onChange={(checked) =>
              setContextSettings((prev) => ({ ...prev, MAH_VECTOR_RETRIEVAL: checked ? "1" : "0" }))
            }
            label="Enable Vector Retrieval (MAH_VECTOR_RETRIEVAL=1)"
          />
          <div className="settings-context-presets">
            <span className="settings-context-presets__label">Presets</span>
            <div className="settings-context-tools__actions">
              <button className="settings-btn" type="button" onClick={() => applyPreset("qdrant")}>
                Qdrant
              </button>
              <button className="settings-btn" type="button" onClick={() => applyPreset("pgvector")}>
                pgvector
              </button>
              <button className="settings-btn" type="button" onClick={() => applyPreset("qmd")}>
                qmd
              </button>
            </div>
          </div>
          <div className="settings-context-config__grid">
            <FormField
              label="QMD Path"
              value={contextSettings.MAH_QMD_PATH}
              onChange={(value) => setContextSettings((prev) => ({ ...prev, MAH_QMD_PATH: value }))}
              disabled={contextSettingsLoading || contextSettingsSaving}
              placeholder="qmd"
            />
            <FormField
              label="PVector URL"
              value={contextSettings.MAH_PVECTOR_URL}
              onChange={(value) => setContextSettings((prev) => ({ ...prev, MAH_PVECTOR_URL: value }))}
              disabled={contextSettingsLoading || contextSettingsSaving}
              placeholder="http://localhost:8080"
            />
            <FormField
              label="PVector Collection"
              value={contextSettings.MAH_PVECTOR_COLLECTION}
              onChange={(value) => setContextSettings((prev) => ({ ...prev, MAH_PVECTOR_COLLECTION: value }))}
              disabled={contextSettingsLoading || contextSettingsSaving}
              placeholder="mah-context"
            />
            <FormField
              label="PGVector DSN"
              value={contextSettings.MAH_PGVECTOR_DSN}
              onChange={(value) => setContextSettings((prev) => ({ ...prev, MAH_PGVECTOR_DSN: value }))}
              disabled={contextSettingsLoading || contextSettingsSaving}
              placeholder="postgresql://mah:mah@localhost:5432/mah_context"
            />
            <FormField
              label="PGVector Table"
              value={contextSettings.MAH_PGVECTOR_TABLE}
              onChange={(value) => setContextSettings((prev) => ({ ...prev, MAH_PGVECTOR_TABLE: value }))}
              disabled={contextSettingsLoading || contextSettingsSaving}
              placeholder="context_vectors"
            />
            <FormField
              label="PGVector Collection Mode"
              type="select"
              value={contextSettings.MAH_PGVECTOR_COLLECTION_MODE}
              onChange={(value) =>
                setContextSettings((prev) => ({
                  ...prev,
                  MAH_PGVECTOR_COLLECTION_MODE:
                    value === "column" || value === "payload" ? value : "none",
                }))
              }
              disabled={contextSettingsLoading || contextSettingsSaving}
              options={[
                { value: "none", label: "none" },
                { value: "column", label: "column" },
                { value: "payload", label: "payload" },
              ]}
            />
          </div>
          <div className="settings-context-tools__actions">
            <button
              className="settings-btn settings-btn--primary"
              type="button"
              onClick={() => void saveContextSettings()}
              disabled={contextSettingsLoading || contextSettingsSaving}
            >
              <Icon name="save" size={14} />
              {contextSettingsSaving ? "Saving..." : "Save Vector Config"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void loadContextSettings()}
              disabled={contextSettingsLoading || contextSettingsSaving}
            >
              <Icon name="refresh" size={14} />
              {contextSettingsLoading ? "Reloading..." : "Reload"}
            </button>
          </div>
          {contextSettingsError && <p className="settings-context-tools__error">{contextSettingsError}</p>}
          {contextSettingsSuccess && <p className="settings-context-tools__success">{contextSettingsSuccess}</p>}
        </div>

        <div className="settings-context-tools">
          <div className="settings-context-tools__header">Vector Actions</div>
          <p className="settings-context-tools__hint">
            Runs context commands (`index`, `find`) via backend using the saved runtime config above.
          </p>
          <div className="settings-context-tools__actions">
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runIndex(false)}
              disabled={runningAction !== null}
            >
              <Icon name="sync" size={14} />
              {runningAction === "index" ? "Indexing..." : "Index"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runIndex(true)}
              disabled={runningAction !== null}
            >
              <Icon name="restart_alt" size={14} />
              {runningAction === "rebuild" ? "Rebuild..." : "Rebuild Index"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void refreshCorpusStats()}
              disabled={statsLoading || runningAction !== null}
            >
              <Icon name="refresh" size={14} />
              {statsLoading ? "Refreshing..." : "Refresh Stats"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runVectorAction("index_qdrant")}
              disabled={runningAction !== null}
            >
              <Icon name="database" size={14} />
              {runningAction === "index_qdrant" ? "Indexing Qdrant..." : "Index Qdrant"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runVectorAction("index_pgvector")}
              disabled={runningAction !== null}
            >
              <Icon name="data_object" size={14} />
              {runningAction === "index_pgvector" ? "Indexing pgvector..." : "Index pgvector"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runVectorAction("proxy_health")}
              disabled={runningAction !== null}
            >
              <Icon name="health_and_safety" size={14} />
              {runningAction === "proxy_health" ? "Checking Proxy..." : "Proxy Health"}
            </button>
          </div>

          <div className="settings-context-search">
            <FormField
              label="Search Agent"
              type="select"
              value={searchAgent}
              onChange={setSearchAgent}
              options={[
                { value: "", label: "Select agent" },
                ...agentOptions,
              ]}
            />
            <FormField
              label="Capability (optional)"
              value={searchCapability}
              onChange={setSearchCapability}
              placeholder="backlog-planning"
            />
            <FormField
              label="Task Query"
              value={searchTask}
              onChange={setSearchTask}
              placeholder="Describe the retrieval query"
            />
            <button
              className="settings-btn settings-btn--primary settings-context-search__run"
              type="button"
              onClick={() => void runSearch()}
              disabled={runningAction !== null || !searchAgent.trim() || !searchTask.trim()}
            >
              <Icon name="search" size={14} />
              {runningAction === "search" ? "Searching..." : "Search"}
            </button>
          </div>

          {actionError && <p className="settings-context-tools__error">{actionError}</p>}
          {actionSuccess && <p className="settings-context-tools__success">{actionSuccess}</p>}

          {searchSummary && (
            <div className="settings-context-summary">
              <span>Provider: <strong>{searchSummary.provider ?? "file"}</strong></span>
              <span>Confidence: <strong>{searchSummary.confidence ?? "unknown"}</strong></span>
              <span>Candidates: <strong>{searchSummary.totalCandidates ?? 0}</strong></span>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="settings-section__scroll settings-context-results">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Score</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((item) => (
                    <tr key={`${item.id}:${item.score}`}>
                      <td className="settings-table__mono">{item.id}</td>
                      <td>{Math.round(item.score * 100)}%</td>
                      <td>{item.reasons || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="settings-context-tools">
          <div className="settings-context-tools__header">Persistent Memory</div>
          <p className="settings-context-tools__hint">
            Manage bounded durable memory in <code>.mah/context/persistent/agents/&lt;crew&gt;/&lt;agent&gt;.memory.json</code>.
          </p>
          <div className="settings-context-memory-grid">
            <FormField
              label="Crew"
              type="select"
              value={memoryCrew}
              onChange={setMemoryCrew}
              options={crewOptions.length > 0 ? crewOptions : [{ value: "dev", label: "dev" }]}
            />
            <FormField
              label="Agent"
              type="select"
              value={memoryAgent}
              onChange={setMemoryAgent}
              options={memoryAgentOptions.length > 0 ? memoryAgentOptions : [{ value: "", label: "Select agent" }]}
            />
            <FormField
              label="Task Query (search)"
              value={memoryTask}
              onChange={setMemoryTask}
              placeholder="triage backlog and create milestones"
            />
            <FormField
              label="Limit"
              type="number"
              value={memoryLimit}
              onChange={setMemoryLimit}
              min={1}
              max={50}
            />
            <FormField
              label="New Content (add/replace)"
              type="textarea"
              value={memoryContent}
              onChange={setMemoryContent}
              rows={3}
              placeholder="Durable pattern to keep for this agent"
            />
            <FormField
              label="Old Text (replace/remove)"
              value={memoryOldText}
              onChange={setMemoryOldText}
              placeholder="unique substring to match"
            />
            <FormField
              label="Source"
              value={memorySource}
              onChange={setMemorySource}
              placeholder="manual"
            />
            <FormField
              label="Tags (comma-separated)"
              value={memoryTags}
              onChange={setMemoryTags}
              placeholder="planning,clickup"
            />
            <FormField
              label="Capture from Session"
              value={memoryFromSession}
              onChange={setMemoryFromSession}
              placeholder="runtime:crew:sessionId"
            />
            <FormField
              label="Capture from Path"
              value={memoryFromPath}
              onChange={setMemoryFromPath}
              placeholder=".pi/crew/dev/sessions/..."
            />
            <FormField
              label="Compact Target %"
              type="number"
              value={memoryTargetPercent}
              onChange={setMemoryTargetPercent}
              min={10}
              max={95}
            />
            <ToggleSwitch checked={memoryNoCompact} onChange={setMemoryNoCompact} label="Capture without compact (no-compact)" />
          </div>

          <div className="settings-context-tools__actions">
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryReadAction("list")}
              disabled={memoryRunningAction !== null || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="list" size={14} />
              {memoryRunningAction === "list" ? "Loading..." : "List"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryReadAction("stats")}
              disabled={memoryRunningAction !== null || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="monitoring" size={14} />
              {memoryRunningAction === "stats" ? "Loading..." : "Stats"}
            </button>
            <button
              className="settings-btn settings-btn--primary"
              type="button"
              onClick={() => void runMemoryReadAction("search")}
              disabled={memoryRunningAction !== null || !memoryAgent.trim() || !memoryCrew.trim() || !memoryTask.trim()}
            >
              <Icon name="search" size={14} />
              {memoryRunningAction === "search" ? "Searching..." : "Search"}
            </button>
          </div>

          <div className="settings-context-tools__actions">
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryWriteAction("add")}
              disabled={memoryRunningAction !== null || !memoryContent.trim() || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="add" size={14} />
              {memoryRunningAction === "add" ? "Adding..." : "Add"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryWriteAction("replace")}
              disabled={memoryRunningAction !== null || !memoryContent.trim() || !memoryOldText.trim() || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="edit" size={14} />
              {memoryRunningAction === "replace" ? "Replacing..." : "Replace"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryWriteAction("remove")}
              disabled={memoryRunningAction !== null || !memoryOldText.trim() || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="delete" size={14} />
              {memoryRunningAction === "remove" ? "Removing..." : "Remove"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryWriteAction("compact")}
              disabled={memoryRunningAction !== null || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="compress" size={14} />
              {memoryRunningAction === "compact" ? "Compacting..." : "Compact"}
            </button>
            <button
              className="settings-btn"
              type="button"
              onClick={() => void runMemoryWriteAction("capture")}
              disabled={memoryRunningAction !== null || (!memoryFromSession.trim() && !memoryFromPath.trim()) || !memoryAgent.trim() || !memoryCrew.trim()}
            >
              <Icon name="download" size={14} />
              {memoryRunningAction === "capture" ? "Capturing..." : "Capture"}
            </button>
          </div>

          {memoryError && <p className="settings-context-tools__error">{memoryError}</p>}
          {memorySuccess && <p className="settings-context-tools__success">{memorySuccess}</p>}

          {(memoryUsage || memoryFilePath) && (
            <div className="settings-context-summary">
              {memoryUsage && (
                <>
                  <span>
                    Usage: <strong>{memoryUsage.used_chars}/{memoryUsage.char_limit}</strong> chars ({memoryUsage.usage_percent}%)
                  </span>
                  <span>
                    Entries: <strong>{memoryUsage.entry_count}/{memoryUsage.entry_limit}</strong>
                  </span>
                </>
              )}
              {memoryFilePath && (
                <span>
                  Store: <strong className="settings-table__mono">{memoryFilePath}</strong>
                </span>
              )}
            </div>
          )}

          {memoryLastAction === "search" && memoryMatches.length > 0 && (
            <div className="settings-section__scroll settings-context-results">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Content</th>
                    <th>Score</th>
                    <th>Tags</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {memoryMatches.map((item) => (
                    <tr key={`${item.id}:${item.score}`}>
                      <td>{item.content}</td>
                      <td>{Math.round(item.score * 100)}%</td>
                      <td>{Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(", ") : "—"}</td>
                      <td>{Array.isArray(item.reasons) && item.reasons.length > 0 ? item.reasons.join("; ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(memoryLastAction !== "search" || memoryMatches.length === 0) && memoryEntries.length > 0 && (
            <div className="settings-section__scroll settings-context-results">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Content</th>
                    <th>Source</th>
                    <th>Tags</th>
                    <th>Use Count</th>
                  </tr>
                </thead>
                <tbody>
                  {memoryEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="settings-table__mono">{entry.id.slice(0, 8)}</td>
                      <td>{entry.content}</td>
                      <td>{entry.source || "manual"}</td>
                      <td>{Array.isArray(entry.tags) && entry.tags.length > 0 ? entry.tags.join(", ") : "—"}</td>
                      <td>{Number.isFinite(entry.use_count) ? entry.use_count : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
