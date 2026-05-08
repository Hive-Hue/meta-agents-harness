import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";

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
  file_path?: string;
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
  const { workspacePath } = useWorkspace();
  const [entries, setEntries] = useState<ExpertiseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mah-workspace-path": workspacePath },
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
  }, [crew, workspacePath]);

  useEffect(() => { load(); }, [load]);
  return { entries, loading, error, reload: load };
}

export function useExpertiseDetail(id: string) {
  const { workspacePath } = useWorkspace();
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
          headers: { "Content-Type": "application/json", "x-mah-workspace-path": workspacePath },
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
  }, [id, workspacePath]);

  return { entry, metrics, loading, error };
}

export function useEvidenceData(id: string, limit = 50) {
  const { workspacePath } = useWorkspace();
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
          headers: { "Content-Type": "application/json", "x-mah-workspace-path": workspacePath },
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
  }, [id, limit, workspacePath]);

  return { events, loading, error };
}

export function useSyncDryRun(crew = "dev") {
  const { workspacePath } = useWorkspace();
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
        headers: { "Content-Type": "application/json", "x-mah-workspace-path": workspacePath },
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
  }, [crew, workspacePath]);

  return { changes, loading, error, runSync };
}

export function useProposals() {
  const { workspacePath } = useWorkspace();
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/expertise-proposals", {
        headers: { "x-mah-workspace-path": workspacePath },
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || "Failed to load proposals");
        setProposals([]);
        return;
      }
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
    } catch (e) {
      setError(String(e));
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  return { proposals, loading, error, reload: load };
}

export function useRecommend(task: string, crew = "dev") {
  const { workspacePath } = useWorkspace();
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
        headers: { "Content-Type": "application/json", "x-mah-workspace-path": workspacePath },
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
  }, [task, crew, workspacePath]);

  return { result, loading, error, recommend };
}
