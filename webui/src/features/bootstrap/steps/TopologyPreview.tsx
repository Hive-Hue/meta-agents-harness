import type { WizardData } from "../BootstrapWizard";

type TopologyPreviewProps = {
  data: WizardData;
};

const mockTopology = {
  orchestrator: {
    name: "Orchestrator",
    model: "glm-4.7",
  },
  teams: [
    {
      name: "Planning",
      agents: [
        { name: "planning-lead", role: "lead", model: "glm-4.1" },
        { name: "backlog-groomer", role: "worker", model: "glm-4.1" },
      ],
    },
    {
      name: "Engineering",
      agents: [
        { name: "engineering-lead", role: "lead", model: "glm-4.7" },
        { name: "frontend-dev", role: "worker", model: "glm-4.1" },
        { name: "backend-dev", role: "worker", model: "glm-4.1" },
      ],
    },
    {
      name: "Validation",
      agents: [
        { name: "qa-lead", role: "lead", model: "glm-4.7" },
        { name: "test-runner", role: "worker", model: "glm-4.1" },
      ],
    },
  ],
};

export function TopologyPreview({ data }: TopologyPreviewProps) {
  const totalAgents = mockTopology.teams.reduce((sum, t) => sum + t.agents.length, 0);

  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Topology Preview</h3>
      <p className="wizard-step__desc">
        Review the generated agent topology for your crew configuration.
      </p>
      <div className="topology-tree">
        <div className="topology-node topology-node--orchestrator">
          <div className="topology-agent topology-agent--orchestrator">
            <span className="topology-agent__name">{mockTopology.orchestrator.name}</span>
            <span className="topology-agent__model">{mockTopology.orchestrator.model}</span>
          </div>
        </div>
        <div className="topology-teams">
          {mockTopology.teams.map((team) => (
            <div className="topology-team" key={team.name}>
              <h5 className="topology-team__name">{team.name}</h5>
              <div className="topology-agents">
                {team.agents.map((agent) => (
                  <div className={"topology-agent topology-agent--" + agent.role} key={agent.name}>
                    <span className="topology-agent__name">{agent.name}</span>
                    <span className="topology-agent__model">{agent.model}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="topology-summary">
        <span className="topology-summary__item">
          <strong>1</strong> orchestrator
        </span>
        <span className="topology-summary__item">
          <strong>{mockTopology.teams.length}</strong> teams
        </span>
        <span className="topology-summary__item">
          <strong>{totalAgents}</strong> agents
        </span>
      </div>
    </div>
  );
}
