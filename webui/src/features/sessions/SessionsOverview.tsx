import { useState } from "react";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useSessionsData, type SessionInfo } from "./useSessionsData";
import "./sessions.css";

function formatTime(iso?: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

function relativeTime(iso?: string) {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  } catch { return "—"; }
}

export function SessionsOverview() {
  const [runtime, setRuntime] = useState("pi");
  const { sessions, loading, error, reload } = useSessionsData(runtime);
  const [selected, setSelected] = useState<SessionInfo | null>(null);

  const toneMap: Record<string, "running" | "completed" | "failed"> = {
    running: "running", completed: "completed", failed: "failed",
    shutdown: "failed", available: "completed", done: "completed"
  };

  return (
    <>
      <main className="sessions-main">
        <section className="screen-header">
          <div>
            <h2>Sessions</h2>
            <div className="screen-header__meta">
              {!loading && (
                <>
                  <span className="live-summary">
                    <span className="live-summary__dot" aria-hidden="true" />
                    {sessions.filter(s => s.status === "running").length} running
                  </span>
                  <span className="screen-header__separator" />
                  <span>{sessions.length} total</span>
                </>
              )}
              <select
                value={runtime}
                onChange={e => setRuntime(e.target.value)}
                className="sessions-runtime-select"
                style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }}
              >
                <option value="pi">pi</option>
                <option value="claude">claude</option>
                <option value="opencode">opencode</option>
                <option value="hermes">hermes</option>
              </select>
              <button type="button" onClick={reload} title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
                <Icon name="refresh" size={16} />
              </button>
            </div>
          </div>
          <CommandPreview context="sessions" command="mah sessions list --json" />
        </section>

        <section className="sessions-main__content">
          {loading && <div className="loading-state">Loading sessions...</div>}
          {error && <div className="error-state">Error: {error}</div>}
          {!loading && !error && sessions.length === 0 && <div className="empty-state">No sessions found. Run a task first.</div>}
          {!loading && !error && sessions.length > 0 && (
            <div className="sessions-table">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Selected" />
                    <th>Session</th>
                    <th>Runtime / Crew</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(session => (
                    <tr
                      key={session.id}
                      className={selected?.id === session.id ? "is-selected" : ""}
                      onClick={() => setSelected(session)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <Icon
                          name={selected?.id === session.id ? "radio_button_checked" : "radio_button_unchecked"}
                          className="selection-icon"
                          size={18}
                          filled={selected?.id === session.id}
                        />
                      </td>
                      <td className="session-id">{session.id}</td>
                      <td>
                        <div className="runtime-cell">
                          <span>{session.runtime}</span>
                          <strong>{session.crew}</strong>
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={toneMap[session.status] || "failed"} label={session.status} />
                      </td>
                      <td className="time-cell">
                        <span>Start: {formatTime(session.createdAt)}</span>
                        <span>Update: {relativeTime(session.updatedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <aside className="inspector">
        {selected ? (
          <SessionInspector session={selected} onClose={() => setSelected(null)} />
        ) : (
          <section className="inspector__header">
            <h3>Session Inspector</h3>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>Select a session to view details</p>
          </section>
        )}
      </aside>
    </>
  );
}

function SessionInspector({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const [terminating, setTerminating] = useState(false);

  const handleResume = async () => {
    await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "resume", session.id] }),
    });
  };

  const handleExport = async () => {
    const resp = await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "export", session.id, "--json"] }),
    });
    const data = await resp.json();
    if (data.ok) {
      const blob = new Blob([data.stdout || "{}"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${session.id}.json`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleTerminate = async () => {
    if (!confirm(`Terminate session ${session.id}?`)) return;
    setTerminating(true);
    await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "delete", session.id] }),
    });
    setTerminating(false);
    onClose();
  };

  const toneMap: Record<string, "running" | "completed" | "failed"> = {
    running: "running", completed: "completed", failed: "failed",
    shutdown: "failed", available: "completed", done: "completed"
  };

  return (
    <>
      <section className="inspector__header">
        <div>
          <h3>Session Inspector</h3>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, margin: "4px 0 0" }}>{session.id}</p>
        </div>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
          <Icon name="close" size={16} />
        </button>
      </section>
      <section className="inspector__body">
        <dl className="inspector__fields">
          <div className="inspector__field"><dt>Status</dt><dd><StatusBadge tone={toneMap[session.status] || "failed"} label={session.status} /></dd></div>
          <div className="inspector__field"><dt>Runtime</dt><dd>{session.runtime}</dd></div>
          <div className="inspector__field"><dt>Crew</dt><dd>{session.crew}</dd></div>
          <div className="inspector__field"><dt>Conversations</dt><dd>{session.counts.conversation}</dd></div>
          <div className="inspector__field"><dt>Tool Calls</dt><dd>{session.counts.tool_calls}</dd></div>
          <div className="inspector__field"><dt>Artifacts</dt><dd>{session.counts.artifacts}</dd></div>
          <div className="inspector__field"><dt>Delegations</dt><dd>{session.counts.delegations}</dd></div>
        </dl>
        <div className="inspector__actions">
          <button className="inspector__action-btn inspector__action-btn--primary" type="button" onClick={handleResume}>
            <Icon name="play_arrow" size={14} />Resume
          </button>
          <button className="inspector__action-btn" type="button" onClick={handleExport}>
            <Icon name="ios_share" size={14} />Export
          </button>
        </div>
        <div className="danger-zone">
          <div className="danger-zone__panel">
            <p><Icon name="warning" size={14} />Destructive Action</p>
            <span>Terminate and purge this session. This cannot be undone.</span>
          </div>
          <button className="danger-zone__button" type="button" onClick={handleTerminate} disabled={terminating}>
            <Icon name="delete_forever" size={14} />{terminating ? "Terminating..." : "Terminate Session"}
          </button>
        </div>
      </section>
    </>
  );
}
