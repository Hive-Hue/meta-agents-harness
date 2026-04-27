import { useState, useEffect } from "react";

export type SessionInfo = {
  id: string;
  crew: string;
  runtime: string;
  status: "running" | "completed" | "failed" | "available" | "shutdown";
  createdAt: string;
  updatedAt: string;
  counts?: {
    conversation: number;
    tool_calls: number;
    artifacts: number;
    delegations: number;
  };
  finalAgent?: string;
};

export function useSessionsData() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: ["sessions", "list", "--json"] }),
        });
        const data = await resp.json();
        if (data.ok) {
          const lines = (data.stdout || "").trim().split("\n").filter(Boolean);
          const parsed = lines.map((line: string) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          // CLI returns { sessions: [...] } wrapping the array
          const sessionsData = (parsed[0] as { sessions?: SessionInfo[] })?.sessions ?? parsed as SessionInfo[];
          setSessions(sessionsData);
        } else {
          setError(data.stderr || "Failed to load sessions");
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { sessions, loading, error };
}
