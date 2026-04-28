import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { CommandPreview } from "../../components/ui/CommandPreview";
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
    <div className="sync-panel">
      <div className="sync-panel__header">
        <div>
          {/* <h3>Sync & Runtime Artifacts</h3> */}
          <p className="sync-panel__meta">Last sync: just now · 3 crews · 14 agents</p>
        </div>
        {/* <div className="command-preview__command" style={{ flex: "none" }}> */}
          <CommandPreview context="expertise" command={`mah expertise sync --dry-run`} />
        {/* </div> */}
      </div>
      <div className="sync-panel__content">
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
      </div>
    </div>
  );
}
