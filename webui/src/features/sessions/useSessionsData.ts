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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
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
        const mapped = rows.map((row: any) => {
          return {
            id: row.id,
            crew: row.crew || "",
            runtime: row.runtime || runtime || "",
            status: (row.status || "available") as SessionInfo["status"],
            createdAt: row.started_at || "",
            updatedAt: row.last_active_at || "",
            counts: { conversation: 0, tool_calls: 0, artifacts: 0, delegations: 0 },
            finalAgent: undefined,
            task: "",
          } as SessionInfo;
        });
        setSessions(mapped);
      } else {
        setError(data.stderr || "Failed to load sessions");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Timeout loading sessions. Tente novamente.");
      } else {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => { load(); }, [load]);

  return { sessions, loading, error, reload: load };
}
