import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";

export interface WorkspaceInfo {
  path: string;
  name: string;
  gitBranch: string;
  gitDirty: boolean;
  gitClean: boolean;
  configExists: boolean;
}

export interface SessionInfo {
  id: string;
  runtime: string;
  crew: string;
  session_id: string;
  source_path: string;
  started_at: string;
  last_active_at: string;
  status: string;
}

export interface ConfigInfo {
  name: string;
  description: string;
  runtimes: Record<string, unknown>;
  catalog: { models: Record<string, string>; model_fallbacks: Record<string, string[]> };
  crews: Array<{ id: string; display_name?: string; agents?: Array<{ id: string; role: string; team: string; skills?: string[] }> }>;
  [key: string]: unknown;
}

export function relativeTime(dateStr: string): string {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

interface WorkspaceData {
  workspace: WorkspaceInfo | null;
  config: ConfigInfo | null;
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 15000;
const workspaceDataCache = new Map<string, { config: ConfigInfo | null; sessions: SessionInfo[] }>();

async function fetchJsonWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function useWorkspaceData(): WorkspaceData {
  const { workspace, loading: wsLoading, refresh: refreshWorkspace } = useWorkspace();
  const workspacePath = workspace?.path || localStorage.getItem("mah_workspace_path") || ".";
  const cached = workspaceDataCache.get(workspacePath);
  const [config, setConfig] = useState<ConfigInfo | null>(cached?.config ?? null);
  const [sessions, setSessions] = useState<SessionInfo[]>(cached?.sessions ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const hasCached = workspaceDataCache.has(workspacePath);
    if (!hasCached) setLoading(true);
    setError(null);
    try {
      if (!workspace) {
        await refreshWorkspace();
      }

      const [cfgResult, sesResult] = await Promise.allSettled([
        fetchJsonWithTimeout("/api/mah/config", {
          headers: { "x-mah-workspace-path": workspacePath },
        }),
        fetchJsonWithTimeout("/api/mah/exec", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mah-workspace-path": workspacePath,
          },
          body: JSON.stringify({ args: ["sessions", "list", "--json"] }),
        }),
      ]);

      let nextConfig: ConfigInfo | null = null;
      if (cfgResult.status === "fulfilled") {
        const cfgData = cfgResult.value as { ok?: boolean; config?: ConfigInfo | null };
        if (cfgData.ok && cfgData.config) nextConfig = cfgData.config;
      }
      setConfig(nextConfig);

      let nextSessions: SessionInfo[] = [];
      if (sesResult.status === "fulfilled") {
        const sesData = sesResult.value as { ok?: boolean; stdout?: string };
        if (sesData.ok && sesData.stdout) {
          try {
            const parsed = JSON.parse(sesData.stdout);
            nextSessions = parsed.sessions ?? [];
          } catch {
            nextSessions = [];
          }
        }
      }
      setSessions(nextSessions);
      workspaceDataCache.set(workspacePath, { config: nextConfig, sessions: nextSessions });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfig(null);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [refreshWorkspace, workspace, workspacePath]);

  useEffect(() => {
    const fromCache = workspaceDataCache.get(workspacePath);
    if (fromCache) {
      setConfig(fromCache.config);
      setSessions(fromCache.sessions);
      setLoading(false);
    }
    void refresh();
  }, [refresh, workspacePath]);

  const showWorkspaceLoading = wsLoading && !workspaceDataCache.has(workspacePath) && !workspace;
  return { workspace, config, sessions, loading: loading || showWorkspaceLoading, error, refresh };
}
