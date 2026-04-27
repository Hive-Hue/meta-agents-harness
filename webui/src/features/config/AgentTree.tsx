import { useState, useEffect, useRef } from "react";
import { Icon } from "../../components/ui/Icon";
import { useConfig } from "./useConfigStore";

type Agent = {
  id: string;
  role: string;
  team: string;
  model_ref: string;
  skills?: string[];
  domain_profile?: string | string[];
};

function ProfilePills({ agent, profileNames, onUpdate }: {
  agent: Agent;
  profileNames: string[];
  onUpdate: (profiles: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = Array.isArray(agent.domain_profile)
    ? agent.domain_profile
    : agent.domain_profile
      ? [agent.domain_profile]
      : [];
  const available = profileNames.filter((p) => !current.includes(p));

  const remove = (p: string) => onUpdate(current.filter((c) => c !== p));
  const add = (p: string) => {
    onUpdate([...current, p]);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  return (
    <div className="config-agent__profiles">
      {current.map((p) => (
        <span className="config-agent__profile-pill" key={p}>
          {p}
          <button type="button" className="config-agent__profile-remove" onClick={() => remove(p)} aria-label={`Remove ${p}`}>
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <div className="config-agent__profile-add-wrapper" ref={ref}>
          <button type="button" className="config-agent__profile-add" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            <Icon name="add" size={12} />
          </button>
          {open && (
            <div className="config-agent__profile-dropdown">
              {available.map((p) => (
                <button type="button" key={p} className="config-agent__profile-option" onClick={() => add(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentTree() {
  const { config, updateConfig } = useConfig();
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

  const updateAgentProfiles = (agentId: string, profiles: string[]) => {
    const crews = config?.crews?.map((c) => ({
      ...c,
      agents: c.agents?.map((a) =>
        a.id === agentId
          ? { ...a, domain_profile: profiles.length === 0 ? undefined : profiles.length === 1 ? profiles[0] : profiles }
          : a
      ),
    }));
    if (crews) updateConfig({ crews });
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
                  </div>
                  <ProfilePills
                    agent={agent}
                    profileNames={profileNames}
                    onUpdate={(profiles) => updateAgentProfiles(agent.id, profiles)}
                  />
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
