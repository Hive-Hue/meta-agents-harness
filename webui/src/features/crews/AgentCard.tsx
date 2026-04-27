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

type AgentCardProps = {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
};

export function AgentCard({ agent, selected, onClick }: AgentCardProps) {
  const confidenceClass =
    agent.confidence >= 0.8 ? "high" : agent.confidence >= 0.6 ? "mid" : "low";

  return (
    <div
      className={"agent-card" + (selected ? " agent-card--selected" : "")}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={"Agent " + agent.id}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
    >
      <div className="agent-card__top">
        <span className="agent-card__name">{agent.id}</span>
        <span className={"agent-card__role agent-card__role--" + agent.role}>
          {agent.role}
        </span>
      </div>
      <span className="agent-card__model">{agent.model}</span>
      <div className="agent-card__meta">
        <span className="agent-card__skills-count">
          {agent.skills.length} skills
        </span>
        <span className="agent-card__domain">
          {agent.domain.join(", ")}
        </span>
      </div>
      <div className="agent-card__meta">
        <span className={"agent-card__expertise agent-card__expertise--" + agent.expertise}>
          <Icon name={agent.expertise === "validated" ? "verified" : agent.expertise === "experimental" ? "science" : "warning"} size={10} />
          {agent.expertise}
        </span>
      </div>
      <div className="agent-card__confidence">
        <div
          className={"agent-card__confidence-fill agent-card__confidence-fill--" + confidenceClass}
          style={{ width: (agent.confidence * 100) + "%" }}
        />
      </div>
    </div>
  );
}
