import { useState, useEffect, useCallback } from "react";

export interface ContextDoc {
  id: string;
  kind: string;
  stability: string;
  priority: string;
  last_reviewed_at: string;
}

export interface FindResult {
  doc_id: string;
  score: number;
  matched_on: string[];
  reason: string;
}

export interface ContextProposal {
  id: string;
  status: "pending" | "approved" | "rejected" | "promoted";
  agent: string;
  stability: string;
  source_session: string;
  summary: string;
}

async function runMah(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const resp = await fetch("/api/mah/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  });
  return resp.json();
}

export function useContextDocuments() {
  const [docs, setDocs] = useState<ContextDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await runMah(["context", "list", "--json"]);
    if (result.ok) {
      try {
        const data = JSON.parse(result.stdout);
        setDocs(data.documents || []);
      } catch { setDocs([]); }
    } else {
      setError(result.stderr || "Failed to load documents");
    }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { docs, loading, error, reload };
}

export function useContextFind() {
  const [results, setResults] = useState<FindResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = useCallback(async (agent: string, task: string, capability?: string) => {
    setLoading(true);
    setError(null);
    const args = ["context", "find", "--agent", agent, "--task", task, "--json"];
    if (capability) args.push("--capability", capability);
    const result = await runMah(args);
    if (result.ok) {
      try { setResults(JSON.parse(result.stdout).results || []); }
      catch { setResults([]); }
    } else { setError(result.stderr || "Find failed"); }
    setLoading(false);
  }, []);

  return { results, loading, error, find };
}

export function useContextValidate() {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{total: number; valid: number; invalid: number} | null>(null);

  const validate = useCallback(async (strict: boolean = false) => {
    setLoading(true);
    setError(null);
    const args = ["context", "validate", "--json"];
    if (strict) args.push("--strict");
    const result = await runMah(args);
    if (result.ok) {
      try {
        const data = JSON.parse(result.stdout);
        setResults(data.results || []);
        setSummary(data.summary || null);
      } catch { setResults([]); }
    } else { setError(result.stderr || "Validate failed"); }
    setLoading(false);
  }, []);

  return { results, loading, error, summary, validate };
}

export function useContextProposals() {
  const [proposals, setProposals] = useState<ContextProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await runMah(["context", "proposals", "list", "--json"]);
    if (result.ok) {
      try { setProposals(JSON.parse(result.stdout).proposals || []); }
      catch { setProposals([]); }
    } else { setError(result.stderr || "Failed to load proposals"); }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { proposals, loading, error, reload };
}
