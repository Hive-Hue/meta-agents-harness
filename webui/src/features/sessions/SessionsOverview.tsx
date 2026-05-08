import { useEffect, useState } from "react";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useSessionsData, type SessionInfo } from "./useSessionsData";
import { requestGlobalConsoleOpen } from "../console/consoleBridge";
import { getFeatureAiCliOptions } from "../settings/aiFeatureSettings";
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
                <option value="openclaude">openclaude</option>
                <option value="hermes">hermes</option>
                <option value="kilo">kilo</option>
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
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [proposalSummary, setProposalSummary] = useState("");
  const [proposalStability, setProposalStability] = useState("draft");
  const [proposalAgent, setProposalAgent] = useState("");
  const [proposalAiPowered, setProposalAiPowered] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [counts, setCounts] = useState(session.counts);
  const [countsLoading, setCountsLoading] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCounts(session.counts);
    setCountsLoading(true);
    (async () => {
      try {
        const resp = await fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: ["sessions", "counts", session.id] }),
        });
        const data = await resp.json();
        if (!data.ok || cancelled) return;
        const parsed = JSON.parse(data.stdout || "{}");
        if (!cancelled && parsed?.counts) {
          setCounts({
            conversation: Number(parsed.counts.conversation || 0),
            tool_calls: Number(parsed.counts.tool_calls || 0),
            artifacts: Number(parsed.counts.artifacts || 0),
            delegations: Number(parsed.counts.delegations || 0),
          });
        }
      } catch {
        // Keep optimistic defaults from session list on fetch failure.
      } finally {
        if (!cancelled) setCountsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.id, session.counts]);

  const handleResume = async () => {
    setResumeBusy(true);
    try {
      await requestGlobalConsoleOpen(session.runtime, session.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to open console";
      alert(`Error: ${message}`);
    } finally {
      setResumeBusy(false);
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
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#212121ff" }}>{session.id}</p>
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
          <div>
            <span>Conversations</span>
            <strong className={countsLoading ? "metric-loading" : ""}>{countsLoading ? "..." : counts.conversation}</strong>
          </div>
          <div>
            <span>Tool Calls</span>
            <strong className={countsLoading ? "metric-loading" : ""}>{countsLoading ? "..." : counts.tool_calls}</strong>
          </div>
          <div>
            <span>Artifacts</span>
            <strong className={countsLoading ? "metric-loading" : ""}>{countsLoading ? "..." : counts.artifacts}</strong>
          </div>
          <div>
            <span>Delegations</span>
            <strong className={countsLoading ? "metric-loading" : ""}>{countsLoading ? "..." : counts.delegations}</strong>
          </div>
        </div>
        <div className="sessions-inspector__actions">
          <button type="button" onClick={handleResume} disabled={resumeBusy}>
            <Icon name="play_arrow" size={14} />{resumeBusy ? "Opening..." : "Resume"}
          </button>
          <button type="button" onClick={handleExport}>
            <Icon name="ios_share" size={14} />Export
          </button>
          <button type="button" onClick={() => setShowProposalModal(true)}>
            <Icon name="add_circle" size={14} />Create Proposal
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
      {showProposalModal && (
        <div className="modal-overlay" onClick={() => setShowProposalModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Context Proposal</h3>
              <button type="button" className="icon-button" onClick={() => setShowProposalModal(false)}><Icon name="close" size={16} /></button>
            </div>
            <p style={{ fontSize: 12, color: "#666", margin: "0 0 16px" }}>Session: <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{session.runtime}:{session.crew}:{session.id}</code></p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#666" }}>Target Agent</span>
                <input type="text" value={proposalAgent} onChange={e => setProposalAgent(e.target.value)} placeholder="e.g. backend-dev" style={{ border: "1px solid var(--color-border-subtle)", borderRadius: 4, padding: "6px 8px", fontSize: 12 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#666" }}>Stability</span>
                <select value={proposalStability} onChange={e => setProposalStability(e.target.value)} style={{ border: "1px solid var(--color-border-subtle)", borderRadius: 4, padding: "6px 8px", fontSize: 12 }}>
                  <option value="draft">draft</option><option value="stable">stable</option><option value="curated">curated</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#666" }}>Summary</span>
                <input type="text" value={proposalSummary} onChange={e => setProposalSummary(e.target.value)} placeholder="Brief description" style={{ border: "1px solid var(--color-border-subtle)", borderRadius: 4, padding: "6px 8px", fontSize: 12 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#333" }}>
                <input type="checkbox" checked={proposalAiPowered} onChange={e => setProposalAiPowered(e.target.checked)} />
                AI-powered propose (Content Memory)
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button type="button" className="sessions-action-btn" onClick={() => setShowProposalModal(false)}>Cancel</button>
              <button type="button" className="sessions-action-btn sessions-action-btn--primary" disabled={!proposalAgent.trim() || !proposalSummary.trim() || creatingProposal} onClick={async () => {
                const sessionRef = session.id.includes(":")
                  ? session.id
                  : `${session.runtime}:${session.crew}:${session.id}`;
                setCreatingProposal(true);
                try {
                  const args = ["context", "propose", "--from-session", sessionRef, "--json"];
                  if (proposalAiPowered) {
                    args.push("--ai");
                    const { provider, model, baseUrl, endpoint } = getFeatureAiCliOptions("context");
                    if (provider) args.push("--provider", provider);
                    if (model) args.push("--model", model);
                    if (baseUrl) args.push("--base-url", baseUrl);
                    if (endpoint) args.push("--endpoint", endpoint);
                  }
                  const resp = await fetch("/api/mah/exec", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ args }),
                  });
                  const data = await resp.json();
                  if (data.ok) {
                    const stdout = `${data.stdout || ""}`;
                    let successMessage = "Context proposal created.\nReview it in /context -> Proposals tab.";
                    if (proposalAiPowered && stdout.includes("AI rewrite skipped")) {
                      const cmd = data.command ? `\nCommand: ${data.command}` : "";
                      successMessage = `Context proposal created with fallback (AI skipped).\n\n${stdout}${cmd}`;
                    }
                    setShowProposalModal(false);
                    setProposalSummary("");
                    setProposalAgent("");
                    alert(successMessage);
                  } else {
                    alert(`Error: ${data.stderr || data.error || "failed"}`);
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  alert(`Error creating context proposal: ${message}`);
                } finally {
                  setCreatingProposal(false);
                }
              }}><Icon name="check" size={14} />{creatingProposal ? "Creating..." : "Create Proposal"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
