import { useState, useEffect } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";

type ThemeMode = "light" | "dark";

export function PreferencesPanel() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [inspectorDefault, setInspectorDefault] = useState("expanded");
  const [commandPreview, setCommandPreview] = useState(true);
  const [logLevel, setLogLevel] = useState("all");
  const [workspacePath, setWorkspacePath] = useState("");
  const [skillsPath, setSkillsPath] = useState("");

  useEffect(() => {
    const storedTheme = localStorage.getItem("mah:theme");
    const currentTheme: ThemeMode = storedTheme === "light" ? "light" : "dark";
    setTheme(currentTheme);
    setWorkspacePath(localStorage.getItem("workspace_path") || "");
    setSkillsPath(localStorage.getItem("skills_path") || "");
  }, []);

  const onThemeChange = (value: string) => {
    const nextTheme: ThemeMode = value === "light" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("mah:theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.dispatchEvent(new CustomEvent("mah:theme-changed", { detail: { theme: nextTheme } }));
  };

  return (
    <>
      <SettingsSection title="Display">
        <FormField
          label="Theme"
          type="select"
          value={theme}
          onChange={onThemeChange}
          options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
          hint="Applied instantly and saved locally"
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
            <span style={{fontSize:11,fontWeight:700,color:"var(--color-text-muted)",textTransform:"uppercase",letterSpacing:"0.04em",display:"block"}}>Workspace</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:12,marginTop:4,display:"block",color:"var(--color-text)",wordBreak:"break-all"}}>{workspacePath || "—"}</span>
          </div>
          <div>
            <span style={{fontSize:11,fontWeight:700,color:"var(--color-text-muted)",textTransform:"uppercase",letterSpacing:"0.04em",display:"block"}}>Skills Folder</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:12,marginTop:4,display:"block",color:"var(--color-text)",wordBreak:"break-all"}}>{skillsPath || "—"}</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="About">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>MAH Version</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginTop: 4, display: "block" }}>0.8.0</span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>Runtime</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginTop: 4, display: "block" }}>.pi/</span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>Model</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginTop: 4, display: "block" }}>minimax-m2.7</span>
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>UI Build</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginTop: 4, display: "block" }}>2026-04-25</span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
