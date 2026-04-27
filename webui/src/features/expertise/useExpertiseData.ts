import { useState, useEffect, useCallback } from "react";

export type ExpertiseEntry = {
  id: string;
  lifecycle: "experimental" | "active" | "restricted" | "revoked";
  confidence: { score: number; band: string; evidence_count: number };
  validation_status: "declared" | "reviewed" | "validated";
  trust_tier: string;
  owner: { agent?: string; team?: string };
  capabilities: string[];
  domains?: string[];
  capabilities_keywords?: string[];
  evidence_count?: number;
  last_updated?: string;
};

export type EvidenceEvent = {
  id: string;
  expertise_id: string;
  recorded_at: string;
  outcome: "success" | "failure" | "partial";
  task_type: string;
  task_description: string;
  duration_ms: number;
  session_id: string;
};

export type ProposalInfo = {
  id: string;
  target_expertise_id: string;
  summary: string;
  rationale: string;
  generated_by: { actor: string; role: string };
  reviewers: string[];
  status: "pending" | "approved" | "rejected" | "applied";
  created_at: string;
  proposed_changes: Record<string, any>;
  target_snapshot: { lifecycle: string; validation_status: string; confidence: any };
};

export type SyncChange = {
  agent: string;
  type: "confidence" | "capabilities";
  from: any;
  to: any;
  changed?: boolean;
  skipped?: boolean;
  reason?: string;
  changes?: Array<{ type: string; from: any; to: any; added?: string[]; invocations?: number }>;
};

export type Metrics = {
  total_invocations: number;
  successful_invocations: number;
  failed_invocations: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  last_invoked: string;
  review_pass_rate: number;
};

export function useExpertiseData(crew = "dev") {
  const [entries, setEntries] = useState<ExpertiseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["expertise", "list", "--crew", crew, "--json"] }),
      });
      const data = await resp.json();
      if (data.ok) {
        const parsed = JSON.parse(data.stdout || "{}");
        setEntries(parsed.expertise || []);
      } else {
        setError(data.stderr || "Failed to load expertise");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [crew]);

  useEffect(() => { load(); }, [load]);
  return { entries, loading, error, reload: load };
}

export function useExpertiseDetail(id: string) {
  const [entry, setEntry] = useState<ExpertiseEntry | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: ["expertise", "show", id, "--json"] }),
        });
        const data = await resp.json();
        if (data.ok && !cancelled) {
          const parsed = JSON.parse(data.stdout || "{}");
          setEntry(parsed.expertise || parsed);
          setMetrics(parsed.metrics || null);
        } else if (!cancelled) {
          setError(data.stderr || "Failed");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  return { entry, metrics, loading, error };
}

export function useEvidenceData(id: string, limit = 50) {
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: ["expertise", "evidence", id, "--limit", String(limit), "--json"] }),
        });
        const data = await resp.json();
        if (data.ok && !cancelled) {
          const parsed = JSON.parse(data.stdout || "{}");
          setEvents(parsed.events || []);
        } else if (!cancelled) {
          setError(data.stderr || "Failed");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, limit]);

  return { events, loading, error };
}

export function useSyncDryRun(crew = "dev") {
  const [changes, setChanges] = useState<SyncChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSync = useCallback(async (apply = false) => {
    setLoading(true);
    setError(null);
    try {
      const args = ["expertise", "sync", "--crew", crew];
      if (!apply) args.push("--dry-run");
      args.push("--json");
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
      });
      const data = await resp.json();
      if (data.ok) {
        const parsed = JSON.parse(data.stdout || "{}");
        setChanges(parsed.results || []);
      } else {
        setError(data.stderr || "Sync failed");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [crew]);

  return { changes, loading, error, runSync };
}

export function useProposals() {
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const listResp = await fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: ["exec", "--", "ls", ".mah/expertise/proposals/"] }),
        });
        const listData = await listResp.json();
        const proposalsList: ProposalInfo[] = [];
        if (listData.ok && listData.stdout) {
          const files = (listData.stdout as string).trim().split("\n").filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
          for (const file of files) {
            const fullPath = `.mah/expertise/proposals/${file}`;
            const propResp = await fetch("/api/mah/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ args: ["exec", "--", "cat", fullPath] }),
            });
            const propData = await propResp.json();
            if (propData.ok && propData.stdout) {
              try {
                const yaml = await import("js-yaml");
                const doc = yaml.load(propData.stdout);
                if (doc && typeof doc === "object") {
                  const d = doc as Record<string, unknown>;
                  proposalsList.push({
                    id: d.id as string || file,
                    target_expertise_id: (d.target_expertise_id as string) || "",
                    summary: (d.summary as string) || "",
                    rationale: (d.rationale as string) || "",
                    generated_by: (d.generated_by as { actor: string; role: string }) || { actor: "unknown", role: "" },
                    reviewers: (d.reviewers as string[]) || [],
                    status: (d.status as ProposalInfo["status"]) || "pending",
                    created_at: (d.created_at as string) || "",
                    proposed_changes: (d.proposed_changes as Record<string, unknown>) || {},
                    target_snapshot: (d.target_snapshot as ProposalInfo["target_snapshot"]) || { lifecycle: "", validation_status: "", confidence: null },
                  });
                }
              } catch { /* skip invalid YAML */ }
            }
          }
        }
        if (!cancelled) setProposals(proposalsList);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { proposals, loading, error };
}

export function useRecommend(task: string, crew = "dev") {
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recommend = useCallback(async () => {
    if (!task.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["expertise", "recommend", "--task", task, "--crew", crew, "--json"] }),
      });
      const data = await resp.json();
      if (data.ok) {
        setResult(JSON.parse(data.stdout || "{}"));
      } else {
        setError(data.stderr || "Failed");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [task, crew]);

  return { result, loading, error, recommend };
}
