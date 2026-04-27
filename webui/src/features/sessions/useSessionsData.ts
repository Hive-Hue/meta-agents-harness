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
          // Get status and timestamps from sessions status
          let status: SessionInfo["status"] = "available";
          let createdAt = "";
          let updatedAt = "";
          let finalAgent: string | undefined;
          let task = "";
          try {
            const statusResp = await fetch("/api/mah/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ args: ["sessions", "status", row.id, "--json"] }),
            });
            const statusData = await statusResp.json();
            if (statusData.ok) {
              const st = JSON.parse(statusData.stdout || "{}");
              status = st.status || "available";
              createdAt = st.createdAt || "";
              updatedAt = st.updatedAt || "";
              finalAgent = st.finalAgent;
              task = statusData.stdout || "";
            }
          } catch { /* skip */ }

          // Get counts from sessions counts
          let counts = { conversation: 0, tool_calls: 0, artifacts: 0, delegations: 0 };
          try {
            const countsResp = await fetch("/api/mah/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ args: ["sessions", "counts", row.id] }),
            });
            const countsData = await countsResp.json();
            if (countsData.ok) {
              const ct = JSON.parse(countsData.stdout || "{}");
              if (ct.counts) counts = ct.counts;
            }
          } catch { /* skip */ }

          return {
            id: row.id,
            sessionId: row.session_id || row.id.split(":")[2] || "",
            crew: row.crew || "",
            runtime: row.runtime || runtime || "",
            status,
            createdAt: createdAt || row.started_at || "",
            updatedAt: updatedAt || row.last_active_at || "",
            counts,
            finalAgent,
            task,
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
