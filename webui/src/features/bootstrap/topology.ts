import type { WizardData } from "./BootstrapWizard";

export type TeamDefinition = {
  id: string;
  name: string;
  workerBase: string;
};

export type TopologyAgent = {
  name: string;
  role: "lead" | "worker";
  model: string;
};

export type TopologyTeam = {
  id: string;
  name: string;
  agents: TopologyAgent[];
};

export type TopologyGraph = {
  orchestrator: {
    name: string;
    model: string;
  };
  teams: TopologyTeam[];
};

export const TEAM_DEFINITIONS: TeamDefinition[] = [
  { id: "planning", name: "Planning", workerBase: "planner" },
  { id: "engineering", name: "Engineering", workerBase: "engineer" },
  { id: "validation", name: "Validation", workerBase: "tester" },
  { id: "operations", name: "Operations", workerBase: "operator" },
];

export const DEFAULT_TOPOLOGY_TEAMS = ["planning", "engineering", "validation"];

export type ResolvedTeamConfig = {
  id: string;
  name: string;
  workerBase: string;
  workers: number;
  workerNames: string[];
};

function sanitizeTeamId(raw: string, fallback: string): string {
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function buildDefaultTeamConfig(data: WizardData): ResolvedTeamConfig[] {
  const selectedTeams = (data.topologyTeams || DEFAULT_TOPOLOGY_TEAMS)
    .filter((teamId) => TEAM_DEFINITIONS.some((team) => team.id === teamId));
  const teams = selectedTeams.length > 0 ? selectedTeams : [...DEFAULT_TOPOLOGY_TEAMS];
  const workersPerTeam = Math.min(6, Math.max(1, Number(data.topologyWorkersPerTeam || 2)));
  return teams.map((teamId) => {
    const def = TEAM_DEFINITIONS.find((item) => item.id === teamId)!;
    return {
      id: def.id,
      name: def.name,
      workerBase: def.workerBase,
      workers: workersPerTeam,
      workerNames: Array.from({ length: workersPerTeam }, (_, index) => `${def.workerBase}-${index + 1}`),
    };
  });
}

export function resolveTopologyConfig(data: WizardData) {
  const configuredTeams = (data.topologyTeamsConfig || [])
    .map((team, index) => {
      const fallback = `team-${index + 1}`;
      return {
        id: sanitizeTeamId(team.id || team.name || fallback, fallback),
        name: (team.name || team.id || `Team ${index + 1}`).trim(),
        workerBase: (team.workerBase || team.id || "worker").trim(),
        workers: Math.min(6, Math.max(1, Number(team.workers || 1))),
        workerNames: Array.isArray(team.workerNames)
          ? team.workerNames.map((name) => String(name || "").trim()).filter(Boolean)
          : [],
      };
    })
    .filter((team) => team.id.length > 0 && team.name.length > 0);
  const teams = (configuredTeams.length > 0 ? configuredTeams : buildDefaultTeamConfig(data)).map((team) => {
    const normalizedWorkers = Math.min(6, Math.max(1, Number(team.workers || 1)));
    const names = [...team.workerNames];
    if (names.length < normalizedWorkers) {
      for (let index = names.length; index < normalizedWorkers; index += 1) {
        names.push(`${team.workerBase}-${index + 1}`);
      }
    }
    return {
      ...team,
      workers: normalizedWorkers,
      workerNames: names.slice(0, normalizedWorkers),
    };
  });
  const includeLeads = data.topologyIncludeLeads ?? true;
  return { teams, includeLeads };
}

export function buildTopologyGraph(data: WizardData): TopologyGraph {
  const { teams, includeLeads } = resolveTopologyConfig(data);
  const model = data.model || "glm-4.7";

  return {
    orchestrator: {
      name: "orchestrator",
      model,
    },
    teams: teams.map((team) => {
      const agents: TopologyAgent[] = [];
      if (includeLeads) {
        agents.push({
          name: `${team.id}-lead`,
          role: "lead",
          model,
        });
      }
      for (let index = 0; index < team.workerNames.length; index += 1) {
        agents.push({
          name: team.workerNames[index],
          role: "worker",
          model,
        });
      }
      return {
        id: team.id,
        name: team.name,
        agents,
      };
    }),
  };
}
