import { useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useSessionLifecycle, type LifecycleEvent } from "./useSessionLifecycle";

interface SessionInspectorProps {
  sessionId: string;
  runtime: string;
  crew: string;
  status: string;
  createdAt: string;
  onClose: () => void;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().replace("T", " ").substring(0, 19);
  } catch {
    return "—";
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const TONE_MAP: Record<string, "running" | "completed" | "failed"> = {
  running: "running", completed: "completed", failed: "failed",
  shutdown: "failed", available: "completed", done: "completed"
};

const EVENT_ICONS: Record<string, string> = {
  queued: "queue",
  routed: "call_made",
  context_loaded: "folder_open",
  running: "play_arrow",
  blocked: "block",
  completed: "check_circle",
  failed: "error",
};

function EventIcon({ event }: { event: string }) {
  const name = EVENT_ICONS[event] || "circle";
  const color = event === "completed" ? "#22c55e" : event === "failed" || event === "blocked" ? "#ef4444" : "#3b82f6";
  return <Icon name={name} size={14} style={{ color }} />;
}

export function SessionInspector({
  sessionId,
  runtime,
  crew,
  status,
  createdAt,
  onClose,
}: SessionInspectorProps) {
  const { events, goal, costSummary, currentState, loading, error, reload } = useSessionLifecycle(sessionId);

  // Counts (from existing inline logic — fetched via sessions counts command)
  const [counts, setCounts] = useState({ conversation: 0, tool_calls: 0, artifacts: 0, delegations: 0 });
  const [countsLoading, setCountsLoading] = useState(false);

  // Resume / terminate state
  const [resumeBusy, setResumeBusy] = useState(false);
  const [terminating, setTerminating] = useState(false);

  // Fetch counts once on mount
  useState(() => {
    setCountsLoading(true);
    fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "counts", sessionId] }),
    })
      .then(r => r.json())
      .then(data => {
        try {
          const parsed = JSON.parse(data.stdout || "{}");
          if (parsed?.counts) {
            setCounts({
              conversation: Number(parsed.counts.conversation || 0),
              tool_calls: Number(parsed.counts.tool_calls || 0),
              artifacts: Number(parsed.counts.artifacts || 0),
              delegations: Number(parsed.counts.delegations || 0),
            });
          }
        } catch { /* ignore */ }
      })
      .catch(() => { /* keep zeros */ })
      .finally(() => setCountsLoading(false));
  });

  const handleResume = async () => {
    setResumeBusy(true);
    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["sessions", "resume", sessionId] }),
      });
      const data = await resp.json();
      if (!data.ok) {
        alert(`Resume failed: ${data.stderr || data.error}`);
      }
    } catch (e) {
      alert(`Resume error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResumeBusy(false);
    }
  };

  const handleStop = async () => {
    if (!confirm(`Stop session ${sessionId}? This will mark it as failed.`)) return;
    setTerminating(true);
    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: ["sessions", "stop", sessionId] }),
      });
      const data = await resp.json();
      if (!data.ok) {
        alert(`Stop failed: ${data.stderr || data.error}`);
        setTerminating(false);
        return;
      }
      onClose();
    } catch (e) {
      alert(`Stop error: ${e instanceof Error ? e.message : String(e)}`);
      setTerminating(false);
    }
  };

  const handleExport = async () => {
    const resp = await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "export", sessionId] }),
    });
    const data = await resp.json();
    if (data.ok) {
      const blob = new Blob([data.stdout || "{}"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${sessionId}.json`; a.click();
      URL.revokeObjectURL(url);
    } else {
      alert(`Export failed: ${data.stderr}`);
    }
  };

  const isRunning = status === "running" || currentState === "running";

  return (
    <>
      {/* Header */}
      <section className="inspector__header">
        <div className="inspector__title-row">
          <div>
            <h3>Session Inspector</h3>
            <p className="session-inspector__session-id">{sessionId}</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close inspector">
            <Icon name="close" size={16} />
          </button>
        </div>
      </section>

      {/* Body */}
      <section className="inspector__body">
        {/* Status / meta */}
        <div className="inspector-stats">
          <div>
            <span>Status</span>
            <StatusBadge tone={TONE_MAP[status] || "failed"} label={status} />
          </div>
          <div><span>Runtime</span><strong>{runtime}</strong></div>
          <div><span>Crew</span><strong>{crew}</strong></div>
          <div><span>Started</span><strong>{formatTimestamp(createdAt)}</strong></div>
          {loading && <div><span>Lifecycle</span><strong className="metric-loading">...</strong></div>}
          {!loading && currentState !== "unknown" && (
            <div><span>Lifecycle</span><strong>{currentState}</strong></div>
          )}
        </div>

        {/* Goal Banner */}
        {goal && (
          <div className="session-inspector__goal">
            <Icon name="flag" size={12} />
            <span className="session-inspector__goal-text">{goal}</span>
          </div>
        )}

        {/* Cost Summary */}
        {costSummary && (
          <div className="session-inspector__cost">
            <div className="session-inspector__cost-row">
              <span>Duration</span>
              <strong>{formatDurationMs(costSummary.duration_ms)}</strong>
            </div>
            <div className="session-inspector__cost-row">
              <span>Lifecycle Events</span>
              <strong>{costSummary.lifecycle_events}</strong>
            </div>
          </div>
        )}

        {/* Lifecycle Timeline */}
        {events.length > 0 && (
          <div className="session-inspector__timeline">
            <h4 className="session-inspector__section-title">Lifecycle Timeline</h4>
            <ol className="timeline-list">
              {events.map((ev, i) => (
                <li key={i} className="timeline-item">
                  <EventIcon event={ev.event} />
                  <div className="timeline-item__content">
                    <span className="timeline-item__event">{ev.event}</span>
                    <span className="timeline-item__time">{formatTimestamp(ev.timestamp)}</span>
                    {ev.agent && (
                      <span className="timeline-item__agent">→ {ev.agent}</span>
                    )}
                    {ev.routing_confidence !== undefined && (
                      <span className="timeline-item__conf">
                        conf: {(ev.routing_confidence * 100).toFixed(0)}%
                      </span>
                    )}
                    {ev.event === "completed" && ev.result_code !== undefined && (
                      <span className="timeline-item__exit">(exit: {ev.result_code})</span>
                    )}
                    {ev.event === "failed" && ev.result_reason && (
                      <span className="timeline-item__reason">— {ev.result_reason}</span>
                    )}
                    {ev.cost_summary && (
                      <span className="timeline-item__cost">
                        [cost: {ev.cost_summary.duration_ms}ms, {ev.cost_summary.lifecycle_events} events]
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {loading && events.length === 0 && (
          <div className="session-inspector__loading">Loading lifecycle...</div>
        )}

        {error && (
          <div className="error-state" style={{ padding: "12px", fontSize: 12 }}>
            {error} <button onClick={reload} style={{ marginLeft: 8, textDecoration: "underline", background: "none", border: "none", color: "var(--color-secondary-cyan)", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {/* Counts */}
        <div className="inspector-stats">
          <div>
            <span>Conversations</span>
            <strong className={countsLoading ? "metric-loading" : ""}>
              {countsLoading ? "..." : counts.conversation}
            </strong>
          </div>
          <div>
            <span>Tool Calls</span>
            <strong className={countsLoading ? "metric-loading" : ""}>
              {countsLoading ? "..." : counts.tool_calls}
            </strong>
          </div>
          <div>
            <span>Artifacts</span>
            <strong className={countsLoading ? "metric-loading" : ""}>
              {countsLoading ? "..." : counts.artifacts}
            </strong>
          </div>
          <div>
            <span>Delegations</span>
            <strong className={countsLoading ? "metric-loading" : ""}>
              {countsLoading ? "..." : counts.delegations}
            </strong>
          </div>
        </div>

        {/* Actions */}
        <div className="sessions-inspector__actions">
          {isRunning && (
            <button type="button" onClick={handleStop} disabled={terminating}>
              <Icon name="stop" size={14} />
              {terminating ? "Stopping..." : "Stop"}
            </button>
          )}
          {!isRunning && (
            <button type="button" onClick={handleResume} disabled={resumeBusy}>
              <Icon name="play_arrow" size={14} />
              {resumeBusy ? "Resuming..." : "Resume"}
            </button>
          )}
          <button type="button" onClick={handleExport}>
            <Icon name="ios_share" size={14} />Export
          </button>
        </div>

        {/* Danger Zone */}
        {isRunning && (
          <div className="sessions-danger-zone">
            <div className="sessions-danger-zone__panel">
              <p><Icon name="warning" size={14} />Destructive Action</p>
              <span>Terminate and purge this session. This cannot be undone.</span>
            </div>
            <button
              className="sessions-danger-zone__button"
              type="button"
              onClick={async () => {
                if (!confirm(`Terminate session ${sessionId}? This cannot be undone.`)) return;
                setTerminating(true);
                await fetch("/api/mah/exec", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ args: ["sessions", "delete", sessionId] }),
                });
                onClose();
              }}
              disabled={terminating}
            >
              <Icon name="delete_forever" size={14} />
              {terminating ? "Terminating..." : "Terminate Session"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}