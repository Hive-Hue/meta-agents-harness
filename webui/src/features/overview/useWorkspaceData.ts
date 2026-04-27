import { useState, useEffect, useCallback } from "react";

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

export function useWorkspaceData(): WorkspaceData {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wsRes, cfgRes, sesRes] = await Promise.all([
        fetch("/api/mah/workspace"),
        fetch("/api/mah/config"),
        fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: ["sessions", "list", "--json"] }),
        }),
      ]);

      const wsData = await wsRes.json();
      if (wsData.ok) setWorkspace(wsData.workspace);

      const cfgData = await cfgRes.json();
      if (cfgData.ok && cfgData.config) setConfig(cfgData.config);

      const sesData = await sesRes.json();
      if (sesData.ok && sesData.stdout) {
        try {
          const parsed = JSON.parse(sesData.stdout);
          setSessions(parsed.sessions ?? []);
        } catch {
          setSessions([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { workspace, config, sessions, loading, error, refresh };
}
