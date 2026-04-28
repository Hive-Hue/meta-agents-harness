import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export interface WorkspaceInfo {
  path: string;
  name: string;
  gitBranch: string;
  gitDirty: boolean;
  gitClean: boolean;
  configExists: boolean;
}

interface WorkspaceContextValue {
  workspacePath: string;
  setWorkspacePath: (path: string) => void;
  workspace: WorkspaceInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const WORKSPACE_FETCH_TIMEOUT_MS = 10000;

async function fetchWorkspace(path: string): Promise<WorkspaceInfo | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKSPACE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/mah/workspace", {
      headers: { "x-mah-workspace-path": path },
      signal: controller.signal,
    });
    const data = await res.json();
    return data.ok ? (data.workspace as WorkspaceInfo) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspacePath, _setWorkspacePath] = useState(() => localStorage.getItem("mah_workspace_path") || ".");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const setWorkspacePath = useCallback((path: string) => {
    localStorage.setItem("mah_workspace_path", path);
    _setWorkspacePath(path);
    // Trigger immediate re-fetch with new path.
    setLoading(true);
    void fetchWorkspace(path)
      .then((data) => {
        if (data) setWorkspace(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const path = localStorage.getItem("mah_workspace_path") || ".";
      const data = await fetchWorkspace(path);
      if (data) setWorkspace(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <WorkspaceContext.Provider value={{ workspacePath, setWorkspacePath, workspace, loading, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
