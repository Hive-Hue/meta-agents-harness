import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { useConfig } from "../config/useConfigStore";

interface CrewTeam { name: string; count: number; }

export function CrewsPanel() {
  const { config } = useConfig();
  const crewList: CrewTeam[] = (config?.crews ?? []).map((crew: { display_name?: string; id: string; agents?: unknown[] }) => ({
    name: crew.display_name || crew.id,
    count: crew.agents?.length ?? 0,
  }));
  return (
    <>
      <SettingsSection title="Active Crew">
        <FormField label="Crew" type="select" value="dev" disabled options={[{ value: "dev", label: "dev" }]} />
        <FormField label="Mission" type="textarea" value="Finish bounded v0.8.0 Context Memory for Meta Agents Harness, closing runtime visibility, proposal governance, and assistant-state gaps." disabled rows={3} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FormField label="Sprint" value="v0.8.0-context-memory" disabled mono />
          <FormField label="Mode" value="spec-bound-milestone-driven" disabled mono />
        </div>
      </SettingsSection>

      {/* <SettingsSection title="Crew Runtimes">
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>No runtime overrides configured for this crew.</p>
      </SettingsSection> */}

      <SettingsSection title="Teams" badge={String(crewList.length)}>
        <ul className="settings-teams-list">
          {crewList.map((t: CrewTeam) => (
            <li className="settings-team-item" key={t.name}>
              <span className="settings-team-item__name">{t.name}</span>
              <span className="settings-team-item__count">{t.count} agents</span>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </>
  );
}
