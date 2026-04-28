import { useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import {
  useContextDocuments,
  useContextFind,
  useContextValidate,
  useContextProposals,
  type ContextDoc,
  type FindResult,
  type ContextProposal,
} from "./useContextData";
import "./context.css";

type Tab = "documents" | "find" | "validate" | "proposals";

export function ContextManager() {
  const [tab, setTab] = useState<Tab>("documents");
  const [selectedDoc, setSelectedDoc] = useState<ContextDoc | null>(null);
  const [findAgent, setFindAgent] = useState("");
  const [findTask, setFindTask] = useState("");
  const [findCap, setFindCap] = useState("");
  const [strictMode, setStrictMode] = useState(false);

  const { docs, loading: docsLoading, error: docsError, reload: reloadDocs } = useContextDocuments();
  const { results: findResults, loading: findLoading, error: findError, find } = useContextFind();
  const { results: validateResults, loading: validateLoading, error: validateError, summary: validateSummary, validate } = useContextValidate();
  const { proposals, loading: proposalsLoading, error: proposalsError, reload: reloadProposals } = useContextProposals();

  return (
    <div className="context-layout">
      <div className="context-main">
        {/* Toolbar */}
        <div className="context-toolbar">
          <div className="context-tabs">
            {(["documents", "find", "validate", "proposals"] as Tab[]).map(t => (
              <button
                key={t}
                className={`context-tab ${tab === t ? "context-tab--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="context-content">
          {/* DOCUMENTS TAB */}
          {tab === "documents" && (
            <div className="context-panel">
              <div className="context-panel__header">
                <h3>Documents</h3>
                <button className="context-action-btn" onClick={reloadDocs}>
                  <Icon name="refresh" size={14} />Refresh
                </button>
              </div>
              {docsLoading ? (
                <div className="loading-state">Loading...</div>
              ) : docsError ? (
                <div className="error-state">{docsError}</div>
              ) : docs.length === 0 ? (
                <div className="empty-state">No documents found.</div>
              ) : (
                <div className="context-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Kind</th>
                        <th>Stability</th>
                        <th>Priority</th>
                        <th>Last Reviewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map(doc => (
                        <tr
                          key={doc.id}
                          className={selectedDoc?.id === doc.id ? "is-selected" : ""}
                          onClick={() => setSelectedDoc(doc)}
                        >
                          <td className="doc-name-cell">{doc.id}</td>
                          <td><span className="agent-chip">{doc.kind}</span></td>
                          <td>{doc.stability}</td>
                          <td>{doc.priority}</td>
                          <td style={{fontSize:12,color:"#666"}}>{doc.last_reviewed_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* FIND TAB */}
          {tab === "find" && (
            <div className="context-panel">
              <div className="context-panel__header">
                <h3>Find Context</h3>
              </div>
              <div className="find-form">
                <div className="find-form__row">
                  <label>
                    <span>Agent</span>
                    <input
                      type="text"
                      placeholder="e.g. backend-dev"
                      value={findAgent}
                      onChange={e => setFindAgent(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Capability (optional)</span>
                    <input
                      type="text"
                      placeholder="e.g. typescript"
                      value={findCap}
                      onChange={e => setFindCap(e.target.value)}
                    />
                  </label>
                </div>
                <label className="find-form__full">
                  <span>Task</span>
                  <input
                    type="text"
                    placeholder="Describe the task..."
                    value={findTask}
                    onChange={e => setFindTask(e.target.value)}
                  />
                </label>
                <button
                  className="context-action-btn context-action-btn--primary"
                  onClick={() => find(findAgent, findTask, findCap || undefined)}
                  disabled={findLoading || !findAgent.trim() || !findTask.trim()}
                >
                  <Icon name="search" size={14} />{findLoading ? "Searching..." : "Find"}
                </button>
              </div>

              {findError && <div className="error-state" style={{ marginTop: 12 }}>{findError}</div>}

              {findResults.length > 0 && (
                <div className="context-table" style={{ marginTop: 20 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Score</th>
                        <th>Matched On</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findResults.map((r, i) => (
                        <tr key={i}>
                          <td className="doc-name-cell">{r.doc_id}</td>
                          <td><span className="score-badge">{Math.round(r.score * 100)}%</span></td>
                          <td>{r.matched_on.map(m => <span key={m} className="cap-chip">{m}</span>)}</td>
                          <td style={{ fontSize: 12, color: "#666" }}>{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* VALIDATE TAB */}
          {tab === "validate" && (
            <div className="context-panel">
              <div className="context-panel__header">
                <h3>Validate Schema</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={strictMode} onChange={e => setStrictMode(e.target.checked)} />
                    Strict
                  </label>
                  <button className="context-action-btn context-action-btn--primary" onClick={() => validate(strictMode)} disabled={validateLoading}>
                    <Icon name="check" size={14} />{validateLoading ? "Validating..." : "Validate"}
                  </button>
                </div>
              </div>

              {validateSummary && (
                <div className="validate-summary">
                  <div className="validate-card validate-card--total">
                    <span className="validate-card__num">{validateSummary.total}</span>
                    <span className="validate-card__label">Total</span>
                  </div>
                  <div className="validate-card validate-card--valid">
                    <span className="validate-card__num">{validateSummary.valid}</span>
                    <span className="validate-card__label">Valid</span>
                  </div>
                  <div className="validate-card validate-card--invalid">
                    <span className="validate-card__num">{validateSummary.invalid}</span>
                    <span className="validate-card__label">Invalid</span>
                  </div>
                </div>
              )}

              {validateError && <div className="error-state" style={{ marginTop: 12 }}>{validateError}</div>}

              {validateResults.length > 0 && (
                <div className="context-table" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Valid</th>
                        <th>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validateResults.map((r, i) => (
                        <tr key={i} className={r.valid ? "" : "row-invalid"}>
                          <td className="doc-name-cell" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{r.file}</td>
                          <td>{r.valid ? <span style={{color:"#4caf50"}}><Icon name="check" size={14} /></span> : <span style={{color:"#dc2626"}}><Icon name="close" size={14} /></span>}</td>
                          <td style={{ fontSize: 11, color: "#dc2626" }}>{r.errors?.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* PROPOSALS TAB */}
          {tab === "proposals" && (
            <div className="context-panel">
              <div className="context-panel__header">
                <h3>Proposals</h3>
                <button className="context-action-btn" onClick={reloadProposals}>
                  <Icon name="refresh" size={14} />Refresh
                </button>
              </div>
              {proposalsLoading ? (
                <div className="loading-state">Loading...</div>
              ) : proposalsError ? (
                <div className="error-state">{proposalsError}</div>
              ) : proposals.length === 0 ? (
                <div className="empty-state">No proposals.</div>
              ) : (
                <div className="context-table">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Agent</th>
                        <th>Stability</th>
                        <th>Status</th>
                        <th>Summary</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposals.map(p => (
                        <tr key={p.id}>
                          <td className="doc-name-cell" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{p.id}</td>
                          <td><span className="agent-chip">{p.agent}</span></td>
                          <td>{p.stability}</td>
                          <td><StatusBadge tone={p.status === "approved" || p.status === "promoted" ? "completed" : p.status === "rejected" ? "failed" : "running"} label={p.status} /></td>
                          <td style={{ fontSize: 12, maxWidth: 200 }}>{p.summary}</td>
                          <td>
                            {p.status === "pending" && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="context-action-btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={async () => {
                                  await fetch("/api/mah/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: ["context", "proposals", "promote", p.id, "--json"] }) });
                                  reloadProposals();
                                }}>
                                  <Icon name="check" size={12} />Promote
                                </button>
                                <button className="context-action-btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={async () => {
                                  await fetch("/api/mah/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: ["context", "proposals", "reject", p.id, "--json"] }) });
                                  reloadProposals();
                                }}>
                                  <Icon name="close" size={12} />Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Inspector */}
      <aside className="context-inspector">
        {selectedDoc ? (
          <>
            <div className="inspector-header">
              <h3>{selectedDoc.id}</h3>
              <button className="icon-button" onClick={() => setSelectedDoc(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="inspector-stats">
              <div><span>Kind</span><strong>{selectedDoc.kind}</strong></div>
              <div><span>Stability</span><strong>{selectedDoc.stability}</strong></div>
              <div><span>Priority</span><strong>{selectedDoc.priority}</strong></div>
              <div><span>Last Reviewed</span><strong>{selectedDoc.last_reviewed_at}</strong></div>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <Icon name="info" size={32} />
            <p>Select a document</p>
          </div>
        )}
      </aside>
    </div>
  );
}
