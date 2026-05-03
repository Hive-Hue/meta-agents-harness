import { useState, useEffect } from "react";
import { TeamLane } from "./TeamLane";
import { TopologyFilters } from "./TopologyFilters";
import { CrewsInspector } from "./CrewsInspector";
import { FlowchartView } from "./FlowchartView";
import { useConfig, ConfigProvider } from "../config/useConfigStore";
import type { Agent } from "./AgentCard";
import "./crews.css";

export function CrewsTopology() {
  return (
    <ConfigProvider>
      <CrewsTopologyInner />
    </ConfigProvider>
  );
}

const TEAM_COLORS: Record<string, string> = {
  orchestration: "var(--color-text)",
  planning: "var(--color-cyan)",
  engineering: "#4CAF50",
  validation: "var(--color-warning)",
};

function hashColor(str: string): string {
  const palette = ["var(--color-cyan)", "var(--color-secondary-cyan)", "#4CAF50", "var(--color-warning)", "var(--color-text-muted)", "#8D6E63"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

function resolveTeamColor(name: string): string {
  return TEAM_COLORS[name.toLowerCase()] ?? hashColor(name);
}

function CrewsTopologyInner() {
  const { config } = useConfig();
  const crews = config?.crews ?? [];
  const [selectedCrewId, setSelectedCrewId] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "flowchart">("cards");
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});

  // Auto-select first crew
  useEffect(() => {
    if (!selectedCrewId && crews.length > 0) {
      setSelectedCrewId(crews[0].id);
    }
  }, [crews, selectedCrewId]);

  const selectedCrew = crews.find((c) => c.id === selectedCrewId) ?? crews[0];

  // Derive agents from selected crew
  const crewAgents: Agent[] = (selectedCrew?.agents ?? []).map((a) => ({
    id: a.id,
    role: a.role as Agent["role"],
    model: config?.catalog?.models?.[a.model_ref] ?? a.model_ref,
    modelRef: a.model_ref,
    skills: a.skills ?? [],
    domain: Array.isArray(a.domain_profile) ? a.domain_profile : a.domain_profile ? [a.domain_profile] : [],
    expertise: "validated" as const,
    confidence: 0.85,
    team: a.team ? a.team.charAt(0).toUpperCase() + a.team.slice(1) : "Unknown",
  }));

  // Derive teams from selected crew
  const teamMap = new Map<string, Agent[]>();
  for (const a of crewAgents) {
    const arr = teamMap.get(a.team) ?? [];
    arr.push(a);
    teamMap.set(a.team, arr);
  }
  const teams = Array.from(teamMap.entries()).map(([name, agents]) => ({
    name,
    color: resolveTeamColor(name),
    agents,
  }));

  const filtered = crewAgents.filter((a) => {
    if (roleFilter && a.role !== roleFilter) return false;
    if (capabilityFilter && !a.skills.some((s) => s.toLowerCase().includes(capabilityFilter.toLowerCase()))) return false;
    if (modelFilter && a.modelRef !== modelFilter) return false;
    if (domainFilter && !a.domain.includes(domainFilter)) return false;
    return true;
  });

  const selectedAgent = crewAgents.find((a) => a.id === selectedAgentId) ?? null;
  const toggleTeamCollapse = (teamName: string) => {
    setCollapsedTeams((prev) => ({ ...prev, [teamName]: !prev[teamName] }));
  };

  const modelRefs = Object.keys(config?.catalog?.models ?? {});
  const domainProfiles = Object.keys(config?.domain_profiles ?? {});

  return (
    <>
      <main className="crews-main">
        <section className="crews-header">
          <div className="crews-header__top">
            <div>
              <h2>Crews Topology</h2>
              <div className="crews-header__crew-select-row">
                <select
                  className="crews-filter"
                  value={selectedCrewId}
                  onChange={(e) => { setSelectedCrewId(e.target.value); setSelectedAgentId(null); }}
                >
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>{c.display_name || c.id}</option>
                  ))}
                </select>
                <span className="crews-header__subtitle">
                  {teams.length} teams, {crewAgents.length} agents
                </span>
              </div>
            </div>
            <div className="crews-header__view-toggle" role="group" aria-label="Topology view mode">
              <button
                type="button"
                className={"crews-header__view-btn" + (viewMode === "cards" ? " crews-header__view-btn--active" : "")}
                onClick={() => setViewMode("cards")}
              >
                Cards
              </button>
              <button
                type="button"
                className={"crews-header__view-btn" + (viewMode === "flowchart" ? " crews-header__view-btn--active" : "")}
                onClick={() => setViewMode("flowchart")}
              >
                Flowchart
              </button>
            </div>
          </div>
          <TopologyFilters
            role={roleFilter}
            onRoleChange={setRoleFilter}
            capability={capabilityFilter}
            onCapabilityChange={setCapabilityFilter}
            model={modelFilter}
            onModelChange={setModelFilter}
            domain={domainFilter}
            onDomainChange={setDomainFilter}
            modelRefs={modelRefs}
            domainProfiles={domainProfiles}
          />
        </section>
        <section className="crews-content">
          {viewMode === "cards" &&
            teams.map((team) => {
              const teamAgents = filtered.filter((a) => a.team === team.name);
              if (teamAgents.length === 0) return null;
              return (
                <TeamLane
                  key={team.name}
                  name={team.name}
                  color={team.color}
                  agents={teamAgents}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={setSelectedAgentId}
                  collapsed={collapsedTeams[team.name] ?? false}
                  onToggleCollapsed={() => toggleTeamCollapse(team.name)}
                />
              );
            })}
          {viewMode === "flowchart" && (
            <FlowchartView
              teams={teams}
              agents={filtered}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />
          )}
        </section>
      </main>
      <aside className="inspector crews-inspector" aria-label="Agent inspector">
        <CrewsInspector agent={selectedAgent} crewId={selectedCrewId} />
      </aside>
    </>
  );
}
