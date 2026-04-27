import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import type { Agent } from "./AgentCard";

type CrewsInspectorProps = {
  agent: Agent | null;
};

export function CrewsInspector({ agent }: CrewsInspectorProps) {
  if (!agent) {
    return (
      <>
        <section className="inspector__header">
          <h3>Agent Inspector</h3>
        </section>
        <section className="inspector__body">
          <p style={{ color: "#94a3b8", fontSize: 13 }}>Select an agent card to view details.</p>
        </section>
      </>
    );
  }

  const command = "mah expertise show dev:" + agent.id;

  return (
    <>
      <section className="inspector__header">
        <h3>Agent Inspector</h3>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 800, color: "#1c1b1b" }}>
          {agent.id}
        </p>
      </section>
      <section className="inspector__body">
        <div className="crews-inspector__command">
          <CommandPreview context="expertise" command={command} />
        </div>

        <div>
          <h4 className="crews-inspector__section-title">Agent Info</h4>
          <dl className="crews-inspector__fields">
            <div className="crews-inspector__field">
              <dt>ID</dt>
              <dd>{agent.id}</dd>
            </div>
            <div className="crews-inspector__field">
              <dt>Role</dt>
              <dd>{agent.role}</dd>
            </div>
            <div className="crews-inspector__field">
              <dt>Team</dt>
              <dd>{agent.team}</dd>
            </div>
            <div className="crews-inspector__field">
              <dt>Model</dt>
              <dd>{agent.modelRef}</dd>
            </div>
            <div className="crews-inspector__field">
              <dt>Expertise</dt>
              <dd>{agent.expertise}</dd>
            </div>
            <div className="crews-inspector__field">
              <dt>Confidence</dt>
              <dd>{agent.confidence}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="crews-inspector__section-title">Skills ({agent.skills.length})</h4>
          <ul className="crews-inspector__skills">
            {agent.skills.map((s) => (
              <li className="crews-inspector__skill" key={s}>{s}</li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="crews-inspector__section-title">Domain Profile</h4>
          <dl className="crews-inspector__fields">
            {agent.domain.map((d) => (
              <div className="crews-inspector__field" key={d}>
                <dt>Profile</dt>
                <dd>{d}</dd>
              </div>
            ))}
          </dl>
        </div>

        {agent.domain.includes("cli_operator_surface") && (
          <div className="crews-inspector__warnings">
            <div className="crews-inspector__warning">
              <Icon name="warning" size={14} />
              <span>Broad domain access: cli_operator_surface</span>
            </div>
          </div>
        )}

        <div className="crews-inspector__actions">
          <button className="crews-inspector__action-btn crews-inspector__action-btn--primary" type="button">
            <Icon name="history" size={14} />
            View Sessions
          </button>
          <button className="crews-inspector__action-btn" type="button">
            <Icon name="tune" size={14} />
            Edit Config
          </button>
          <button className="crews-inspector__action-btn" type="button">
            <Icon name="compare" size={14} />
            Compare
          </button>
        </div>
      </section>
    </>
  );
}
