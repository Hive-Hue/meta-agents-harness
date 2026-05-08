import { Icon } from "../../components/ui/Icon";

export interface Agent {
  id: string;
  role: "orchestrator" | "lead" | "worker";
  model: string;
  modelRef: string;
  skills: string[];
  domain: string[];
  expertise: "validated" | "experimental" | "restricted";
  confidence: number;
  team: string;
}

type Team = {
  name: string;
  color: string;
};

type FlowchartViewProps = {
  teams: Team[];
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
};

export function FlowchartView({ teams, agents, selectedAgentId, onSelectAgent }: FlowchartViewProps) {
  const orchestrator = agents.find((agent) => agent.role === "orchestrator") ?? null;
  const nonOrchestrationTeams = teams.filter((team) => team.name !== "Orchestration");
  const confidenceClassFor = (confidence: number) =>
    confidence >= 0.8 ? "high" : confidence >= 0.6 ? "mid" : "low";
  const expertiseIconFor = (expertise: Agent["expertise"]) =>
    expertise === "validated" ? "verified" : expertise === "experimental" ? "science" : "warning";

  return (
    <section className="flowchart" aria-label="Crew hierarchy flowchart">
      {orchestrator && (
        <div className="flowchart__root">
          <button
            className={"flow-node flow-node--orchestrator" + (selectedAgentId === orchestrator.id ? " flow-node--selected" : "")}
            type="button"
            onClick={() => onSelectAgent(orchestrator.id)}
          >
            <span className="flow-node__id">{orchestrator.id}</span>
            <span className="flow-node__meta">{orchestrator.model}</span>
            <div className="agent-card__meta">
              <span className={"agent-card__expertise agent-card__expertise--" + orchestrator.expertise}>
                <Icon name={expertiseIconFor(orchestrator.expertise)} size={10} />
                {orchestrator.expertise}
              </span>
            </div>
            <div className="agent-card__confidence">
              <div
                className={"agent-card__confidence-fill agent-card__confidence-fill--" + confidenceClassFor(orchestrator.confidence)}
                style={{ width: (orchestrator.confidence * 100) + "%" }}
              />
            </div>
          </button>
        </div>
      )}

      <div className="flowchart__trunk" aria-hidden="true" />

      <div className="flowchart__teams">
        {nonOrchestrationTeams.map((team) => {
          const teamAgents = agents.filter((agent) => agent.team === team.name);
          if (teamAgents.length === 0) return null;

          const leads = teamAgents.filter((agent) => agent.role === "lead");
          const workers = teamAgents.filter((agent) => agent.role !== "lead");

          return (
            <article key={team.name} className="flow-team" style={{ borderTopColor: team.color, borderTopWidth: 3, borderTopStyle: "solid" as const }}>
              <div className="flow-team__title">{team.name}</div>
              {leads.map(lead => (
                <button
                  key={lead.id}
                  className={"flow-node flow-node--lead" + (selectedAgentId === lead.id ? " flow-node--selected" : "")}
                  type="button"
                  onClick={() => onSelectAgent(lead.id)}
                  style={{ borderTopColor: team.color }}
                >
                  <span className="flow-node__id">{lead.id}</span>
                  <span className="flow-node__meta">{lead.model}</span>
                  <div className="agent-card__meta">
                    <span className={"agent-card__expertise agent-card__expertise--" + lead.expertise}>
                      <Icon name={expertiseIconFor(lead.expertise)} size={10} />
                      {lead.expertise}
                    </span>
                  </div>
                  <div className="agent-card__confidence">
                    <div
                      className={"agent-card__confidence-fill agent-card__confidence-fill--" + confidenceClassFor(lead.confidence)}
                      style={{ width: (lead.confidence * 100) + "%" }}
                    />
                  </div>
                </button>
              ))}
              {leads.length > 0 && workers.length > 0 && <div className="flow-team__branch" aria-hidden="true" />}
              {workers.length > 0 && (
                <div className="flow-team__workers">
                  {workers.map(worker => (
                    <button
                      key={worker.id}
                      className={"flow-node flow-node--worker" + (selectedAgentId === worker.id ? " flow-node--selected" : "")}
                      type="button"
                      onClick={() => onSelectAgent(worker.id)}
                    >
                      <span className="flow-node__id">{worker.id}</span>
                      <span className="flow-node__meta">{worker.model}</span>
                      <div className="agent-card__meta">
                        <span className={"agent-card__expertise agent-card__expertise--" + worker.expertise}>
                          <Icon name={expertiseIconFor(worker.expertise)} size={10} />
                          {worker.expertise}
                        </span>
                      </div>
                      <div className="agent-card__confidence">
                        <div
                          className={"agent-card__confidence-fill agent-card__confidence-fill--" + confidenceClassFor(worker.confidence)}
                          style={{ width: (worker.confidence * 100) + "%" }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
