import { useConfig } from "../config/useConfigStore";
import { Icon } from "../../components/ui/Icon";
import { SettingsSection } from "./SettingsSection";

interface RuntimeRow {
  name: string;
  enabled: boolean;
  defaultModel: string;
  override: string;
}

interface ModelRow {
  ref: string;
  model: string;
  fallbacks: string;
}

const FALLBACK_RUNTIMES: RuntimeRow[] = [
  { name: "pi", enabled: true, defaultModel: "—", override: "—" },
  { name: "claude", enabled: true, defaultModel: "—", override: "—" },
  { name: "opencode", enabled: true, defaultModel: "—", override: "—" },
  { name: "hermes", enabled: true, defaultModel: "—", override: "—" },
  { name: "kilo", enabled: true, defaultModel: "minimax-m2.7", override: "glm-5.1 (lead)" },
  { name: "codex", enabled: true, defaultModel: "gpt-5.4-mini", override: "gpt-5.3-codex (worker)" },
];

const FALLBACK_MODELS: ModelRow[] = [
  { ref: "orchestrator_default", model: "minimax-coding-plan/MiniMax-M2.7", fallbacks: "nemotron-3-super, glm-5, minimax-m2.7, gpt-5.4-mini" },
  { ref: "lead_default", model: "zai-coding-plan/glm-5", fallbacks: "—" },
  { ref: "worker_default", model: "zai-coding-plan/glm-5", fallbacks: "—" },
  { ref: "qa_default", model: "openai-codex/gpt-5.4-mini", fallbacks: "—" },
];

export function RuntimesPanel() {
  const { config } = useConfig();

  const runtimeRows: RuntimeRow[] = (Object.keys(config?.runtimes ?? {}).length > 0
    ? Object.entries(config!.runtimes!).map(([name, rt]) => ({
        name,
        enabled: true,
        defaultModel: "—",
        override: String(Object.values(rt?.model_overrides ?? {})[0] ?? "—"),
      }))
    : FALLBACK_RUNTIMES) as RuntimeRow[];

  const modelRows: ModelRow[] = (config?.catalog?.models
    ? Object.entries(config.catalog.models).map(([ref, modelStr]) => ({
        ref,
        model: String(modelStr),
        fallbacks: "—",
      }))
    : FALLBACK_MODELS) as ModelRow[];

  return (
    <>
      <SettingsSection title="Enabled Runtimes" badge={String(runtimeRows.length)}>
        <div className="settings-section__scroll">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Runtime</th>
                <th>Status</th>
                <th>Default Model</th>
                <th>Override</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runtimeRows.map((rt) => (
                <tr key={rt.name}>
                  <td className="settings-table__mono">{rt.name}</td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#4CAF50" }}>
                      <Icon name="check_circle" size={14} /> Enabled
                    </span>
                  </td>
                  <td className="settings-table__mono">{rt.defaultModel}</td>
                  <td className="settings-table__mono">{rt.override}</td>
                  <td><button className="settings-table__action" type="button">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <SettingsSection title="Model Catalog" badge={String(modelRows.length)}>
        <div className="settings-section__scroll">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Model</th>
                <th>Fallbacks</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((m) => (
                <tr key={m.ref}>
                  <td className="settings-table__mono">{m.ref}</td>
                  <td className="settings-table__mono">{m.model}</td>
                  <td style={{ fontSize: 11, color: "#444748" }}>{m.fallbacks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
    </>
  );
}
