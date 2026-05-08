import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon";

interface McpServerRow {
  name: string;
  type: "stdio" | "http";
  command: string;
  command_bin: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  headers: Record<string, string>;
  timeout_ms: number;
  enabled_in: string[];
}

function findInvalidKeyValueLines(text: string): number[] {
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .filter(({ line }) => {
      const eq = line.indexOf("=");
      return eq <= 0 || eq === line.length - 1;
    })
    .map(({ index }) => index);
}

export function McpPanel() {
  const [mcpRows, setMcpRows] = useState<McpServerRow[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"stdio" | "http">("stdio");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editing, setEditing] = useState<McpServerRow | null>(null);
  const [editType, setEditType] = useState<"stdio" | "http">("stdio");
  const [editCommand, setEditCommand] = useState("");
  const [editArgs, setEditArgs] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editEnv, setEditEnv] = useState("");
  const [editHeaders, setEditHeaders] = useState("");
  const invalidEnvLines = findInvalidKeyValueLines(editEnv);
  const invalidHeaderLines = findInvalidKeyValueLines(editHeaders);
  const hasEditValidationError =
    (editType === "stdio" && invalidEnvLines.length > 0) ||
    (editType === "http" && invalidHeaderLines.length > 0);

  const runMah = async (args: string[]) => {
    const resp = await fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const payload = await resp.json();
    if (!resp.ok || !payload?.ok) {
      throw new Error(payload?.stderr || payload?.error || "Command failed");
    }
    return payload.stdout ? JSON.parse(payload.stdout) : {};
  };

  const loadMcp = async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const data = await runMah(["mcp", "list", "--json"]);
      setMcpRows(Array.isArray(data.servers) ? data.servers : []);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : String(error));
      setMcpRows([]);
    } finally {
      setMcpLoading(false);
    }
  };

  useEffect(() => {
    void loadMcp();
  }, []);

  return (
    <>
      <div className="settings-btn-row">
        <button
          className="settings-btn settings-btn--primary"
          type="button"
          disabled={isSyncing}
          onClick={async () => {
            setIsSyncing(true);
            try {
              await runMah(["mcp", "sync", "--json"]);
              await loadMcp();
            } catch (error) {
              alert(error instanceof Error ? error.message : String(error));
            } finally {
              setIsSyncing(false);
            }
          }}
        >
          <Icon name="sync" size={14} />
          {isSyncing ? "Syncing..." : "Sync Runtime Configs"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
        <input className="settings-field__input settings-field__input--mono" placeholder="name (e.g. playwright)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select className="settings-field__input settings-field__input--mono" value={newType} onChange={(e) => setNewType(e.target.value as "stdio" | "http") }>
          <option value="stdio">stdio</option>
          <option value="http">http</option>
        </select>
        {newType === "stdio" ? (
          <input className="settings-field__input settings-field__input--mono" placeholder="command (e.g. npx)" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} />
        ) : (
          <input className="settings-field__input settings-field__input--mono" placeholder="url (https://...)" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
        )}
        <button
          className="settings-btn"
          type="button"
          onClick={async () => {
            try {
              const name = newName.trim();
              if (!name) {
                alert("Name is required.");
                return;
              }
              const args = ["mcp", "add", name, "--type", newType];
              if (newType === "stdio") {
                if (!newCommand.trim()) {
                  alert("Command is required for stdio MCP.");
                  return;
                }
                args.push("--command", newCommand.trim());
                const splitArgs = newArgs.split(/\s+/).map((item) => item.trim()).filter(Boolean);
                for (const arg of splitArgs) args.push("--arg", arg);
              } else {
                if (!newUrl.trim()) {
                  alert("URL is required for HTTP MCP.");
                  return;
                }
                args.push("--url", newUrl.trim());
              }
              await runMah([...args, "--json"]);
              setNewName("");
              setNewType("stdio");
              setNewCommand("");
              setNewArgs("");
              setNewUrl("");
              await loadMcp();
            } catch (error) {
              alert(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          <Icon name="add" size={14} />
          Add
        </button>
      </div>

      {newType === "stdio" && (
        <input
          className="settings-field__input settings-field__input--mono"
          placeholder="args (space separated, optional)"
          value={newArgs}
          onChange={(e) => setNewArgs(e.target.value)}
        />
      )}

      <div className="settings-section__scroll" style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "0.375rem" }}>
        <table className="settings-table">
          <thead>
            <tr><th>Server</th><th>Type</th><th>Command</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {mcpLoading && (
              <tr><td colSpan={5} style={{ color: "var(--color-text-dim)" }}>Loading MCP registry...</td></tr>
            )}
            {!mcpLoading && mcpError && (
              <tr><td colSpan={5} style={{ color: "var(--color-error)" }}>{mcpError}</td></tr>
            )}
            {!mcpLoading && !mcpError && mcpRows.length === 0 && (
              <tr><td colSpan={5} style={{ color: "var(--color-text-dim)" }}>No MCP servers configured.</td></tr>
            )}
            {!mcpLoading && !mcpError && mcpRows.map((row) => (
              <tr key={row.name}>
                <td style={{ fontWeight: 600 }}>{row.name}</td>
                <td><span className="settings-table__tag">{row.type}</span></td>
                <td className="settings-table__mono">{row.command}</td>
                <td>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-text-dim)" }}>
                    <Icon name="check_circle" size={14} />
                    {row.enabled_in.length > 0 ? `Enabled in: ${row.enabled_in.join(", ")}` : "Enabled by default"}
                  </span>
                </td>
                <td>
                  <button
                    className="settings-table__action"
                    type="button"
                    onClick={() => {
                      setEditing(row);
                      setEditType(row.type);
                      setEditCommand(row.command_bin || "");
                      setEditArgs((row.args || []).join(" "));
                      setEditUrl(row.url || "");
                      setEditEnv(
                        Object.entries(row.env || {})
                          .map(([k, v]) => `${k}=${v}`)
                          .join("\n"),
                      );
                      setEditHeaders(
                        Object.entries(row.headers || {})
                          .map(([k, v]) => `${k}=${v}`)
                          .join("\n"),
                      );
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="settings-table__action"
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Remove MCP server '${row.name}'?`)) return;
                      try {
                        await runMah(["mcp", "remove", row.name, "--json"]);
                        await loadMcp();
                      } catch (error) {
                        alert(error instanceof Error ? error.message : String(error));
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit MCP: {editing.name}</h3>
              <button type="button" className="icon-button" onClick={() => setEditing(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <select className="settings-field__input settings-field__input--mono" value={editType} onChange={(e) => setEditType(e.target.value as "stdio" | "http") }>
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
              {editType === "stdio" ? (
                <>
                  <input className="settings-field__input settings-field__input--mono" placeholder="command" value={editCommand} onChange={(e) => setEditCommand(e.target.value)} />
                  <input className="settings-field__input settings-field__input--mono" placeholder="args (space separated)" value={editArgs} onChange={(e) => setEditArgs(e.target.value)} />
                  <textarea className="settings-field__textarea settings-field__input--mono" rows={4} placeholder={"env entries (KEY=VALUE)\nOne per line"} value={editEnv} onChange={(e) => setEditEnv(e.target.value)} />
                  {invalidEnvLines.length > 0 && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)" }}>
                      Invalid env lines: {invalidEnvLines.join(", ")}. Use KEY=VALUE.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <input className="settings-field__input settings-field__input--mono" placeholder="url (https://...)" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
                  <textarea className="settings-field__textarea settings-field__input--mono" rows={4} placeholder={"header entries (KEY=VALUE)\nOne per line"} value={editHeaders} onChange={(e) => setEditHeaders(e.target.value)} />
                  {invalidHeaderLines.length > 0 && (
                    <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)" }}>
                      Invalid header lines: {invalidHeaderLines.join(", ")}. Use KEY=VALUE.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="settings-btn-row" style={{ marginTop: 12 }}>
              <button className="settings-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="settings-btn settings-btn--primary"
                type="button"
                disabled={hasEditValidationError}
                onClick={async () => {
                  try {
                    const args = ["mcp", "update", editing.name, "--type", editType];
                    if (editType === "stdio") {
                      if (!editCommand.trim()) {
                        alert("Command is required for stdio MCP.");
                        return;
                      }
                      args.push("--command", editCommand.trim());
                      const splitArgs = editArgs.split(/\s+/).map((item) => item.trim()).filter(Boolean);
                      for (const arg of splitArgs) args.push("--arg", arg);
                      const envLines = editEnv.split("\n").map((line) => line.trim()).filter(Boolean);
                      for (const line of envLines) args.push("--env", line);
                    } else {
                      if (!editUrl.trim()) {
                        alert("URL is required for HTTP MCP.");
                        return;
                      }
                      args.push("--url", editUrl.trim());
                      const headerLines = editHeaders.split("\n").map((line) => line.trim()).filter(Boolean);
                      for (const line of headerLines) args.push("--header", line);
                    }
                    await runMah([...args, "--json"]);
                    setEditing(null);
                    await loadMcp();
                  } catch (error) {
                    alert(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
