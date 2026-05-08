import type { WizardData } from "../BootstrapWizard";
import { buildTopologyGraph, resolveTopologyConfig } from "../topology";

type TopologyPreviewProps = {
  data: WizardData;
  onChange: (partial: Partial<WizardData>) => void;
  isAiGenerating?: boolean;
  isAiFallback?: boolean;
};

export function TopologyPreview({ data, onChange, isAiGenerating = false, isAiFallback = false }: TopologyPreviewProps) {
  const { teams, includeLeads } = resolveTopologyConfig(data);
  const topology = buildTopologyGraph(data);
  const totalAgents = topology.teams.reduce((sum, t) => sum + t.agents.length, 0);
  const updateTeams = (nextTeams: typeof teams) => {
    onChange({
      topologyTeamsConfig: nextTeams.map((team) => ({
        id: team.id,
        name: team.name,
        workerBase: team.workerBase,
        workers: team.workers,
        workerNames: team.workerNames,
      })),
    });
  };

  const addTeam = () => {
    const nextIndex = teams.length + 1;
    const nextId = `team-${nextIndex}`;
    updateTeams([
      ...teams,
      {
        id: nextId,
        name: `Team ${nextIndex}`,
        workerBase: `worker-${nextIndex}`,
        workers: 2,
        workerNames: [`worker-${nextIndex}-1`, `worker-${nextIndex}-2`],
      },
    ]);
  };

  const removeTeam = (teamId: string) => {
    if (teams.length <= 1) return;
    updateTeams(teams.filter((team) => team.id !== teamId));
  };

  const updateTeamField = (teamId: string, field: "name" | "workerBase" | "workers", value: string | number) => {
    const next = teams.map((team) => {
      if (team.id !== teamId) return team;
      if (field === "workers") {
        const nextWorkers = Math.min(6, Math.max(1, Number(value || 1)));
        const nextNames = [...team.workerNames];
        if (nextNames.length < nextWorkers) {
          for (let index = nextNames.length; index < nextWorkers; index += 1) {
            nextNames.push(`${team.workerBase}-${index + 1}`);
          }
        }
        return { ...team, workers: nextWorkers, workerNames: nextNames.slice(0, nextWorkers) };
      }
      const raw = String(value).trim();
      if (field === "name") {
        return { ...team, name: raw || team.name };
      }
      return {
        ...team,
        workerBase: raw || team.workerBase,
        workerNames: team.workerNames.map((name, index) =>
          name.startsWith(`${team.workerBase}-`) ? `${raw || team.workerBase}-${index + 1}` : name
        ),
      };
    });
    updateTeams(next);
  };

  const updateWorkerName = (teamId: string, workerIndex: number, value: string) => {
    const next = teams.map((team) => {
      if (team.id !== teamId) return team;
      const workerNames = [...team.workerNames];
      workerNames[workerIndex] = value || `${team.workerBase}-${workerIndex + 1}`;
      return { ...team, workerNames };
    });
    updateTeams(next);
  };

  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Topology Preview</h3>
      <p className="wizard-step__desc">
        Customize the generated topology before writing configuration.
      </p>
      {data.setupMode === "ai-assisted" ? (
        <>
          <label className="wizard-confirm topology-controls__toggle">
            <input
              type="checkbox"
              checked={data.topologyAutoAi ?? true}
              onChange={(event) => onChange({ topologyAutoAi: event.target.checked })}
            />
            <span>Auto (AI-assisted) define topology and naming</span>
          </label>
          {isAiFallback ? (
            <div className="wizard-info-box topology-ai-fallback">
              <span className="material-symbols-outlined">info</span>
              <span>
                {data.topologyAiError
                  ? `AI generation failed; using fallback. ${data.topologyAiError}`
                  : "AI credentials/config missing in this workspace. Using deterministic fallback generation."}
              </span>
            </div>
          ) : null}
        </>
      ) : null}
      {isAiGenerating ? (
        <div className="wizard-info-box topology-ai-working">
          <span className="material-symbols-outlined topology-ai-working__icon">autorenew</span>
          <span>{isAiFallback ? "Generating fallback topology suggestions..." : "AI is generating topology and naming suggestions..."}</span>
        </div>
      ) : null}
      <div className="topology-controls">
        <div className="topology-controls__group">
          <div className="topology-controls__header">
            <p className="topology-controls__label">Teams and workers</p>
            <button type="button" className="topology-chip topology-chip--active" onClick={addTeam}>
              + Add Team
            </button>
          </div>
          <div className="topology-config-list">
            {teams.map((team) => (
              <div key={team.id} className="topology-config-row">
                <div className="form-field">
                  <label className="form-label">Team name</label>
                  <input
                    className="form-input"
                    value={team.name}
                    onChange={(event) => updateTeamField(team.id, "name", event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Worker base</label>
                  <input
                    className="form-input"
                    value={team.workerBase}
                    placeholder="ex: planner"
                    onChange={(event) => updateTeamField(team.id, "workerBase", event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Workers</label>
                  <input
                    className="form-input topology-controls__input"
                    type="number"
                    min={1}
                    max={6}
                    value={team.workers}
                    onChange={(event) => updateTeamField(team.id, "workers", event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="topology-chip"
                  disabled={teams.length <= 1}
                  onClick={() => removeTeam(team.id)}
                >
                  Remove
                </button>
                <div className="topology-workers-list">
                  {team.workerNames.map((workerName, workerIndex) => (
                    <div className="form-field" key={`${team.id}-worker-${workerIndex}`}>
                      <label className="form-label">{`Worker ${workerIndex + 1} name`}</label>
                      <input
                        className="form-input"
                        value={workerName}
                        onChange={(event) => updateWorkerName(team.id, workerIndex, event.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <label className="wizard-confirm topology-controls__toggle">
          <input
            type="checkbox"
            checked={includeLeads}
            onChange={(event) => onChange({ topologyIncludeLeads: event.target.checked })}
          />
          <span>Include lead agent per team</span>
        </label>
      </div>
      <div className="topology-tree">
        <div className="topology-node topology-node--orchestrator">
          <div className="topology-agent topology-agent--orchestrator">
            <span className="topology-agent__name">{topology.orchestrator.name}</span>
            <span className="topology-agent__model">{topology.orchestrator.model}</span>
          </div>
        </div>
        <div className="topology-teams">
          {topology.teams.map((team) => (
            <div className="topology-team" key={team.id}>
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
          <strong>{topology.teams.length}</strong> teams
        </span>
        <span className="topology-summary__item">
          <strong>{totalAgents}</strong> agents
        </span>
      </div>
    </div>
  );
}
