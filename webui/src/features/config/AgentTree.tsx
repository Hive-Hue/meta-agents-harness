import { useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { useConfig } from "./useConfigStore";

function displayProfile(p?: string | string[]): string {
  if (!p) return "";
  if (Array.isArray(p)) return p[0] ?? "";
  return p;
}

export function AgentTree() {
  const { config } = useConfig();
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const agents = config?.crews?.flatMap((c) => c.agents ?? []) ?? [];
  const modelRefs = Object.keys(config?.catalog?.models ?? {});
  const profileNames = Object.keys(config?.domain_profiles ?? {});

  const teamMap = new Map<string, typeof agents>();
  for (const a of agents) {
    const arr = teamMap.get(a.team) ?? [];
    arr.push(a);
    teamMap.set(a.team, arr);
  }
  const teams = Array.from(teamMap.entries()).map(([name, tAgents]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    agents: tAgents,
  }));

  const toggleTeam = (name: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="config-agent-tree">
      {teams.map((team) => (
        <div className="config-team" key={team.name}>
          <button className="config-team__header" type="button" onClick={() => toggleTeam(team.name)}>
            <Icon name={expandedTeams.has(team.name) ? "expand_less" : "expand_more"} size={18} />
            <span className="config-team__name">{team.name}</span>
            <span className="config-team__count">{team.agents.length} agents</span>
          </button>
          {expandedTeams.has(team.name) && (
            <div className="config-team__agents">
              {team.agents.map((agent) => (
                <div className="config-agent" key={agent.id}>
                  <span className={"config-agent__role config-agent__role--" + agent.role}>
                    {agent.role}
                  </span>
                  <span className="config-agent__id">{agent.id}</span>
                  <div className="config-agent__meta">
                    <select defaultValue={agent.model_ref}>
                      {modelRefs.map((ref) => (
                        <option key={ref} value={ref}>{ref}</option>
                      ))}
                    </select>
                    <select defaultValue={displayProfile(agent.domain_profile)}>
                      {profileNames.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="config-agent__skills">
                    {agent.skills?.map((s) => (
                      <span className="config-agent__skill" key={s}>{s}</span>
                    ))}
                  </div>
                  <button className="config-agent__remove" type="button" aria-label="Remove agent">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
