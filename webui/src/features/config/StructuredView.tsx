import { useConfig } from "./useConfigStore";
import { ConfigSection } from "./ConfigSection";
import { DomainProfileEditor } from "./DomainProfileEditor";
import { AgentTree } from "./AgentTree";

export function StructuredView() {
  const { config, updateConfig } = useConfig();

  const availableModels = config?.catalog?.available_models ?? [];
  const availableModelOptions = availableModels.length > 0
    ? availableModels.map((m) => ({ value: `${m.provider}/${m.model_id}`, label: m.display_name || `${m.provider}/${m.model_id}` }))
    : [...new Set(Object.values(config?.catalog?.models ?? {}).concat(Object.values(config?.catalog?.model_fallbacks ?? {}).flat()))].map((m) => ({ value: m, label: m }));

  const runtimes = Object.entries(config?.runtimes ?? {}).map(([name, rt]) => {
    const overrides = rt?.model_overrides ?? {};
    return {
      name,
      hasOverrides: Object.keys(overrides).length > 0,
      overrideCount: Object.keys(overrides).length,
    };
  });

  const catalogModels = Object.entries(config?.catalog?.models ?? {}).map(([role, model]) => ({
    role,
    model,
    fallbackCount: config?.catalog?.model_fallbacks?.[role]?.length ?? 0,
  }));

  const profileCount = Object.keys(config?.domain_profiles ?? {}).length;
  const agents = config?.crews?.flatMap((c) => c.agents ?? []) ?? [];
  const agentLabel = agents.length === 1 ? "1 agent" : `${agents.length} agents`;

  return (
    <div className="structured-view">
      <ConfigSection title="Project Info" defaultOpen={true}>
        <div className="config-form-row">
          <div className="form-field">
            <label className="form-label" htmlFor="cfg-project-name">Project Name</label>
            <input id="cfg-project-name" className="form-input" type="text" defaultValue={config?.name ?? ""} />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="cfg-desc">Description</label>
            <input id="cfg-desc" className="form-input" type="text" defaultValue={config?.description ?? ""} />
          </div>
        </div>
      </ConfigSection>

      <ConfigSection title="Runtimes" badge={String(runtimes.length)} defaultOpen={true}>
        <table className="config-table">
          <thead>
            <tr>
              <th>Runtime</th>
              <th>Has Overrides</th>
              <th>Override Count</th>
            </tr>
          </thead>
          <tbody>
            {runtimes.map((rt) => (
              <tr key={rt.name}>
                <td className="config-table__mono">{rt.name}</td>
                <td>
                  <span className={"status-badge status-badge--" + (rt.hasOverrides ? "running" : "completed")}>
                    {rt.hasOverrides ? "Yes" : "No"}
                  </span>
                </td>
                <td>{rt.overrideCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ConfigSection>

      <ConfigSection title="Catalog — Models" badge={String(catalogModels.length)} defaultOpen={true}>
        <table className="config-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Model</th>
              <th>Fallbacks</th>
            </tr>
          </thead>
          <tbody>
            {catalogModels.map((m) => (
              <tr key={m.role}>
                <td className="config-table__mono">{m.role}</td>
                <td>
                  <select
                    className="config-table__mono"
                    style={{ fontSize: 12, padding: '2px 6px', border: '1px solid var(--color-border-subtle)', borderRadius: 2, background: 'var(--color-surface)', fontFamily: 'var(--font-mono)' }}
                    value={m.model}
                    onChange={(e) => {
                      const next = { ...config?.catalog?.models, [m.role]: e.target.value };
                      updateConfig({ catalog: { ...config?.catalog, models: next as Record<string, string> } });
                    }}
                  >
                    {availableModelOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </td>
                <td>{m.fallbackCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ConfigSection>

      <ConfigSection title="Domain Profiles" badge={String(profileCount)} defaultOpen={false}>
        <DomainProfileEditor />
      </ConfigSection>

      <ConfigSection title="Crews &amp; Agents" badge={agentLabel} defaultOpen={true}>
        <AgentTree />
      </ConfigSection>
    </div>
  );
}
