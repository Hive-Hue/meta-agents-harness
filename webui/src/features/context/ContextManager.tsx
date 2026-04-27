import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import "./context.css";

const documents = [
  { id: "ctx_001", name: "runtime-bootstrap-playbook.md", source: "operational", stability: "stable", capabilities: ["bootstrap", "cli", "runtime"], agent: "engineering-lead", status: "indexed", selected: true },
  { id: "ctx_002", name: "context-memory-retrieval.md", source: "operational", stability: "stable", capabilities: ["retrieval", "index", "context-memory"], agent: "engineering-lead", status: "indexed", selected: false },
  { id: "ctx_003", name: "delegate-bounded-workflow.md", source: "operational", stability: "stable", capabilities: ["delegation", "task", "bounded"], agent: "engineering-lead", status: "indexed", selected: false },
  { id: "ctx_004", name: "clickup-backlog-integration.md", source: "proposal", stability: "draft", capabilities: ["clickup", "mcp", "backlog"], agent: "planning-lead", status: "pending", selected: false },
  { id: "ctx_005", name: "session-recovery-playbook.md", source: "proposal", stability: "draft", capabilities: ["session", "recovery", "retry"], agent: "orchestrator", status: "pending", selected: false },
  { id: "ctx_006", name: "smoke-test-patterns.md", source: "operational", stability: "stable", capabilities: ["testing", "smoke", "node:test"], agent: "qa-reviewer", status: "indexed", selected: false },
];

export function ContextManager() {
  return (
    <>
      <main className="context-main">
        <section className="screen-header">
          <div>
            <h2>Context Manager</h2>
            <div className="screen-header__meta">
              <span className="screen-header__clusters">24 documents · 6 operational · 18 proposed</span>
            </div>
          </div>
          <CommandPreview context="dev-crew" command="mah context list --verbose" />
        </section>

        <section className="context-main__content">
          <div className="context-table">
            <table>
              <thead>
                <tr>
                  <th aria-label="Selected document" />
                  <th>Document</th>
                  <th>Source</th>
                  <th>Stability</th>
                  <th>Capabilities</th>
                  <th>Agent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr className={doc.selected ? "is-selected" : ""} key={doc.id}>
                    <td>
                      <Icon
                        name={doc.selected ? "radio_button_checked" : "radio_button_unchecked"}
                        className={doc.selected ? "selection-icon selection-icon--active" : "selection-icon"}
                        size={18}
                        filled={doc.selected}
                      />
                    </td>
                    <td className="doc-name-cell">{doc.name}</td>
                    <td>
                      <span className={`lifecycle-badge lifecycle-badge--${doc.source === "operational" ? "validated" : "proposal"}`}>
                        {doc.source}
                      </span>
                    </td>
                    <td>
                      <span className={`lifecycle-badge lifecycle-badge--${doc.stability === "stable" ? "validated" : "draft"}`}>
                        {doc.stability}
                      </span>
                    </td>
                    <td>
                      <div className="cap-chips">
                        {doc.capabilities.map((cap) => (
                          <span className="cap-chip" key={cap}>{cap}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="agent-cell-inline">
                        <Icon name="smart_toy" size={14} />
                        {doc.agent}
                      </span>
                    </td>
                    <td>
                      <StatusBadge
                        tone={doc.status === "indexed" ? "completed" : "running"}
                        label={doc.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="inspector" aria-label="Document detail inspector">
        <section className="inspector__header">
          <div className="inspector__title-row">
            <div>
              <h3>Document Detail</h3>
              <p>runtime-bootstrap-playbook.md</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close inspector">
              <Icon name="close" />
            </button>
          </div>
        </section>

        <section className="inspector__body">
          <div className="inspector-stats">
            <div>
              <span>Source</span>
              <strong>operational</strong>
            </div>
            <div>
              <span>Agent</span>
              <strong>engineering-lead</strong>
            </div>
            <div>
              <span>Stability</span>
              <strong>stable</strong>
            </div>
            <div>
              <span>Index</span>
              <strong>active</strong>
            </div>
          </div>

          <h4 className="inspector-section-title">Frontmatter</h4>
          <pre className="context-frontmatter">
            <code>{`---
agent: engineering-lead
capability: bootstrap
stability: stable
source: operational
indexed: true
---`}</code>
          </pre>

          <h4 className="inspector-section-title">Retrieval Scores</h4>
          <div className="retrieval-scores">
            <div className="retrieval-row">
              <span className="retrieval-row__key">capability:bootstrap</span>
              <span className="retrieval-row__value">0.94</span>
            </div>
            <div className="retrieval-row">
              <span className="retrieval-row__key">agent:engineering-lead</span>
              <span className="retrieval-row__value">0.88</span>
            </div>
            <div className="retrieval-row">
              <span className="retrieval-row__key">task:bootstrap+cli</span>
              <span className="retrieval-row__value">0.91</span>
            </div>
          </div>
        </section>
      </aside>
    </>
  );
}
