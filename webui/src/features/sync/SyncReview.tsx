import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { CommandPreview } from "../../components/ui/CommandPreview";
import "./sync.css";

type SyncReviewPayload = {
  ok: boolean;
  summary: {
    lastSync: string;
    crews: number;
    totalAgents: number;
    proposalCount: number;
  };
  command: {
    dryRun: string;
    status: number;
    stderr?: string;
  };
  checklist: Array<{ label: string; status: "pass" | "warn" }>;
  diffLines: Array<{ op: string; text: string }>;
  crews: Array<{ crew: string; agents: number; synced: number; pending: number; status: "synced" | "partial" }>;
  apply?: {
    command: string;
    status: number;
    stdout: string;
    stderr: string;
  };
};

const statusByTone = {
  synced: { tone: "completed" as const, label: "Synced" },
  partial: { tone: "running" as const, label: "Partial" },
};

export function SyncReview() {
  const [data, setData] = useState<SyncReviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/sync-review");
      const payload = (await resp.json()) as SyncReviewPayload & { error?: string };
      if (!resp.ok || !payload.ok) throw new Error(payload.error || "failed to load sync review");
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const runSync = useCallback(async () => {
    setRunningSync(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await fetch("/api/mah/sync-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = (await resp.json()) as SyncReviewPayload & { error?: string };
      if (!resp.ok || !payload.ok) throw new Error(payload.error || "sync failed");
      setData(payload);
      setSuccess(payload.apply?.status === 0 ? "Sync applied successfully." : "Sync command finished with warnings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningSync(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const meta = useMemo(() => {
    if (!data) return "Loading sync data...";
    const lastSync = data.summary.lastSync === "never" ? "never" : new Date(data.summary.lastSync).toLocaleString();
    return `Last sync: ${lastSync} · ${data.summary.crews} crews · ${data.summary.totalAgents} agents`;
  }, [data]);

  return (
    <div className="sync-panel">
      <div className="sync-panel__header">
        <div>
          <p className="sync-panel__meta">{meta}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="settings-btn" type="button" onClick={() => void load()} disabled={loading || runningSync}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="settings-btn settings-btn--primary" type="button" onClick={() => void runSync()} disabled={runningSync || loading}>
            {runningSync ? "Applying..." : "Apply Sync"}
          </button>
        </div>
      </div>
      <CommandPreview context="expertise" command={data?.command?.dryRun || "mah expertise sync --dry-run"} />
      {error && <p className="settings-context-tools__error">{error}</p>}
      {success && <p className="settings-context-tools__success">{success}</p>}
      <div className="sync-panel__content">
        <div className="sync-split">
          <div className="sync-left">
            <div className="sync-checklist">
              <h4>Validation Checklist</h4>
              {(data?.checklist || []).map((item) => (
                <div className="checklist-item" key={item.label}>
                  <Icon
                    name={item.status === "pass" ? "check_circle" : "warning"}
                    size={16}
                  />
                  <span className="checklist-item__label">{item.label}</span>
                  <span className={`checklist-item__status checklist-item__status--${item.status}`}>
                    {item.status === "pass" ? "PASS" : "WARN"}
                  </span>
                </div>
              ))}
            </div>

            <div className="sync-diff">
              <h4>Dry-run Output</h4>
              <pre>
                <code>
                  {(data?.diffLines || []).map((line) => (
                    <span className={`diff-line diff-line--${line.op}`} key={line.text}>
                      {line.op} {line.text}
                      {"\n"}
                    </span>
                  ))}
                  {!data?.diffLines?.length && "No output from dry-run.\n"}
                </code>
              </pre>
            </div>
          </div>

          <div className="sync-right">
            {(data?.crews || []).map((c) => {
              const badge = statusByTone[c.status];
              return (
                <div className="runtime-card" key={c.crew}>
                  <h4>{c.crew}</h4>
                  <div className="runtime-card__stat">
                    <span>Agents</span>
                    <strong>{c.agents}</strong>
                  </div>
                  <div className="runtime-card__stat">
                    <span>Synced</span>
                    <strong>{c.synced}</strong>
                  </div>
                  <div className="runtime-card__stat">
                    <span>Pending</span>
                    <strong>{c.pending}</strong>
                  </div>
                  <StatusBadge tone={badge.tone} label={badge.label} />
                </div>
              );
            })}
            {!data?.crews?.length && (
              <div className="runtime-card">
                <h4>No crews</h4>
                <div className="runtime-card__stat">
                  <span>Agents</span>
                  <strong>0</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
