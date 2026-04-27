import { useState, useEffect, useCallback } from "react";

export type SessionInfo = {
  id: string;
  crew: string;
  runtime: string;
  status: "running" | "completed" | "failed" | "available" | "shutdown" | "done";
  createdAt: string;
  updatedAt: string;
  counts: { conversation: number; tool_calls: number; artifacts: number; delegations: number };
  finalAgent?: string;
  task?: string;
};

export function useSessionsData(runtime?: string) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const args = ["sessions", "list", "--json"];
      if (runtime) args.push("--runtime", runtime);
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
      });
      const data = await resp.json();
      if (data.ok) {
        let rows: any[] = [];
        try {
          const parsed = JSON.parse(data.stdout || "{}");
          rows = parsed.sessions || [];
        } catch {
          const lines = (data.stdout || "").trim().split("\n").filter(Boolean);
          for (const line of lines) {
            try { rows.push(JSON.parse(line)); } catch { /* skip */ }
          }
        }
        const detailed = await Promise.all(rows.map(async (row: any) => {
          try {
            const idxResp = await fetch("/api/mah/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ args: ["sessions", "status", row.id, "--json"] }),
            });
            const idxData = await idxResp.json();
            if (idxData.ok) {
              try {
                const idx = JSON.parse(idxData.stdout || "{}");
                return {
                  id: row.id,
                  sessionId: row.session_id || row.id.split(":")[2] || "",
                  crew: row.crew || "",
                  runtime: row.runtime || runtime || "",
                  status: idx.status || row.status || "available",
                  createdAt: idx.createdAt || row.started_at || "",
                  updatedAt: idx.updatedAt || row.last_active_at || "",
                  counts: idx.counts || { conversation: 0, tool_calls: 0, artifacts: 0, delegations: 0 },
                  finalAgent: idx.finalAgent,
                  task: idxData.stdout || "",
                } as SessionInfo;
              } catch { /* fall through */ }
            }
          } catch { /* skip detail */ }
          return {
            id: row.id,
            sessionId: row.session_id || row.id.split(":")[2] || "",
            crew: row.crew || "",
            runtime: row.runtime || runtime || "",
            status: (row.status as SessionInfo["status"]) || "available",
            createdAt: row.started_at || "",
            updatedAt: row.last_active_at || "",
            counts: { conversation: 0, tool_calls: 0, artifacts: 0, delegations: 0 },
          } as SessionInfo;
        }));
        setSessions(detailed);
      } else {
        setError(data.stderr || "Failed to load sessions");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => { load(); }, [load]);

  return { sessions, loading, error, reload: load };
}
