import { useState } from "react";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useSessionsData, type SessionInfo } from "./useSessionsData";

export function SessionsOverview() {
  const { sessions, loading, error } = useSessionsData();
  const [selected, setSelected] = useState<SessionInfo | null>(null);

  const formatTime = (iso?: string) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  };

  const toneMap: Record<string, "running" | "completed" | "failed"> = {
    running: "running", completed: "completed", failed: "failed",
    available: "completed", shutdown: "failed"
  };

  const selectedSession = selected;

  const runningCount = sessions.filter(s => s.status === "running").length;

  return (
    <>
      <main className="sessions-main">
        <section className="screen-header">
          <div>
            <h2>Active Sessions</h2>
            <div className="screen-header__meta">
              <span className="live-summary">
                <span className="live-summary__dot" aria-hidden="true" />
                {runningCount} running
              </span>
            </div>
          </div>
          <CommandPreview context="prod-cluster-1" command="mah sessions list" />
        </section>

        <section className="sessions-main__content" aria-label="Sessions table">
          {loading ? (
            <div className="loading-state">Loading sessions...</div>
          ) : error ? (
            <div className="loading-state">Error: {error}</div>
          ) : (
            <div className="sessions-table">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Selected session" />
                    <th>Session ID</th>
                    <th>Runtime / Crew</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(session => (
                    <tr
                      className={selected?.id === session.id ? "is-selected" : ""}
                      key={session.id}
                      onClick={() => setSelected(session)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <Icon
                          name={selected?.id === session.id ? "radio_button_checked" : "radio_button_unchecked"}
                          className={selected?.id === session.id ? "selection-icon selection-icon--active" : "selection-icon"}
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
                        <span>Update: {formatTime(session.updatedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <aside className="inspector" aria-label="Session lifecycle inspector">
        <section className="inspector__header">
          <div className="inspector__title-row">
            <div>
              <h3>Session Lifecycle</h3>
              <p>{selectedSession?.id || "—"}</p>
            </div>
          </div>
          <div className="inspector__actions">
            <button type="button"><Icon name="play_arrow" size={16} />Resume</button>
            <button type="button"><Icon name="ios_share" size={16} />Export</button>
          </div>
        </section>

        <section className="inspector__body">
          {selectedSession ? (
            <>
              <div className="inspector-stats">
                <div><span>Runtime</span><strong>{selectedSession.runtime}</strong></div>
                <div><span>Crew</span><strong>{selectedSession.crew}</strong></div>
                <div><span>Status</span><strong>{selectedSession.status}</strong></div>
                <div><span>Conv count</span><strong>{selectedSession.counts?.conversation ?? 0}</strong></div>
                <div><span>Tool calls</span><strong>{selectedSession.counts?.tool_calls ?? 0}</strong></div>
                <div><span>Artifacts</span><strong>{selectedSession.counts?.artifacts ?? 0}</strong></div>
                <div><span>Delegations</span><strong>{selectedSession.counts?.delegations ?? 0}</strong></div>
              </div>
              <div className="danger-zone" aria-label="Destructive action">
                <div className="danger-zone__panel">
                  <p><Icon name="warning" size={16} />Destructive Action</p>
                  <span>Terminate and purge this session. This action is irreversible.</span>
                </div>
                <button className="danger-zone__button" type="button">
                  <Icon name="delete_forever" size={18} />Terminate Session
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: "#94a3b8", fontSize: 13 }}>Select a session to view details.</p>
          )}
        </section>
      </aside>
    </>
  );
}
