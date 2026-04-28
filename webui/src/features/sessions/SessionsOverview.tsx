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
              >
                <option value="pi">pi</option>
                <option value="claude">claude</option>
                <option value="opencode">opencode</option>
                <option value="hermes">hermes</option>
              </select>
              <button type="button" onClick={reload} title="Refresh" className="sessions-refresh-btn">
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

      <aside className="inspector sessions-inspector">
        {selected ? (
          <SessionInspector session={selected} onClose={() => setSelected(null)} />
        ) : (
          <section className="inspector__body sessions-inspector__empty">
            <Icon name="info" size={32} />
            <p>Select a session to view details</p>
          </section>
        )}
      </aside>
    </>
  );
}

function SessionInspector({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const [terminating, setTerminating] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);

  const handleResume = async () => {
    const resp = await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "resume", session.id] }),
    });
    const data = await resp.json();
    if (data.ok) {
      alert(`Session ${session.id} resumed in terminal.`);
    } else {
      alert(`Error: ${data.stderr}`);
    }
  };

  const handleExport = async () => {
    const resp = await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "export", session.id] }),
    });
    const data = await resp.json();
    if (data.ok) {
      const blob = new Blob([data.stdout || "{}"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${session.id}.json`; a.click();
      URL.revokeObjectURL(url);
    } else {
      alert(`Export failed: ${data.stderr}`);
    }
  };

  const handleCreateProposal = async () => {
    const sessionRef = `${session.runtime}:${session.crew}:${session.id}`;
    if (!confirm(`Create a context proposal from this session?\n\nSession: ${sessionRef}`)) return;
    setCreatingProposal(true);
    const resp = await fetch("/api/mah/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: ["context", "propose", "--from-session", sessionRef, "--json"] }) });
    const data = await resp.json();
    setCreatingProposal(false);
    if (data.ok) {
      alert("Context proposal created.\nReview it in /context → Proposals tab.");
    } else {
      alert(`Error: ${data.stderr || data.error || "failed"}`);
    }
  };

  const handleTerminate = async () => {
    if (!confirm(`Terminate session ${session.id}? This cannot be undone.`)) return;
    setTerminating(true);
    await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["sessions", "delete", session.id] }),
    });
    onClose();
  };

  const toneMap: Record<string, "running" | "completed" | "failed"> = {
    running: "running", completed: "completed", failed: "failed",
    shutdown: "failed", available: "completed", done: "completed"
  };

  return (
    <>
      <section className="inspector__header">
        <div className="inspector__title-row">
          <div>
            <h3>Session Inspector</h3>
            <p>{session.id}</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close inspector">
            <Icon name="close" size={16} />
          </button>
        </div>
      </section>
      <section className="inspector__body">
        <div className="inspector-stats">
          <div><span>Status</span><strong><StatusBadge tone={toneMap[session.status] || "failed"} label={session.status} /></strong></div>
          <div><span>Runtime</span><strong>{session.runtime}</strong></div>
          <div><span>Crew</span><strong>{session.crew}</strong></div>
          <div><span>Conversations</span><strong>{session.counts.conversation}</strong></div>
          <div><span>Tool Calls</span><strong>{session.counts.tool_calls}</strong></div>
          <div><span>Artifacts</span><strong>{session.counts.artifacts}</strong></div>
          <div><span>Delegations</span><strong>{session.counts.delegations}</strong></div>
        </div>
        <div className="sessions-inspector__actions">
          <button type="button" onClick={handleResume}>
            <Icon name="play_arrow" size={14} />Resume
          </button>
          <button type="button" onClick={handleExport}>
            <Icon name="ios_share" size={14} />Export
          </button>
          <button type="button" onClick={handleCreateProposal} disabled={creatingProposal}>
            <Icon name="add_circle" size={14} />{creatingProposal ? "Creating..." : "Create Proposal"}
          </button>
        </div>
        <div className="sessions-danger-zone">
          <div className="sessions-danger-zone__panel">
            <p><Icon name="warning" size={14} />Destructive Action</p>
            <span>Terminate and purge this session. This cannot be undone.</span>
          </div>
          <button className="sessions-danger-zone__button" type="button" onClick={handleTerminate} disabled={terminating}>
            <Icon name="delete_forever" size={14} />{terminating ? "Terminating..." : "Terminate Session"}
          </button>
        </div>
      </section>
    </>
  );
}
