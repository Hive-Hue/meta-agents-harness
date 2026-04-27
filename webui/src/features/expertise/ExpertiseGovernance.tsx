import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import "./expertise.css";

const agents = [
  { id: "orchestrator", name: "Orchestrator", role: "lead", team: "Core", confidence: 92, lifecycle: "validated", capabilities: ["routing", "delegation", "context-memory"], lastUpdated: "2h ago", selected: true },
  { id: "planning-lead", name: "Planning Lead", role: "lead", team: "Planning", confidence: 87, lifecycle: "validated", capabilities: ["backlog", "sprint-planning"], lastUpdated: "1d ago", selected: false },
  { id: "engineering-lead", name: "Engineering Lead", role: "lead", team: "Engineering", confidence: 95, lifecycle: "validated", capabilities: ["context-memory", "delegate-bounded", "zero-micromanagement"], lastUpdated: "3h ago", selected: false },
  { id: "frontend-dev", name: "Frontend Dev", role: "worker", team: "Engineering", confidence: 78, lifecycle: "draft", capabilities: ["react", "css", "webui"], lastUpdated: "5h ago", selected: false },
  { id: "backend-dev", name: "Backend Dev", role: "worker", team: "Engineering", confidence: 84, lifecycle: "validated", capabilities: ["cli", "scripts", "node"], lastUpdated: "4h ago", selected: false },
  { id: "qa-reviewer", name: "QA Reviewer", role: "worker", team: "Quality", confidence: 71, lifecycle: "proposal", capabilities: ["testing", "smoke", "contracts"], lastUpdated: "6h ago", selected: false },
  { id: "security-reviewer", name: "Security Reviewer", role: "worker", team: "Security", confidence: 88, lifecycle: "validated", capabilities: ["audit", "dependencies", "secrets"], lastUpdated: "12h ago", selected: false },
];

export function ExpertiseGovernance() {
  return (
    <>
      <main className="expertise-main">
        <section className="screen-header">
          <div>
            <h2>Expertise Governance</h2>
            <div className="screen-header__meta">
              <span className="screen-header__clusters">7 agents · 12 proposals · 3 pending review</span>
            </div>
          </div>
          <CommandPreview context="dev-crew" command="mah expertise list --verbose" />
        </section>

        <section className="expertise-main__content">
          <div className="expertise-table">
            <table>
              <thead>
                <tr>
                  <th aria-label="Selected agent" />
                  <th>Agent</th>
                  <th>Role</th>
                  <th>Confidence</th>
                  <th>Lifecycle</th>
                  <th>Capabilities</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr className={agent.selected ? "is-selected" : ""} key={agent.id}>
                    <td>
                      <Icon
                        name={agent.selected ? "radio_button_checked" : "radio_button_unchecked"}
                        className={agent.selected ? "selection-icon selection-icon--active" : "selection-icon"}
                        size={18}
                        filled={agent.selected}
                      />
                    </td>
                    <td className="agent-name-cell">{agent.name}</td>
                    <td>
                      <span className="role-cell">{agent.role}</span>
                    </td>
                    <td>
                      <div className="confidence-bar">
                        <div className="confidence-bar__fill" style={{ width: `${agent.confidence}%` }} />
                      </div>
                      <span className="confidence-value">{agent.confidence}%</span>
                    </td>
                    <td>
                      <span className={`lifecycle-badge lifecycle-badge--${agent.lifecycle}`}>
                        {agent.lifecycle}
                      </span>
                    </td>
                    <td>
                      <div className="cap-chips">
                        {agent.capabilities.map((cap) => (
                          <span className="cap-chip" key={cap}>{cap}</span>
                        ))}
                      </div>
                    </td>
                    <td className="time-cell">{agent.lastUpdated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="inspector" aria-label="Agent detail inspector">
        <section className="inspector__header">
          <div className="inspector__title-row">
            <div>
              <h3>Agent Detail</h3>
              <p>orchestrator</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close inspector">
              <Icon name="close" />
            </button>
          </div>
        </section>

        <section className="inspector__body">
          <div className="inspector-stats">
            <div>
              <span>Team</span>
              <strong>Core</strong>
            </div>
            <div>
              <span>Role</span>
              <strong>lead</strong>
            </div>
            <div>
              <span>Entries</span>
              <strong>14</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>92%</strong>
            </div>
          </div>

          <ol className="timeline">
            <li>
              <span className="timeline__marker" aria-hidden="true" />
              <div>
                <time>2h ago</time>
                <h4>Pattern Discovered</h4>
                <div className="timeline__tags">
                  <span>context-memory</span>
                  <span>routing</span>
                  <span>delegation</span>
                </div>
              </div>
            </li>
            <li>
              <span className="timeline__marker" aria-hidden="true" />
              <div>
                <time>1d ago</time>
                <h4>Proposal Created</h4>
                <code>prop_01j4f82x</code>
              </div>
            </li>
            <li>
              <span className="timeline__marker timeline__marker--active" aria-hidden="true" />
              <div>
                <time className="timeline__active-label">Latest</time>
                <h4>Validated</h4>
                <code>promoted to operational</code>
              </div>
            </li>
          </ol>
        </section>
      </aside>
    </>
  );
}
