import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";
import { useWorkspace } from "../../contexts/WorkspaceContext";

export function WorkspacePanel() {
  const [desc, setDesc] = useState("Multi-agent orchestration harness");
  const [crew, setCrew] = useState("dev");
  const [runtime, setRuntime] = useState(".pi/");
  const [syncInterval, setSyncInterval] = useState("30");
  const [syncOnStartup, setSyncOnStartup] = useState(true);
  const [validateOnSync, setValidateOnSync] = useState(true);
  const { workspacePath, setWorkspacePath } = useWorkspace();
  const [workspacePathDraft, setWorkspacePathDraft] = useState(workspacePath);

  useEffect(() => {
    setWorkspacePathDraft(workspacePath);
  }, [workspacePath]);

  const applyWorkspacePath = () => {
    const nextPath = workspacePathDraft.trim() || ".";
    if (nextPath !== workspacePath) {
      setWorkspacePath(nextPath);
    }
  };

  const handleBrowse = async () => {
    try {
      if ("showDirectoryPicker" in window) {
        const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<{ name: string }> }).showDirectoryPicker();
        setWorkspacePath(dirHandle.name);
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.webkitdirectory = true;
        input.multiple = false;
        input.style.display = "none";
        input.onchange = (e) => {
          e.preventDefault();
          const files = (e.target as HTMLInputElement).files;
          if (files && files[0]) {
            const path = files[0].webkitRelativePath || files[0].name;
            const dirPath = path.split("/")[0] || ".";
            setWorkspacePath(dirPath);
          }
          // Clean up the input element after use
          input.remove();
        };
        document.body.appendChild(input);
        input.click();
      }
    } catch {
      // User cancelled or unsupported
    }
  };

  return (
    <>
      <SettingsSection title="Project & Configuration">
        <FormField label="Project Name" value="meta-agents-harness" disabled />
        <div className="settings-field">
          <label className="settings-field__label">Workspace Path</label>
          <div className="settings-field__row">
            <input
              className="settings-field__input settings-field__input--mono"
              type="text"
              value={workspacePathDraft}
              onChange={(e) => setWorkspacePathDraft(e.target.value)}
              onBlur={applyWorkspacePath}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyWorkspacePath();
                }
              }}
              placeholder="Enter or browse for workspace path"
              style={{ flex: 1 }}
            />
            <button className="settings-btn" type="button" onClick={handleBrowse} style={{ flexShrink: 0 }}>
              <Icon name="folder_open" size={14} />
              Browse
            </button>
          </div>
          <span className="settings-field__hint">Root directory containing meta-agents.yaml</span>
          <span className="settings-field__hint" style={{ color: "#94a3b8", fontSize: 11 }}>
            { !("showDirectoryPicker" in window) && "Directory picker requires Chrome. This browser shows file input dialog." }
          </span>
        </div>
        <FormField label="Description" type="textarea" value={desc} onChange={setDesc} rows={2} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FormField label="Created" value="2025-01-15" disabled />
          <FormField label="Last Modified" value="2026-04-25" disabled />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FormField
            label="Default Crew"
            type="select"
            value={crew}
            onChange={setCrew}
            options={[{ value: "dev", label: "dev" }, { value: "staging", label: "staging" }, { value: "prod", label: "prod" }]}
          />
          <FormField
            label="Default Runtime"
            type="select"
            value={runtime}
            onChange={setRuntime}
            options={[
              { value: ".pi/", label: ".pi/" },
              { value: ".claude/", label: ".claude/" },
              { value: ".opencode/", label: ".opencode/" },
              { value: ".hermes/", label: ".hermes/" },
              { value: ".codex/", label: ".codex/" },
              { value: ".kilo/", label: ".kilo/" },
            ]}
          />
        </div>
        <FormField label="Auto-sync Interval" type="number" value={syncInterval} onChange={setSyncInterval} min={10} max={300} suffix="seconds" />
        <ToggleSwitch checked={syncOnStartup} onChange={setSyncOnStartup} label="Sync on Startup" />
        <ToggleSwitch checked={validateOnSync} onChange={setValidateOnSync} label="Validate on Sync" />
      </SettingsSection>

      <SettingsSection title="Workspace Health">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#4CAF50" }}>
            <Icon name="check_circle" size={16} /> Config Valid
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#4CAF50" }}>
            <Icon name="check_circle" size={16} /> Git Clean
          </span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Last validated: 2 minutes ago</span>
        </div>
        <div className="settings-btn-row">
          <button className="settings-btn" type="button">
            <Icon name="verified" size={14} /> Validate Now
          </button>
          <button className="settings-btn settings-btn--primary" type="button">
            <Icon name="sync" size={14} /> Sync All
          </button>
        </div>
      </SettingsSection>
    </>
  );
}
