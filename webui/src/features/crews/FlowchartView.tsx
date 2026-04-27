import type { Agent } from "./AgentCard";

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
