import { AgentCard, type Agent } from "./AgentCard";

type TeamLaneProps = {
  name: string;
  color: string;
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export function TeamLane({
  name,
  color,
  agents,
  selectedAgentId,
  onSelectAgent,
  collapsed,
  onToggleCollapsed,
}: TeamLaneProps) {
  const laneClass = "team-lane";

  return (
    <div className={laneClass} style={{ borderLeftColor: color, borderLeftWidth: 3, borderLeftStyle: "solid" as const }}>
      <div className="team-lane__header">
        <button
          className="team-lane__toggle"
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={"team-lane-" + name.toLowerCase()}
        >
          <span className="team-lane__name">{name}</span>
          <span className={"team-lane__chevron" + (collapsed ? " team-lane__chevron--collapsed" : "")}>
            ▾
          </span>
        </button>
        <span className="team-lane__count">{agents.length} agents</span>
      </div>
      {!collapsed && (
        <div className="team-lane__agents" id={"team-lane-" + name.toLowerCase()}>
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedAgentId}
              onClick={() => onSelectAgent(agent.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
