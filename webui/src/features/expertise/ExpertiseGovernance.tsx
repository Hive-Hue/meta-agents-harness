import { useState, useEffect, useCallback } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { useExpertiseData, useExpertiseDetail, useEvidenceData, useProposals, type ExpertiseEntry, type ProposalInfo, type SyncChange } from "./useExpertiseData";
import "./expertise.css";

type WorkflowStep = "seed" | "sync" | "propose" | "review" | "apply";

const WORKFLOW_STEPS = [
  { id: "seed" as WorkflowStep, label: "1. Seed" },
  { id: "sync" as WorkflowStep, label: "2. Sync" },
  { id: "propose" as WorkflowStep, label: "3. Propose" },
  { id: "review" as WorkflowStep, label: "4. Review" },
  { id: "apply" as WorkflowStep, label: "5. Apply" },
];

function runMah(args: string[]) {
  return fetch("/api/mah/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ args }) }).then(r => r.json());
}

export function ExpertiseGovernance() {
  const [crew] = useState("dev");
  const [step, setStep] = useState<WorkflowStep>("seed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"catalog"|"evidence"|"proposals"|"lifecycle">("catalog");
  const [syncResults, setSyncResults] = useState<SyncChange[]>([]);
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [pLoading, setPLoading] = useState(false);
  const [pError, setPError] = useState<string|null>(null);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<string|null>(null);
  const [proposeAgent, setProposeAgent] = useState("");
  const [proposeLimit, setProposeLimit] = useState("5");
  const [proposeSummary, setProposeSummary] = useState("");
  const [proposeOutput, setProposeOutput] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const { entries, reload } = useExpertiseData(crew);

  const qualifying = entries.filter(e => (e.confidence?.evidence_count ?? 0) >= 5).map(e => e.id);
  const currentIdx = WORKFLOW_STEPS.findIndex(s => s.id === step);

  const handleSeed = async () => {
    setSyncLoading(true);
    const r = await runMah(["expertise", "seed", "--crew", crew, "--force"]);
    if (r.ok) await reload();
    setSyncLoading(false);
    if (r.ok) setStep("sync");
  };

  const handleSyncDryRun = async () => {
    setSyncLoading(true);
    const r = await runMah(["expertise", "sync", "--crew", crew, "--dry-run", "--json"]);
    if (r.ok) { try { setSyncResults(JSON.parse(r.stdout).results || []); } catch {} }
    setSyncLoading(false);
  };

  const handleSyncExec = async () => {
    setSyncLoading(true);
    const r = await runMah(["expertise", "sync", "--crew", crew, "--json"]);
    if (r.ok) { await reload(); setStep("propose"); }
    setSyncLoading(false);
  };

  const handleCreateProposal = async () => {
    if (!proposeAgent || !proposeSummary.trim()) { setCreateResult("Select agent + enter summary"); return; }
    setCreating(true);
    const safe = proposeAgent.replace(/[^a-zA-Z0-9_-]/g, "-");
    const out = proposeOutput || `.mah/expertise/proposals/proposal-${safe}.yaml`;
    const r = await runMah(["expertise", "propose", proposeAgent, "--from-evidence", "--evidence-limit", proposeLimit, "--summary", proposeSummary, "--output", out]);
    setCreateResult(r.ok ? `Written: ${out}` : `Error: ${r.stderr}`);
    setCreating(false);
    if (r.ok) setStep("review");
  };

  const handleApply = async (path: string) => {
    if (!confirm(`Apply ${path}?`)) return;
    await runMah(["expertise", "apply-proposal", path, "--json"]);
    await reload();
  };

  return (
    <>
      <main className="expertise-main">
        <section className="screen-header">
          <div>
            <h2>Expertise Governance</h2>
            <div className="screen-header__meta">
              <span>{entries.length} agents</span>
              <span className="screen-header__separator" />
              <span>{qualifying.length} qualify</span>
              <span className="screen-header__separator" />
              <span>{proposals.length} proposals</span>
            </div>
          </div>
          <CommandPreview context="expertise" command={`mah expertise list --crew ${crew}`} />
        </section>

        {/* Stepper */}
        <div className="workflow-stepper">
          {WORKFLOW_STEPS.map((s, i) => {
            const done = i < currentIdx, active = i === currentIdx, future = i > currentIdx;
            return (
              <div key={s.id} className={`workflow-step ${done?"workflow-step--done":""} ${active?"workflow-step--active":""} ${future?"workflow-step--future":""}`}>
                <button className="workflow-step__btn" disabled={future} onClick={() => {}}>
                  <span className="workflow-step__num">{done ? <Icon name="check" size={12} /> : i+1}</span>
                  <span className="workflow-step__label">{s.label}</span>
                </button>
                {i < WORKFLOW_STEPS.length - 1 && <span className="workflow-step__arrow">→</span>}
              </div>
            );
          })}
        </div>

        <div className="expertise-content">
          {/* STEP 1: Seed */}
          {step === "seed" && (
            <div className="workflow-panel">
              <div className="workflow-panel__icon"><Icon name="database" size={40} /></div>
              <h3>1. Seed Catalog</h3>
              <p>Populate expertise catalog from meta-agents.yaml.</p>
              <div className="workflow-panel__cmd"><code>mah expertise seed --crew {crew} --force</code></div>
              <button className="workflow-action-btn workflow-action-btn--primary" onClick={handleSeed} disabled={syncLoading}>
                <Icon name="database" size={14} />{syncLoading ? "Seeding..." : "Run Seed"}
              </button>
              <button className="workflow-skip-btn" onClick={() => setStep("sync")}>Skip →</button>
            </div>
          )}

          {/* STEP 2: Sync */}
          {step === "sync" && (
            <div className="workflow-panel">
              <div className="workflow-panel__icon"><Icon name="sync" size={40} /></div>
              <h3>2. Sync from Evidence</h3>
              <p>Dry-run shows changes. Execute to apply.</p>
              {!syncResults.length && !syncLoading && (
                <button className="workflow-action-btn workflow-action-btn--primary" onClick={handleSyncDryRun}>
                  <Icon name="search" size={14} />Preview (Dry-Run)
                </button>
              )}
              {syncLoading && <div className="loading-state">Running...</div>}
              {syncResults.length > 0 && !syncLoading && (
                <>
                  <p>{syncResults.filter(r => !r.skipped && r.changed).length} changed | {syncResults.filter(r => r.skipped).length} skipped</p>
                  <div className="sync-preview-table">
                    <table>
                      <thead><tr><th>Agent</th><th>Changes</th><th>Details</th></tr></thead>
                      <tbody>
                        {syncResults.map(r => (
                          <tr key={r.agent} className={r.skipped ? "row-skipped" : r.changed ? "row-changed" : ""}>
                            <td className="agent-name-cell">{r.agent}</td>
                            <td>
                              {r.skipped ? <span style={{color:"#94a3b8"}}>skipped</span> :
                               r.changed ? r.changes?.map(c => <span key={c.type} className={`change-tag change-tag--${c.type}`}>{c.type}</span>) :
                               <span style={{color:"#94a3b8"}}>no change</span>}
                            </td>
                            <td style={{fontSize:11,color:"#666"}}>
                              {r.changes?.map(c => c.type === "confidence" ? `${Math.round((c.from?.score||0)*100)}%→${Math.round((c.to?.score||0)*100)}% (${c.to?.invocations} inv)` : `+${c.added?.join(", ")}`).join(" | ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:16}}>
                    <button className="workflow-action-btn workflow-action-btn--primary" onClick={handleSyncExec}><Icon name="check" size={14} />Execute Sync</button>
                    <button className="workflow-action-btn" onClick={handleSyncDryRun}><Icon name="refresh" size={14} />Refresh</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: Propose */}
          {step === "propose" && (
            <div className="workflow-panel">
              <div className="workflow-panel__icon"><Icon name="description" size={40} /></div>
              <h3>3. Generate Proposals</h3>
              <p>Create governance proposals for agents with ≥5 evidence events.</p>
              {qualifying.length > 0 && (
                <div className="qualifying-list">
                  <p style={{fontSize:11,color:"#94a3b8",marginBottom:8}}>Qualifying ({qualifying.length}):</p>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {qualifying.map(id => (
                      <span key={id} className="agent-qualifies-chip">
                        <Icon name="check_circle" size={12} />{id.includes(":")?id.split(":")[1]:id}
                        <span style={{color:"#94a3b8",fontSize:10}}>({entries.find(e=>e.id===id)?.confidence?.evidence_count} ev)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="propose-form">
                <h4>Create Proposal</h4>
                <div className="propose-form__row">
                  <label><span>Agent</span>
                    <select value={proposeAgent} onChange={e=>setProposeAgent(e.target.value)}>
                      <option value="">Select...</option>
                      {qualifying.map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                  </label>
                  <label><span>Evidence Limit</span>
                    <input type="number" min="1" max="50" value={proposeLimit} onChange={e=>setProposeLimit(e.target.value)} style={{width:80}} />
                  </label>
                </div>
                <label className="propose-form__full"><span>Summary</span>
                  <input type="text" placeholder="Evidence-backed update..." value={proposeSummary} onChange={e=>setProposeSummary(e.target.value)} />
                </label>
                <label className="propose-form__full"><span>Output Path</span>
                  <input type="text" value={proposeOutput || `.mah/expertise/proposals/proposal-<agent>.yaml`} onChange={e=>setProposeOutput(e.target.value)} style={{fontFamily:"var(--font-mono)",fontSize:12}} />
                </label>
                <button className="workflow-action-btn workflow-action-btn--primary" onClick={handleCreateProposal} disabled={creating || !proposeAgent || !proposeSummary.trim()}>
                  <Icon name="description" size={14} />{creating ? "Generating..." : "Generate"}
                </button>
                {createResult && <div className={`propose-result ${createResult.startsWith("Written")?"propose-result--ok":"propose-result--error"}`}>{createResult}</div>}
              </div>
            </div>
          )}

          {/* STEP 4: Review */}
          {step === "review" && (
            <div className="workflow-panel">
              <div className="workflow-panel__icon"><Icon name="rate_review" size={40} /></div>
              <h3>4. Human Review</h3>
              <p>Review proposals. Check rationale and proposed changes.</p>
              {proposals.length === 0 ? <div className="empty-state">No proposals.</div> : (
                <div className="review-list">
                  {proposals.map(p => (
                    <div key={p.id} className="review-item">
                      <div className="review-item__header">
                        <strong>{p.target_expertise_id}</strong>
                        <StatusBadge tone={p.status==="approved"?"completed":p.status==="rejected"?"failed":"running"} label={p.status} />
                      </div>
                      <p style={{fontSize:12,margin:"6px 0"}}>{p.summary}</p>
                      {p.status !== "applied" && (
                        <button className="workflow-action-btn" style={{padding:"4px 10px",fontSize:11}} onClick={() => handleApply(`.mah/expertise/proposals/${p.id}`)}>
                          <Icon name="check" size={12} />Apply
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button className="workflow-action-btn" onClick={() => setStep("apply")}><Icon name="arrow_forward" size={14} />Proceed</button>
            </div>
          )}

          {/* STEP 5: Apply */}
          {step === "apply" && (
            <div className="workflow-panel">
              <div className="workflow-panel__icon"><Icon name="verified" size={40} /></div>
              <h3>5. Apply Proposals</h3>
              <p>Apply approved proposals. Registry rebuilt automatically.</p>
              {proposals.filter(p=>p.status!=="applied").length === 0 ? <div className="empty-state">All applied.</div> : (
                <div className="apply-list">
                  {proposals.filter(p=>p.status!=="applied").map(p => (
                    <div key={p.id} className="apply-item">
                      <strong>{p.target_expertise_id}</strong>
                      <button className="workflow-action-btn" onClick={() => handleApply(`.mah/expertise/proposals/${p.id}`)}><Icon name="check" size={14} />Apply</button>
                    </div>
                  ))}
                </div>
              )}
              <button className="workflow-action-btn" onClick={() => { setStep("seed"); setSyncResults([]); }}><Icon name="replay" size={14} />New Cycle</button>
            </div>
          )}

          {/* Tabs */}
          {step !== "seed" && (
            <div className="expertise-tabs-inline">
              {(["catalog","evidence","proposals","lifecycle"] as const).map(t => (
                <button key={t} className={`expertise-tab expertise-tab--inline ${tab===t?"expertise-tab--active":""}`} onClick={()=>setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
              ))}
            </div>
          )}

          {tab === "catalog" && <CatalogTab entries={entries} selectedId={selectedId} onSelect={setSelectedId} qualifying={qualifying} syncResults={syncResults} />}
          {tab === "evidence" && <EvidenceTab entries={entries} selectedId={selectedId} onSelect={setSelectedId} />}
          {tab === "proposals" && <ProposalsTab proposals={proposals} onApply={handleApply} />}
          {tab === "lifecycle" && <LifecycleTab entries={entries} selectedId={selectedId} onSelect={setSelectedId} />}
        </div>
      </main>
      <aside className="inspector">
        <ExpertiseInspector entry={entries.find(e=>e.id===selectedId)||null} onClose={()=>setSelectedId(null)} />
      </aside>
    </>
  );
}

function CatalogTab({ entries, selectedId, onSelect, qualifying, syncResults }: { entries: ExpertiseEntry[]; selectedId: string|null; onSelect: (id:string)=>void; qualifying: string[]; syncResults: SyncChange[] }) {
  const syncMap = Object.fromEntries(syncResults.map(r=>[r.agent,r]));

  // Group entries by crew prefix
  const groups: Record<string, ExpertiseEntry[]> = {};
  for (const e of entries) {
    const parts = e.id.includes(":") ? e.id.split(":") : ["", e.id];
    const crew = parts[0] || "default";
    if (!groups[crew]) groups[crew] = [];
    groups[crew].push(e);
  }

  return (
    <div className="expertise-table">
      <table>
        <thead><tr><th aria-label="Selected"/><th>Agent</th><th>Confidence</th><th>Band</th><th>Lifecycle</th><th>Evidence</th><th>Qualifies</th><th>Sync</th></tr></thead>
        <tbody>
          {Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).map(([crew, crewEntries]) => [
            <tr key={`header-${crew}`} className="crew-group-header">
              <td colSpan={8}>
                <div className="crew-group-label">
                  <Icon name="group" size={14} />
                  {crew}
                  <span className="crew-group-count">{crewEntries.length} agent{crewEntries.length !== 1 ? "s" : ""}</span>
                </div>
              </td>
            </tr>,
            ...crewEntries.map(e => {
              const sync = syncMap[e.id];
              return (
                <tr key={e.id} className={selectedId===e.id?"is-selected":""} onClick={()=>onSelect(e.id)}>
                  <td><Icon name={selectedId===e.id?"radio_button_checked":"radio_button_unchecked"} size={18} filled={selectedId===e.id}/></td>
                  <td className="agent-name-cell">{e.id.includes(":")?e.id.split(":")[1]:e.id}</td>
                  <td><div style={{display:"flex",alignItems:"center",gap:8,minWidth:80}}><div style={{flex:1,height:4,background:"#eee",borderRadius:2}}><div style={{width:`${Math.round((e.confidence?.score||0)*100)}%`,height:"100%",background:"#0a0a0a",borderRadius:2}}/></div><span style={{fontSize:11,fontFamily:"var(--font-mono)",minWidth:32}}>{Math.round((e.confidence?.score||0)*100)}%</span></div></td>
                  <td><span style={{fontSize:12}}>{e.confidence?.band?.charAt(0).toUpperCase()+e.confidence?.band?.slice(1)||"—"}</span></td>
                  <td><StatusBadge tone={e.lifecycle==="active"?"completed":e.lifecycle==="experimental"?"running":e.lifecycle==="restricted"?"running":"failed"} label={e.lifecycle||"experimental"}/></td>
                  <td><span style={{fontFamily:"var(--font-mono)",fontSize:12}}>{e.confidence?.evidence_count??0}</span></td>
                  <td>{qualifying.includes(e.id)?<span className="qualifies-badge qualifies-badge--yes"><Icon name="check_circle" size={12}/>qualifies</span>:<span className="qualifies-badge qualifies-badge--no">—</span>}</td>
                  <td>{sync?.changed?<div style={{display:"flex",gap:3}}>{sync.changes?.map(c=><span key={c.type} className={`change-tag change-tag--${c.type}`}>{c.type}</span>)}</div>:<span style={{fontSize:11,color:"#94a3b8"}}>—</span>}</td>
                </tr>
              );
            })
          ])}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceTab({ entries, selectedId, onSelect }: { entries: ExpertiseEntry[]; selectedId: string|null; onSelect: (id:string)=>void }) {
  const [activeId, setActiveId] = useState<string|null>(selectedId);
  const { events, loading, error } = useEvidenceData(activeId||"");
  useEffect(()=>{ if(selectedId) setActiveId(selectedId); },[selectedId]);
  return (
    <div className="evidence-tab">
      <div className="evidence-agent-list"><p style={{fontSize:11,color:"#94a3b8",padding:"8px 12px",margin:0}}>Select agent</p>
        {entries.map(e=><button key={e.id} className={`evidence-agent-btn ${activeId===e.id?"is-active":""}`} onClick={()=>setActiveId(e.id)}>{e.id.includes(":")?e.id.split(":")[1]:e.id}<span style={{fontSize:10,color:"#94a3b8"}}>({e.confidence?.evidence_count??0})</span></button>)}
      </div>
      <div className="evidence-events">
        {!activeId&&<div className="empty-state">Select agent.</div>}
        {activeId&&loading&&<div className="loading-state">Loading...</div>}
        {activeId&&error&&<div className="error-state">{error}</div>}
        {activeId&&!loading&&!error&&events.length===0&&<div className="empty-state">No events.</div>}
        {activeId&&!loading&&!error&&events.length>0&&events.map((ev,i)=>(
          <div key={i} className="event-item">
            <span className={`timeline__marker ${ev.outcome==="success"?"timeline__marker--active":""}`}/>
            <div className="event-content">
              <div className="event-header">
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",color:ev.outcome==="success"?"#4caf50":ev.outcome==="failure"?"#dc2626":"#ffc107"}}>{ev.outcome}</span>
                <span style={{fontSize:11,color:"#666"}}>{ev.recorded_at?new Date(ev.recorded_at).toLocaleTimeString():"—"}</span>
              </div>
              <p style={{fontSize:12,margin:"4px 0"}}>{ev.task_description||ev.task_type||"—"}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProposalsTab({ proposals, onApply }: { proposals: ProposalInfo[]; onApply: (path:string)=>void }) {
  return (
    <div className="expertise-table">
      <table>
        <thead><tr><th>Target</th><th>Summary</th><th>By</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {proposals.map(p=>(
            <tr key={p.id}>
              <td className="agent-name-cell">{p.target_expertise_id}</td>
              <td style={{fontSize:12,maxWidth:180}}>{p.summary}</td>
              <td style={{fontSize:11}}>{p.generated_by?.actor}</td>
              <td><StatusBadge tone={p.status==="approved"?"completed":p.status==="rejected"?"failed":"running"} label={p.status}/></td>
              <td>{p.status!=="applied"&&<button className="workflow-action-btn" style={{padding:"4px 10px",fontSize:11}} onClick={()=>onApply(`.mah/expertise/proposals/${p.id}`)}><Icon name="check" size={12}/>Apply</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LifecycleTab({ entries, selectedId, onSelect }: { entries: ExpertiseEntry[]; selectedId: string|null; onSelect: (id:string)=>void }) {
  const [sel, setSel] = useState<string|null>(selectedId);
  useEffect(()=>{ if(selectedId) setSel(selectedId); },[selectedId]);
  const trans: Record<string,string[]> = { experimental:["active"], active:["restricted","experimental"], restricted:["active","revoked"], revoked:[] };
  const current = entries.find(e=>e.id===sel);
  return (
    <div className="lifecycle-tab">
      <div className="lifecycle-agent-list">{entries.map(e=><button key={e.id} className={`evidence-agent-btn ${sel===e.id?"is-active":""}`} onClick={()=>setSel(e.id)}>{e.id.includes(":")?e.id.split(":")[1]:e.id}</button>)}</div>
      <div className="lifecycle-panel">
        {!current&&<div className="empty-state">Select agent.</div>}
        {current&&(
          <>
            <div className="lifecycle-current">
              <StatusBadge tone={current.lifecycle==="active"?"completed":current.lifecycle==="experimental"?"running":current.lifecycle==="restricted"?"running":"failed"} label={current.lifecycle||"experimental"}/>
              <span style={{fontSize:13,marginLeft:12}}>{current.id}</span>
            </div>
            <div className="lifecycle-transitions">
              {(trans[current.lifecycle||"experimental"]||[]).map(s=>(
                <button key={s} className="lifecycle-transition-btn" onClick={async()=>{ if(!confirm(`Transition ${current.id}→${s}?`))return; await runMah(["expertise","lifecycle",current.id,"--to",s,"--json"]); }}>
                  <Icon name="arrow_forward" size={12}/>{s}
                </button>
              ))}
            </div>
            <div style={{marginTop:16}}>
              <div className="inspector-stats" style={{gridTemplateColumns:"1fr 1fr"}}>
                <div><span>Confidence</span><strong>{Math.round((current.confidence?.score||0)*100)}%</strong></div>
                <div><span>Evidence</span><strong>{current.confidence?.evidence_count??0}</strong></div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExpertiseInspector({ entry, onClose }: { entry: ExpertiseEntry|null; onClose: ()=>void }) {
  const { metrics } = useExpertiseDetail(entry?.id||"");
  const { events } = useEvidenceData(entry?.id||"", 10);
  if (!entry) return <section className="inspector__body" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12}}><Icon name="info" size={32}/><p style={{color:"var(--color-text-muted)",fontSize:13}}>Select agent</p></section>;
  return (
    <>
      <section className="inspector__header">
        <div className="inspector__title-row"><div><h3>Expertise Detail</h3><p>{entry.id}</p></div><button type="button" onClick={onClose} className="icon-button"><Icon name="close" size={16}/></button></div>
      </section>
      <section className="inspector__body">
        <div className="inspector-stats">
          <div><span>Lifecycle</span><strong><StatusBadge tone={entry.lifecycle==="active"?"completed":entry.lifecycle==="experimental"?"running":"failed"} label={entry.lifecycle||"experimental"}/></strong></div>
          <div><span>Evidence</span><strong>{entry.confidence?.evidence_count??0}</strong></div>
          <div><span>Trust Tier</span><strong>{entry.trust_tier||"internal"}</strong></div>
          {metrics&&<><div><span>Invocations</span><strong>{metrics.total_invocations}</strong></div><div><span>Success Rate</span><strong>{Math.round(metrics.review_pass_rate*100)}%</strong></div></>}
        </div>
        {entry.capabilities?.length>0&&<div style={{marginTop:16}}><p style={{fontSize:11,fontWeight:800,textTransform:"uppercase",color:"#94a3b8",marginBottom:6}}>Capabilities</p><div className="cap-chips">{entry.capabilities.map(c=><span className="cap-chip" key={c}>{c}</span>)}</div></div>}
        {events.length>0&&<div style={{marginTop:16}}><p style={{fontSize:11,fontWeight:800,textTransform:"uppercase",color:"#94a3b8",marginBottom:8}}>Recent Evidence</p>
          {events.slice(0,5).map((ev,i)=><div key={i} style={{marginBottom:12}}><strong style={{fontSize:11,color:ev.outcome==="success"?"#4caf50":"#94a3b8"}}>{ev.outcome}</strong><p style={{fontSize:11,margin:0}}>{ev.task_description?.slice(0,60)}</p></div>)}
        </div>}
      </section>
    </>
  );
}
