import { useState } from "react";
import { TeamLane } from "./TeamLane";
import { TopologyFilters } from "./TopologyFilters";
import { CrewsInspector } from "./CrewsInspector";
import { FlowchartView } from "./FlowchartView";
import type { Agent } from "./AgentCard";
import "./crews.css";

const allAgents: Agent[] = [
  {
    id: "orchestrator",
    role: "orchestrator",
    model: "minimax-coding-plan/MiniMax-M2.7",
    modelRef: "orchestrator_default",
    skills: ["delegate_bounded", "zero_micromanagement", "expertise_model", "expertise_governance", "caveman", "caveman-crew", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["read_only_repo"],
    expertise: "validated",
    confidence: 0.92,
    team: "Orchestration",
  },
  {
    id: "planning-lead",
    role: "lead",
    model: "zai-coding-plan/glm-5",
    modelRef: "lead_default",
    skills: ["delegate_bounded", "zero_micromanagement", "expertise_model", "caveman", "caveman-crew", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["planning_delivery"],
    expertise: "validated",
    confidence: 0.85,
    team: "Planning",
  },
  {
    id: "repo-analyst",
    role: "worker",
    model: "zai-coding-plan/glm-5",
    modelRef: "worker_default",
    skills: ["expertise_model", "caveman", "caveman-crew", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["read_only_repo"],
    expertise: "validated",
    confidence: 0.78,
    team: "Planning",
  },
  {
    id: "solution-architect",
    role: "worker",
    model: "zai-coding-plan/glm-5",
    modelRef: "lead_default",
    skills: ["expertise_model", "caveman", "caveman-crew", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["planning_delivery"],
    expertise: "validated",
    confidence: 0.81,
    team: "Planning",
  },
  {
    id: "engineering-lead",
    role: "lead",
    model: "zai-coding-plan/glm-5",
    modelRef: "lead_default",
    skills: ["delegate_bounded", "zero_micromanagement", "expertise_model", "caveman", "caveman-crew", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["runtime_impl"],
    expertise: "validated",
    confidence: 0.88,
    team: "Engineering",
  },
  {
    id: "frontend-dev",
    role: "worker",
    model: "zai-coding-plan/glm-5",
    modelRef: "worker_default",
    skills: ["expertise_model", "caveman", "caveman-crew", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["cli_operator_surface", "runtime_impl"],
    expertise: "validated",
    confidence: 0.75,
    team: "Engineering",
  },
  {
    id: "backend-dev",
    role: "worker",
    model: "zai-coding-plan/glm-5",
    modelRef: "worker_default",
    skills: ["expertise_model", "caveman", "caveman-crew", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["cli_operator_surface", "runtime_impl"],
    expertise: "validated",
    confidence: 0.72,
    team: "Engineering",
  },
  {
    id: "validation-lead",
    role: "lead",
    model: "zai-coding-plan/glm-5",
    modelRef: "lead_default",
    skills: ["delegate_bounded", "zero_micromanagement", "expertise_model", "caveman", "caveman-crew", "caveman-commit", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["validation_runtime"],
    expertise: "validated",
    confidence: 0.86,
    team: "Validation",
  },
  {
    id: "qa-reviewer",
    role: "worker",
    model: "openai-codex/gpt-5.4-mini",
    modelRef: "qa_default",
    skills: ["expertise_model", "caveman", "caveman-crew", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["validation_runtime"],
    expertise: "validated",
    confidence: 0.79,
    team: "Validation",
  },
  {
    id: "security-reviewer",
    role: "worker",
    model: "openai-codex/gpt-5.4-mini",
    modelRef: "qa_default",
    skills: ["expertise_model", "caveman", "caveman-crew", "caveman-compress", "caveman-help", "caveman-review"],
    domain: ["validation_runtime"],
    expertise: "validated",
    confidence: 0.82,
    team: "Validation",
  },
];

const teams = [
  { name: "Orchestration", color: "orchestration" },
  { name: "Planning", color: "planning" },
  { name: "Engineering", color: "engineering" },
  { name: "Validation", color: "validation" },
];

export function CrewsTopology() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "flowchart">("cards");
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});

  const filtered = allAgents.filter((a) => {
    if (roleFilter && a.role !== roleFilter) return false;
    if (capabilityFilter && !a.skills.some((s) => s.toLowerCase().includes(capabilityFilter.toLowerCase()))) return false;
    if (modelFilter && a.modelRef !== modelFilter) return false;
    if (domainFilter && !a.domain.includes(domainFilter)) return false;
    return true;
  });

  const selectedAgent = allAgents.find((a) => a.id === selectedAgentId) ?? null;
  const toggleTeamCollapse = (teamName: string) => {
    setCollapsedTeams((prev) => ({ ...prev, [teamName]: !prev[teamName] }));
  };

  return (
    <>
      <main className="crews-main">
        <section className="crews-header">
          <div className="crews-header__top">
            <div>
              <h2>Crews Topology</h2>
              <p className="crews-header__subtitle">
                Agent hierarchy for crew <strong>dev</strong> — 4 teams, 10 agents
              </p>
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
        <CrewsInspector agent={selectedAgent} />
      </aside>
    </>
  );
}
