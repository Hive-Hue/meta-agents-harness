import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { SettingsSection } from "./SettingsSection";

interface ProviderSecretRow {
  id: string;
  provider: string;
  envVar: string;
  configured: boolean;
  masked: string;
  status: string;
}

export function SecretsPanel() {
  const [providerKeys, setProviderKeys] = useState<ProviderSecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/secrets");
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || "failed to load secrets");
        return;
      }
      setProviderKeys(Array.isArray(data.providers) ? data.providers : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const saveProviderKey = useCallback(async (providerId: string, apiKey: string) => {
    setSavingProvider(providerId);
    setError(null);
    try {
      const resp = await fetch("/api/mah/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, apiKey }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || "failed to save provider key");
        return;
      }
      setEditingProvider(null);
      setDraftKey("");
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProvider(null);
    }
  }, [loadSecrets]);

  return (
    <>
      <SettingsSection title="Provider API Keys" badge={String(providerKeys.length)}>
        {error && (
          <p style={{ marginTop: 0, marginBottom: 10, color: "#B91C1C", fontSize: 12 }}>{error}</p>
        )}
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
              {loading && (
                <tr>
                  <td colSpan={4} style={{ color: "#6b7280", fontSize: 13 }}>Loading provider keys...</td>
                </tr>
              )}
              {providerKeys.map((pk) => (
                <tr key={pk.id}>
                  <td style={{ fontWeight: 600 }}>{pk.provider}</td>
                  <td className="settings-table__mono">
                    {editingProvider === pk.id ? (
                      <input
                        type="password"
                        value={draftKey}
                        onChange={(e) => setDraftKey(e.target.value)}
                        placeholder={pk.configured ? "Enter new key to rotate" : "Enter API key"}
                        style={{
                          width: "100%",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                      />
                    ) : (
                      pk.masked
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: pk.configured ? "#4CAF50" : "#f59e0b",
                      }}
                    >
                      <Icon name={pk.configured ? "check_circle" : "warning"} size={14} /> {pk.status}
                    </span>
                  </td>
                  <td>
                    {editingProvider === pk.id ? (
                      <>
                        <button
                          className="settings-table__action"
                          type="button"
                          onClick={() => void saveProviderKey(pk.id, draftKey)}
                          disabled={savingProvider === pk.id}
                        >
                          Save
                        </button>
                        <button
                          className="settings-table__action"
                          type="button"
                          onClick={() => {
                            setEditingProvider(null);
                            setDraftKey("");
                          }}
                          disabled={savingProvider === pk.id}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="settings-table__action"
                          type="button"
                          onClick={() => {
                            setEditingProvider(pk.id);
                            setDraftKey("");
                          }}
                        >
                          {pk.configured ? "Rotate" : "Add"}
                        </button>
                        {pk.configured && (
                          <button
                            className="settings-table__action"
                            type="button"
                            onClick={() => void saveProviderKey(pk.id, "")}
                            disabled={savingProvider === pk.id}
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <div className="settings-warning">
        <Icon name="warning" size={16} />
        <span>Secrets are stored in local workspace .env. Values are masked and never returned in full.</span>
      </div>
    </>
  );
}
