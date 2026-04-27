import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import "./sync.css";

const checklist = [
  { label: "Catalog integrity: all agents have id + owner fields", status: "pass" as const },
  { label: "No orphan proposals without source session", status: "pass" as const },
  { label: "Expertise file size within 24KB budget", status: "pass" as const },
  { label: "Context memory index up to date", status: "warn" as const },
  { label: "No conflicting proposals for same agent", status: "pass" as const },
];

const diffLines = [
  { op: "+", text: "engineering-lead: promote prop_01j4k3x (3 patterns)" },
  { op: "+", text: "qa-reviewer: seed from operational (baseline)" },
  { op: "~", text: "frontend-dev: update observation cache (2 entries)" },
  { op: "-", text: "security-reviewer: reject stale proposal prop_01j3a2b" },
];

const crews = [
  { crew: "dev", agents: 7, synced: 7, pending: 0, status: "synced" as const },
  { crew: "planning", agents: 4, synced: 3, pending: 1, status: "partial" as const },
  { crew: "staging", agents: 3, synced: 3, pending: 0, status: "synced" as const },
];

const statusByTone = {
  synced: { tone: "completed" as const, label: "Synced" },
  partial: { tone: "running" as const, label: "Partial" },
};

export function SyncReview() {
  return (
    <>
      <main className="sync-main">
        <section className="screen-header">
          <div>
            <h2>Sync & Runtime Artifacts</h2>
            <div className="screen-header__meta">
              <span className="live-summary">
                <span className="live-summary__dot" aria-hidden="true" />
                Last sync: 12 min ago
              </span>
              <span className="screen-header__separator" aria-hidden="true" />
              <span className="screen-header__clusters">
                3 crews · 14 agents
              </span>
            </div>
          </div>

          <CommandPreview context="dev-crew" command="mah expertise sync --dry-run" />
        </section>

        <section className="sync-main__content">
          <div className="sync-split">
            <div className="sync-left">
              <div className="sync-checklist">
                <h4>Validation Checklist</h4>
                {checklist.map((item) => (
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
                <h4>Planned Changes</h4>
                <pre>
                  <code>
                    {diffLines.map((line) => (
                      <span className={`diff-line diff-line--${line.op}`} key={line.text}>
                        {line.op} {line.text}
                        {"\n"}
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
            </div>

            <div className="sync-right">
              {crews.map((c) => {
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
            </div>
          </div>
        </section>
      </main>

      <aside className="inspector" aria-label="Sync context inspector">
        <section className="inspector__header">
          <div className="inspector__title-row">
            <div>
              <h3>Sync Context</h3>
              <p>dev-crew</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close inspector">
              <Icon name="close" />
            </button>
          </div>
        </section>

        <section className="inspector__body">
          <div className="inspector-stats">
            <div>
              <span>Mode</span>
              <strong>dry-run</strong>
            </div>
            <div>
              <span>Started</span>
              <strong>2 min ago</strong>
            </div>
            <div>
              <span>Duration</span>
              <strong>1.2s</strong>
            </div>
            <div>
              <span>Crews</span>
              <strong>3</strong>
            </div>
          </div>

          <ol className="timeline">
            <li>
              <span className="timeline__marker" aria-hidden="true" />
              <div>
                <h4>Safety Checks</h4>
                <div className="safety-check">
                  <Icon name="verified_user" size={14} />
                  Catalog backup created
                </div>
                <div className="safety-check">
                  <Icon name="verified_user" size={14} />
                  No force-overwrite on validated entries
                </div>
                <div className="safety-check">
                  <Icon name="verified_user" size={14} />
                  Rollback point available
                </div>
              </div>
            </li>
          </ol>
        </section>
      </aside>
    </>
  );
}
