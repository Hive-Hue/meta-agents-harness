import { Icon } from "../../components/ui/Icon";
import { SettingsSection } from "./SettingsSection";

const providerKeys = [
  { provider: "MiniMax", key: "sk-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", status: "Valid" },
  { provider: "ZAI", key: "zai-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", status: "Valid" },
  { provider: "OpenAI", key: "sk-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", status: "Valid" },
  { provider: "NVIDIA", key: "nv-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", status: "Valid" },
];

export function SecretsPanel() {
  return (
    <>
      <SettingsSection title="Provider API Keys" badge={String(providerKeys.length)}>
        <div className="settings-section__scroll">
        <table className="settings-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Key</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {providerKeys.map((pk) => (
              <tr key={pk.provider}>
                <td style={{ fontWeight: 600 }}>{pk.provider}</td>
                <td className="settings-table__mono">{pk.key}</td>
                <td>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#4CAF50" }}>
                    <Icon name="check_circle" size={14} /> {pk.status}
                  </span>
                </td>
                <td>
                  <button className="settings-table__action" type="button">Edit</button>
                  <button className="settings-table__action" type="button">Test</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </SettingsSection>

      <SettingsSection title="MCP Server Tokens">
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#444748", textTransform: "uppercase", letterSpacing: "0.04em" }}>Stitch Access Token</span>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 4, color: "#1c1b1b" }}>stitch-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022</div>
            <span style={{ fontSize: 11, color: "#FFC107", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
              <Icon name="warning" size={12} /> Expires periodically
            </span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#444748", textTransform: "uppercase", letterSpacing: "0.04em" }}>Google Cloud Project</span>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 4, color: "#1c1b1b" }}>12849774871511595309</div>
          </div>
        </div>
      </SettingsSection>

      <div className="settings-warning">
        <Icon name="warning" size={16} />
        <span>Secrets are stored locally. Never commit .env files to version control.</span>
      </div>
    </>
  );
}
