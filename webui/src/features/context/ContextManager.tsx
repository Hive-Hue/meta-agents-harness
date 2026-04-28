import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { CommandPreview } from "../../components/ui/CommandPreview";
import {
  useContextDocuments,
  useContextFind,
  useContextValidate,
  useContextProposals,
  type ContextDoc,
  type ContextProposal,
} from "./useContextData";
import "./context.css";

type Tab = "documents" | "find" | "validate" | "proposals";
type ContextItemSource = "document" | "proposal";
type SelectedContextItem = { id: string; source: ContextItemSource; preview: ContextDoc };
type ItemDetails = {
  source: ContextItemSource;
  frontmatter?: Record<string, unknown>;
  proposal?: Record<string, unknown>;
  body?: string;
  filePath?: string;
  overlaps?: Array<{ type?: string; message?: string }>;
};

export function ContextManager() {
  const [tab, setTab] = useState<Tab>("documents");
  const [selectedItem, setSelectedItem] = useState<SelectedContextItem | null>(null);
  const [itemDetails, setItemDetails] = useState<ItemDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [findAgent, setFindAgent] = useState("");
  const [findTask, setFindTask] = useState("");
  const [findCap, setFindCap] = useState("");
  const [strictMode, setStrictMode] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const { docs, loading: docsLoading, error: docsError, reload: reloadDocs } = useContextDocuments();
  const { results: findResults, loading: findLoading, error: findError, find } = useContextFind();
  const { results: validateResults, loading: validateLoading, error: validateError, summary: validateSummary, validate } = useContextValidate();
  const { proposals, loading: proposalsLoading, error: proposalsError, reload: reloadProposals } = useContextProposals();
  const proposalToDoc = (p: ContextProposal): ContextDoc => ({
    id: p.id,
    kind: `proposal:${p.agent}`,
    stability: p.stability,
    priority: p.status,
    last_reviewed_at: p.source_session || "—",
  });

  useEffect(() => {
    let active = true;

    async function loadDetails() {
      if (!selectedItem) {
        setItemDetails(null);
        setDetailsError(null);
        return;
      }

      setDetailsLoading(true);
      setDetailsError(null);
      const args =
        selectedItem.source === "document"
          ? ["context", "show", selectedItem.id, "--json"]
          : ["context", "proposals", "show", selectedItem.id, "--json"];

      try {
        const resp = await fetch("/api/mah/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args }),
        });
        const payload = await resp.json();

        if (!active) return;
        if (!payload.ok) {
          setDetailsError(payload.stderr || payload.error || "Failed to load details");
          setItemDetails(null);
          return;
        }

        const parsed = payload.stdout ? JSON.parse(payload.stdout) : {};
        if (selectedItem.source === "document") {
          setItemDetails({
            source: "document",
            frontmatter: parsed.document?.frontmatter || {},
            body: parsed.document?.body || "",
            filePath: parsed.document?.file_path,
          });
        } else {
          setItemDetails({
            source: "proposal",
            proposal: parsed.proposal || {},
            body: parsed.body || "",
            filePath: parsed.file_path,
            overlaps: parsed.overlaps || [],
          });
        }
      } catch (err) {
        if (!active) return;
        setDetailsError(err instanceof Error ? err.message : String(err));
        setItemDetails(null);
      } finally {
        if (active) setDetailsLoading(false);
      }
    }

    loadDetails();
    return () => {
      active = false;
    };
  }, [selectedItem]);

  return (
    <div className="context-layout">
      <div className="context-main">
        <section className="screen-header context-screen-header">
          <div>
            <h2>Context Manager</h2>
            <div className="screen-header__meta">
              <span>{docs.length} docs</span>
              <span className="screen-header__separator" />
              <span>{proposals.length} proposals</span>
            </div>
          </div>
          <CommandPreview context="context" command="mah context docs list --json" />
        </section>

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
                <div style={{display:"flex",gap:8}}>
                  <button className="context-action-btn" onClick={async () => { setRebuilding(true); await fetch("/api/mah/exec",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({args:["context","index","--rebuild","--json"]})}); setRebuilding(false); reloadDocs(); }} disabled={rebuilding}>
                    <Icon name="sync" size={14} />{rebuilding ? "Rebuilding..." : "Rebuild Index"}
                  </button>
                  <button className="context-action-btn" onClick={reloadDocs}>
                    <Icon name="refresh" size={14} />Refresh
                  </button>
                </div>
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
                          className={selectedItem?.id === doc.id ? "is-selected" : ""}
                          onClick={() => setSelectedItem({ id: doc.id, source: "document", preview: doc })}
                        >
                          <td className="doc-name-cell">{doc.id}</td>
                          <td><span className="agent-chip">{doc.kind}</span></td>
                          <td>{doc.stability}</td>
                          <td>{doc.priority}</td>
                          <td className="context-cell-muted">{doc.last_reviewed_at}</td>
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

              {findError && <div className="error-state context-state-gap">{findError}</div>}

              {findResults.length > 0 && (
                <div className="context-table context-table--spaced">
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
                          <td className="context-cell-muted">{r.reason}</td>
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
                <div className="context-validate-actions">
                  <label className="context-strict-toggle">
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

              {validateError && <div className="error-state context-state-gap">{validateError}</div>}

              {validateResults.length > 0 && (
                <div className="context-table context-table--spaced-sm">
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
                          <td className="doc-name-cell context-mono-cell">{r.file}</td>
                          <td>{r.valid ? <span className="context-valid-icon"><Icon name="check" size={14} /></span> : <span className="context-invalid-icon"><Icon name="close" size={14} /></span>}</td>
                          <td className="context-error-cell">{r.errors?.join(", ") || "—"}</td>
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
                <div style={{display:"flex",gap:8}}>
                  <button className="context-action-btn context-action-btn--primary" onClick={() => setShowCreateProposal(v => !v)}>
                    <Icon name="add" size={14} />{showCreateProposal ? "Cancel" : "Create Proposal"}
                  </button>
                  <button className="context-action-btn" onClick={reloadProposals}>
                    <Icon name="refresh" size={14} />Refresh
                  </button>
                </div>
              </div>
              {showCreateProposal && (
                <div className="create-proposal-form" style={{background:"#fafafa",border:"1px solid #eee",borderRadius:8,padding:16,marginBottom:16}}>
                  <h4 style={{margin:"0 0 12px",fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",color:"#94a3b8"}}>New Proposal</h4>
                  <div className="find-form__row">
                    <label><span>Agent</span><input type="text" id="cp-agent" placeholder="e.g. backend-dev" style={{border:"1px solid #e0e0e0",borderRadius:4,padding:"6px 8px",fontSize:12,background:"#fff",width:"100%"}} /></label>
                    <label><span>Stability</span><select id="cp-stability" style={{border:"1px solid #e0e0e0",borderRadius:4,padding:"6px 8px",fontSize:12,background:"#fff",width:"100%"}}><option value="experimental">experimental</option><option value="stable">stable</option><option value="curated">curated</option></select></label>
                  </div>
                  <label className="find-form__full"><span>Summary</span><input type="text" id="cp-summary" placeholder="Brief description..." style={{border:"1px solid #e0e0e0",borderRadius:4,padding:"6px 8px",fontSize:12,background:"#fff",width:"100%"}} /></label>
                  <label className="find-form__full"><span>Rationale</span><input type="text" id="cp-rationale" placeholder="Why this proposal..." style={{border:"1px solid #e0e0e0",borderRadius:4,padding:"6px 8px",fontSize:12,background:"#fff",width:"100%"}} /></label>
                  <button className="context-action-btn context-action-btn--primary" style={{marginTop:8}} onClick={async () => {
                    const agent = (document.getElementById("cp-agent") as HTMLInputElement).value.trim();
                    const stability = (document.getElementById("cp-stability") as HTMLSelectElement).value;
                    const summary = (document.getElementById("cp-summary") as HTMLInputElement).value.trim();
                    const rationale = (document.getElementById("cp-rationale") as HTMLInputElement).value.trim();
                    if (!agent || !summary) { alert("Agent and summary required"); return; }
                    setCreatingProposal(true);
                    await fetch("/api/mah/exec",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({args:["context","proposals","create",agent,"--stability",stability,"--summary",summary,"--rationale",rationale,"--json"]})});
                    setCreatingProposal(false);
                    setShowCreateProposal(false);
                    reloadProposals();
                  }} disabled={creatingProposal}>
                    <Icon name="check" size={14} />{creatingProposal ? "Creating..." : "Create"}
                  </button>
                </div>
              )}
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
                        <tr
                          key={p.id}
                          className={selectedItem?.id === p.id ? "is-selected" : ""}
                          onClick={() => setSelectedItem({ id: p.id, source: "proposal", preview: proposalToDoc(p) })}
                        >
                          <td className="doc-name-cell context-mono-cell">{p.id}</td>
                          <td><span className="agent-chip">{p.agent}</span></td>
                          <td>{p.stability}</td>
                          <td><StatusBadge tone={p.status === "approved" || p.status === "promoted" ? "completed" : p.status === "rejected" ? "failed" : "running"} label={p.status} /></td>
                          <td className="context-summary-cell">{p.summary}</td>
                          <td>
                            {p.status === "pending" && (
                              <div className="context-proposal-actions">
                                <button className="context-action-btn context-action-btn--compact" onClick={async (e) => {
                                  e.stopPropagation();
                                  await fetch("/api/mah/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args: ["context", "proposals", "promote", p.id, "--json"] }) });
                                  reloadProposals();
                                }}>
                                  <Icon name="check" size={12} />Promote
                                </button>
                                <button className="context-action-btn context-action-btn--compact" onClick={async (e) => {
                                  e.stopPropagation();
                                  const reason = prompt("Rejection reason (optional):");
                                  const args = reason
                                    ? ["context","proposals","reject",p.id,"--reason",reason,"--json"]
                                    : ["context","proposals","reject",p.id,"--json"];
                                  await fetch("/api/mah/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({args}) });
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
      <aside className="inspector context-inspector">
        {selectedItem ? (
          <>
            <section className="inspector__header">
              <div className="inspector__title-row">
                <div>
                  <h3>Context Item</h3>
                  <p>{selectedItem.id}</p>
                </div>
                <button className="icon-button" onClick={() => setSelectedItem(null)}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            </section>
            <section className="inspector__body">
              <div className="inspector-stats context-inspector__stats">
                <div>
                  <span>Type</span>
                  <strong>{selectedItem.source === "document" ? "Document" : "Proposal"}</strong>
                </div>
                <div>
                  <span>Stability</span>
                  <strong>{String(itemDetails?.frontmatter?.stability || itemDetails?.proposal?.stability || selectedItem.preview.stability || "—")}</strong>
                </div>
                <div>
                  <span>Status/Priority</span>
                  <strong>{String(itemDetails?.proposal?.status || selectedItem.preview.priority || "—")}</strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>{String(itemDetails?.proposal?.source_ref || selectedItem.preview.last_reviewed_at || "—")}</strong>
                </div>
              </div>

              {detailsLoading && <p className="context-inspector__hint">Loading details…</p>}
              {detailsError && <p className="context-inspector__error">{detailsError}</p>}

              {!detailsLoading && !detailsError && itemDetails?.source === "proposal" && (
                <>
                  <div className="context-inspector__section">
                    <p className="inspector-section-label">Summary</p>
                    <p className="context-inspector__text">{String(itemDetails.proposal?.summary || "—")}</p>
                  </div>
                  <div className="context-inspector__section">
                    <p className="inspector-section-label">Rationale</p>
                    <p className="context-inspector__text">{String(itemDetails.proposal?.rationale || "—")}</p>
                  </div>
                  <div className="context-inspector__section">
                    <p className="inspector-section-label">Proposed Document</p>
                    <p className="context-inspector__mono">{String(itemDetails.proposal?.proposed_document_id || "—")}</p>
                  </div>
                  {Array.isArray(itemDetails.overlaps) && itemDetails.overlaps.length > 0 && (
                    <div className="context-inspector__section">
                      <p className="inspector-section-label">Overlap Warnings</p>
                      <ul className="context-inspector__list">
                        {itemDetails.overlaps.map((o, idx) => (
                          <li key={`${o.type || "overlap"}-${idx}`}>[{o.type || "overlap"}] {o.message || "Potential overlap"}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {!detailsLoading && !detailsError && itemDetails?.source === "document" && (
                <>
                  <div className="context-inspector__section">
                    <p className="inspector-section-label">Agent</p>
                    <p className="context-inspector__mono">{String(itemDetails.frontmatter?.agent || "—")}</p>
                  </div>
                  <div className="context-inspector__section">
                    <p className="inspector-section-label">Capabilities</p>
                    <p className="context-inspector__text">
                      {Array.isArray(itemDetails.frontmatter?.capabilities)
                        ? (itemDetails.frontmatter?.capabilities as string[]).join(", ")
                        : String(itemDetails.frontmatter?.capabilities || "—")}
                    </p>
                  </div>
                  <div className="context-inspector__section">
                    <p className="inspector-section-label">Body Preview</p>
                    <p className="context-inspector__text">
                      {itemDetails.body ? itemDetails.body.slice(0, 480) : "—"}
                    </p>
                  </div>
                </>
              )}

              {itemDetails?.source === "proposal" && selectedItem?.preview?.priority === "pending" && (
                <div className="context-inspector__actions">
                  <button className="context-action-btn context-action-btn--compact" style={{flex:1}} onClick={async () => { await fetch("/api/mah/exec",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({args:["context","proposals","promote",selectedItem.id,"--json"]})}); reloadProposals(); }}>
                    <Icon name="check" size={12} />Promote
                  </button>
                  <button className="context-action-btn context-action-btn--compact" style={{flex:1}} onClick={async () => { const reason = prompt("Rejection reason (optional):"); const args = reason ? ["context","proposals","reject",selectedItem.id,"--reason",reason,"--json"] : ["context","proposals","reject",selectedItem.id,"--json"]; await fetch("/api/mah/exec",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({args})}); reloadProposals(); }}>
                    <Icon name="close" size={12} />Reject
                  </button>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="inspector__body inspector-empty">
            <Icon name="info" size={32} />
            <p>Select a document or proposal</p>
          </div>
        )}
      </aside>
    </div>
  );
}
