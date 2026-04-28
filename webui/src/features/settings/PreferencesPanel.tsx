import { useState, useEffect } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";

export function PreferencesPanel() {
  const [inspectorDefault, setInspectorDefault] = useState("expanded");
  const [commandPreview, setCommandPreview] = useState(true);
  const [logLevel, setLogLevel] = useState("all");
  const [workspacePath, setWorkspacePath] = useState("");
  const [skillsPath, setSkillsPath] = useState("");

  useEffect(() => {
    setWorkspacePath(localStorage.getItem("workspace_path") || "");
    setSkillsPath(localStorage.getItem("skills_path") || "");
  }, []);

  return (
    <>
      <SettingsSection title="Display">
        <FormField
          label="Theme"
          type="select"
          value="light"
          disabled
          options={[{ value: "light", label: "Light" }]}
          hint="Dark mode coming in v0.9.0"
        />
        <FormField
          label="Default Inspector State"
          type="select"
          value={inspectorDefault}
          onChange={setInspectorDefault}
          options={[
            { value: "expanded", label: "Expanded" },
            { value: "collapsed", label: "Collapsed" },
          ]}
        />
        <ToggleSwitch checked={commandPreview} onChange={setCommandPreview} label="Show CLI Command Previews" />
        <FormField
          label="Log Level Filter"
          type="select"
          value={logLevel}
          onChange={setLogLevel}
          options={[
            { value: "all", label: "All" },
            { value: "info", label: "Info" },
            { value: "warn", label: "Warn" },
            { value: "error", label: "Error" },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Workspace Paths">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <span style={{fontSize:11,fontWeight:700,color:"#444748",textTransform:"uppercase",letterSpacing:"0.04em",display:"block"}}>Workspace</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:12,marginTop:4,display:"block",color:"#1c1b1b",wordBreak:"break-all"}}>{workspacePath || "—"}</span>
          </div>
          <div>
            <span style={{fontSize:11,fontWeight:700,color:"#444748",textTransform:"uppercase",letterSpacing:"0.04em",display:"block"}}>Skills Folder</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:12,marginTop:4,display:"block",color:"#1c1b1b",wordBreak:"break-all"}}>{skillsPath || "—"}</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="About">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#444748", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>MAH Version</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "#1c1b1b", marginTop: 4, display: "block" }}>0.8.0</span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#444748", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>Runtime</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "#1c1b1b", marginTop: 4, display: "block" }}>.pi/</span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#444748", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>Model</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "#1c1b1b", marginTop: 4, display: "block" }}>minimax-m2.7</span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#444748", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>UI Build</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "#1c1b1b", marginTop: 4, display: "block" }}>2026-04-25</span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
