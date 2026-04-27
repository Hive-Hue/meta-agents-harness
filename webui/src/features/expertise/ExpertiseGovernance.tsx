import { useState, useEffect } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { CommandPreview } from "../../components/ui/CommandPreview";
import {
  useExpertiseData, useExpertiseDetail, useEvidenceData,
  useSyncDryRun, useProposals,
  type ExpertiseEntry, type EvidenceEvent, type ProposalInfo
} from "./useExpertiseData";
import "./expertise.css";

type Tab = "catalog" | "evidence" | "proposals" | "lifecycle";

function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  const map: Record<string, string> = {
    experimental: "Experimental", active: "Active", restricted: "Restricted", revoked: "Revoked"
  };
  const toneMap: Record<string, "running" | "completed" | "failed"> = {
    experimental: "running", active: "completed", restricted: "running", revoked: "failed"
  };
  return <StatusBadge tone={toneMap[lifecycle] || "running"} label={map[lifecycle] || lifecycle} />;
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round((score || 0) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "#eee", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#0a0a0a", borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

function relativeTime(iso?: string) {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch { return "—"; }
}

function formatBand(band?: string) {
  if (!band) return "—";
  return band.charAt(0).toUpperCase() + band.slice(1);
}

export function ExpertiseGovernance() {
  const [crew, setCrew] = useState("dev");
  const [tab, setTab] = useState<Tab>("catalog");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { entries, loading, error, reload } = useExpertiseData(crew);
  const { proposals, loading: proposalsLoading } = useProposals();
  const { changes: syncChanges, loading: syncLoading, runSync } = useSyncDryRun(crew);
  const [syncRan, setSyncRan] = useState(false);

  const filtered = entries.filter(e =>
    !search || e.id.toLowerCase().includes(search.toLowerCase()) ||
    e.capabilities?.some(c => c.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSeed = async () => {
    await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["expertise", "seed", "--crew", crew, "--force"] }),
    });
    reload();
  };

  const handleSync = async () => {
    await runSync(false);
    setSyncRan(true);
  };

  return (
    <>
      <main className="expertise-main">
        <section className="screen-header">
          <div>
            <h2>Expertise Governance</h2>
            <div className="screen-header__meta">
              <span className="live-summary">
                <span className="live-summary__dot" aria-hidden="true" />
                {entries.length} agents catalogued
              </span>
              <span className="screen-header__separator" />
              <span>{proposals.length} proposals</span>
            </div>
          </div>
          <CommandPreview context="expertise" command={`mah expertise list --crew ${crew}`} />
        </section>

        <div className="expertise-toolbar">
          <div className="expertise-tabs">
            {(["catalog", "evidence", "proposals", "lifecycle"] as Tab[]).map(t => (
              <button
                key={t}
                className={`expertise-tab ${tab === t ? "expertise-tab--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === "proposals" && proposals.length > 0 && (
                  <span className="tab-badge">{proposals.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="expertise-toolbar__actions">
            <select
              value={crew}
              onChange={e => { setCrew(e.target.value); setSelectedId(null); }}
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 13 }}
            >
              <option value="dev">dev</option>
            </select>
            <button type="button" onClick={reload} title="Refresh">
              <Icon name="refresh" size={14} />
            </button>
            <button type="button" onClick={handleSeed} title="Seed from meta-agents.yaml">
              <Icon name="database" size={14} />Seed
            </button>
            <button type="button" onClick={handleSync} title="Sync from evidence" disabled={syncLoading}>
              <Icon name="sync" size={14} />{syncLoading ? "Syncing..." : "Sync"}
            </button>
          </div>
        </div>

        {tab === "catalog" && (
          <div className="expertise-search">
            <Icon name="search" size={14} />
            <input
              type="text"
              placeholder="Search agents or capabilities..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ border: "none", outline: "none", flex: 1, fontSize: 13 }}
            />
          </div>
        )}

        {syncRan && syncChanges.length > 0 && !syncLoading && (
          <div className="sync-preview-banner">
            <strong>Sync preview:</strong> {syncChanges.filter(c => !c.skipped && c.changed).length} changes pending
            <button type="button" onClick={() => runSync(true)} style={{ marginLeft: 12 }}>
              Apply Changes
            </button>
            <button type="button" onClick={() => setSyncRan(false)} style={{ marginLeft: 4 }}>
              Dismiss
            </button>
          </div>
        )}

        <section className="expertise-main__content">
          {tab === "catalog" && (
            <CatalogTab entries={filtered} loading={loading} error={error} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          {tab === "evidence" && (
            <EvidenceTab entries={entries} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          {tab === "proposals" && (
            <ProposalsTab proposals={proposals} loading={proposalsLoading} />
          )}
          {tab === "lifecycle" && (
            <LifecycleTab entries={entries} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </section>
      </main>

      <aside className="inspector">
        <ExpertiseInspector entry={entries.find(e => e.id === selectedId) || null} crew={crew} onClose={() => setSelectedId(null)} />
      </aside>
    </>
  );
}

function CatalogTab({ entries, loading, error, selectedId, onSelect }: {
  entries: ExpertiseEntry[]; loading: boolean; error: string | null;
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  if (loading) return <div className="loading-state">Loading expertise catalog...</div>;
  if (error) return <div className="error-state">Error: {error}</div>;
  if (entries.length === 0) return <div className="empty-state">No expertise entries. Run "Seed" to populate.</div>;

  return (
    <div className="expertise-table">
      <table>
        <thead>
          <tr>
            <th aria-label="Selected" />
            <th>Agent</th>
            <th>Role</th>
            <th>Confidence</th>
            <th>Band</th>
            <th>Lifecycle</th>
            <th>Capabilities</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const parts = entry.id.includes(":") ? entry.id.split(":") : [entry.id, ""];
            const shortId = parts[parts.length - 1];
            const isLead = entry.owner?.agent?.includes("-lead") || shortId === "orchestrator";
            return (
              <tr key={entry.id} className={selectedId === entry.id ? "is-selected" : ""} onClick={() => onSelect(entry.id)}>
                <td>
                  <Icon name={selectedId === entry.id ? "radio_button_checked" : "radio_button_unchecked"} size={18} filled={selectedId === entry.id} />
                </td>
                <td className="agent-name-cell">{shortId}</td>
                <td><span className="role-cell">{isLead ? "lead" : "worker"}</span></td>
                <td><ConfidenceBar score={entry.confidence?.score || 0} /></td>
                <td><span style={{ fontSize: 12 }}>{formatBand(entry.confidence?.band)}</span></td>
                <td><LifecycleBadge lifecycle={entry.lifecycle || "experimental"} /></td>
                <td>
                  <div className="cap-chips">
                    {(entry.capabilities || []).slice(0, 3).map(cap => (
                      <span className="cap-chip" key={cap}>{cap}</span>
                    ))}
                    {(entry.capabilities || []).length > 3 && (
                      <span className="cap-chip cap-chip--more">+{entry.capabilities.length - 3}</span>
                    )}
                  </div>
                </td>
                <td><span style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>{entry.evidence_count ?? entry.confidence?.evidence_count ?? 0}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceTab({ entries, selectedId, onSelect }: {
  entries: ExpertiseEntry[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(selectedId);
  const { events, loading, error } = useEvidenceData(activeId || "");

  useEffect(() => { if (selectedId) setActiveId(selectedId); }, [selectedId]);

  if (entries.length === 0) return <div className="empty-state">No entries to show evidence for.</div>;

  return (
    <div className="evidence-tab">
      <div className="evidence-agent-list">
        <p style={{ fontSize: 11, color: "#94a3b8", padding: "8px 12px", margin: 0 }}>Select agent</p>
        {entries.map(e => (
          <button
            key={e.id}
            className={`evidence-agent-btn ${activeId === e.id ? "is-active" : ""}`}
            onClick={() => setActiveId(e.id)}
          >
            {e.id.includes(":") ? e.id.split(":")[1] : e.id}
          </button>
        ))}
      </div>
      <div className="evidence-events">
        {!activeId && <div className="empty-state"> Select an agent to view evidence.</div>}
        {activeId && loading && <div className="loading-state">Loading evidence...</div>}
        {activeId && error && <div className="error-state">{error}</div>}
        {activeId && !loading && !error && events.length === 0 && <div className="empty-state">No evidence events recorded.</div>}
        {activeId && !loading && !error && events.length > 0 && (
          <div className="events-timeline">
            {events.map((ev, i) => (
              <div key={i} className={`event-item event-item--${ev.outcome}`}>
                <div className="event-marker">
                  <span className={`timeline__marker ${ev.outcome === "success" ? "timeline__marker--active" : ""}`} />
                </div>
                <div className="event-content">
                  <div className="event-header">
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, color: ev.outcome === "success" ? "#4caf50" : ev.outcome === "failure" ? "#dc2626" : "#ffc107" }}>{ev.outcome}</span>
                    <span style={{ fontSize: 11, color: "#666" }}>{relativeTime(ev.recorded_at)}</span>
                  </div>
                  <p style={{ fontSize: 12, margin: "4px 0", color: "#333" }}>{ev.task_description || ev.task_type || "—"}</p>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#94a3b8" }}>
                    {ev.duration_ms > 0 ? `${(ev.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalsTab({ proposals, loading }: { proposals: ProposalInfo[]; loading: boolean }) {
  if (loading) return <div className="loading-state">Loading proposals...</div>;
  if (proposals.length === 0) {
    return (
      <div className="empty-state">
        <p>No governance proposals.</p>
        <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
          Run <code>mah expertise propose &lt;id&gt; --from-evidence</code> to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="expertise-table">
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Summary</th>
            <th>Generated By</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map(p => (
            <tr key={p.id}>
              <td className="agent-name-cell">{p.target_expertise_id}</td>
              <td style={{ fontSize: 12, maxWidth: 200 }}>{p.summary}</td>
              <td style={{ fontSize: 12 }}>{p.generated_by?.actor}</td>
              <td>
                <StatusBadge tone={p.status === "approved" ? "completed" : p.status === "rejected" ? "failed" : "running"} label={p.status} />
              </td>
              <td style={{ fontSize: 12 }}>{relativeTime(p.created_at)}</td>
              <td>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/mah/exec", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ args: ["expertise", "apply-proposal", `.mah/expertise/proposals/${p.id}`] }),
                    });
                  }}
                  style={{ fontSize: 11, padding: "4px 8px", cursor: "pointer" }}
                >
                  Apply
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LifecycleTab({ entries, selectedId, onSelect }: {
  entries: ExpertiseEntry[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(selectedId);
  useEffect(() => { if (selectedId) setSelected(selectedId); }, [selectedId]);

  const validTransitions: Record<string, string[]> = {
    experimental: ["active"],
    active: ["restricted", "experimental"],
    restricted: ["active", "revoked"],
    revoked: [],
  };

  if (entries.length === 0) return <div className="empty-state">No entries.</div>;
  const current = entries.find(e => e.id === selected);

  return (
    <div className="lifecycle-tab">
      <div className="lifecycle-agent-list">
        {entries.map(e => (
          <button
            key={e.id}
            className={`evidence-agent-btn ${selected === e.id ? "is-active" : ""}`}
            onClick={() => setSelected(e.id)}
          >
            {e.id.includes(":") ? e.id.split(":")[1] : e.id}
          </button>
        ))}
      </div>
      <div className="lifecycle-panel">
        {!current && <div className="empty-state"> Select an agent.</div>}
        {current && (
          <>
            <div className="lifecycle-current">
              <LifecycleBadge lifecycle={current.lifecycle || "experimental"} />
              <span style={{ fontSize: 13, marginLeft: 12 }}>{current.id}</span>
            </div>
            <div className="lifecycle-transitions">
              <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Available transitions:</p>
              {(validTransitions[current.lifecycle || "experimental"] || []).map(state => (
                <button
                  key={state}
                  type="button"
                  className="lifecycle-transition-btn"
                  onClick={async () => {
                    if (!confirm(`Transition ${current.id} to ${state}?`)) return;
                    await fetch("/api/mah/exec", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ args: ["expertise", "lifecycle", current.id, "--to", state, "--json"] }),
                    });
                  }}
                >
                  <Icon name="arrow_forward" size={12} />{state}
                </button>
              ))}
              {validTransitions[current.lifecycle || "experimental"]?.length === 0 && (
                <p style={{ fontSize: 12, color: "#94a3b8" }}>No transitions available from this state.</p>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Provenance chain:</p>
              <div className="inspector-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div><span>Confidence</span><strong>{Math.round((current.confidence?.score || 0) * 100)}%</strong></div>
                <div><span>Evidence</span><strong>{current.evidence_count ?? 0}</strong></div>
                <div><span>Trust Tier</span><strong>{current.trust_tier || "internal"}</strong></div>
                <div><span>Validation</span><strong>{current.validation_status || "declared"}</strong></div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExpertiseInspector({ entry, onClose }: {
  entry: ExpertiseEntry | null; crew: string; onClose: () => void;
}) {
  const { metrics } = useExpertiseDetail(entry?.id || "");
  const { events } = useEvidenceData(entry?.id || "", 10);

  if (!entry) {
    return (
      <section className="inspector__body" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
        <Icon name="info" size={32} />
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Select an agent to view expertise detail</p>
      </section>
    );
  }

  return (
    <>
      <section className="inspector__header">
        <div className="inspector__title-row">
          <div>
            <h3>Expertise Detail</h3>
            <p>{entry.id}</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
      </section>
      <section className="inspector__body">
        <div className="inspector-stats">
          <div><span>Lifecycle</span><strong><LifecycleBadge lifecycle={entry.lifecycle || "experimental"} /></strong></div>
          <div><span>Band</span><strong>{formatBand(entry.confidence?.band)}</strong></div>
          <div><span>Evidence</span><strong>{entry.evidence_count ?? entry.confidence?.evidence_count ?? 0}</strong></div>
          <div><span>Trust Tier</span><strong>{entry.trust_tier || "internal"}</strong></div>
          {metrics && (
            <>
              <div><span>Invocations</span><strong>{metrics.total_invocations}</strong></div>
              <div><span>Success Rate</span><strong>{Math.round(metrics.review_pass_rate * 100)}%</strong></div>
              <div><span>Avg Latency</span><strong>{metrics.avg_duration_ms > 0 ? `${(metrics.avg_duration_ms / 1000).toFixed(1)}s` : "—"}</strong></div>
              <div><span>Last Invoked</span><strong>{relativeTime(metrics.last_invoked)}</strong></div>
            </>
          )}
        </div>

        {entry.capabilities && entry.capabilities.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 6 }}>Capabilities</p>
            <div className="cap-chips">
              {entry.capabilities.map(cap => (
                <span className="cap-chip" key={cap}>{cap}</span>
              ))}
            </div>
          </div>
        )}

        {entry.domains && entry.domains.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 6 }}>Domains</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {entry.domains.map(d => (
                <span key={d} style={{ fontSize: 11, background: "#f0f0f0", padding: "2px 6px", borderRadius: 4 }}>{d}</span>
              ))}
            </div>
          </div>
        )}

        {events.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 8 }}>Recent Evidence</p>
            <ol className="timeline" style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {events.slice(0, 5).map((ev, i) => (
                <li key={i} style={{ display: "grid", gridTemplateColumns: "12px 1fr", gap: 12, marginBottom: 12 }}>
                  <span className={`timeline__marker ${ev.outcome === "success" ? "timeline__marker--active" : ""}`} />
                  <div>
                    <time style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase" as const, color: "#94a3b8" }}>
                      {relativeTime(ev.recorded_at)}
                    </time>
                    <h4 style={{ margin: "2px 0", fontSize: 12 }}>{ev.outcome} — {ev.task_type}</h4>
                    <p style={{ margin: 0, fontSize: 11, color: "#666" }}>{ev.task_description?.slice(0, 60)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </>
  );
}
