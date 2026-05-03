import { useState, useEffect } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";
import {
  DEFAULT_AGENTIC_ESTIMATION_SETTINGS,
  getAgenticEstimationSettings,
  setAgenticEstimationSettings,
} from "../tasks/agenticEstimationSettings";

type ThemeMode = "light" | "dark";

export function PreferencesPanel() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [inspectorDefault, setInspectorDefault] = useState("expanded");
  const [commandPreview, setCommandPreview] = useState(true);
  const [logLevel, setLogLevel] = useState("all");
  const [workspacePath, setWorkspacePath] = useState("");
  const [skillsPath, setSkillsPath] = useState("");
  const [agentic, setAgentic] = useState(DEFAULT_AGENTIC_ESTIMATION_SETTINGS);

  useEffect(() => {
    const storedTheme = localStorage.getItem("mah:theme");
    const currentTheme: ThemeMode = storedTheme === "light" ? "light" : "dark";
    setTheme(currentTheme);
    setWorkspacePath(localStorage.getItem("workspace_path") || "");
    setSkillsPath(localStorage.getItem("skills_path") || "");
    setAgentic(getAgenticEstimationSettings());
  }, []);

  const updateAgentic = (field: keyof typeof agentic, value: string) => {
    const next = {
      ...agentic,
      [field]: Number(value),
    };
    setAgentic(next);
    setAgenticEstimationSettings(next);
  };

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

      <SettingsSection title="Agentic Estimation">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <FormField label="Base Minutes" type="number" value={String(agentic.baseMinutes)} onChange={(v) => updateAgentic("baseMinutes", v)} />
          <FormField label="Minutes/Dependency" type="number" value={String(agentic.dependencyMinutes)} onChange={(v) => updateAgentic("dependencyMinutes", v)} />
          <FormField label="Minutes/Word" type="number" value={String(agentic.summaryWordMinutes)} onChange={(v) => updateAgentic("summaryWordMinutes", v)} />
          <FormField label="High Priority Minutes" type="number" value={String(agentic.priorityHighMinutes)} onChange={(v) => updateAgentic("priorityHighMinutes", v)} />
          <FormField label="Medium Priority Minutes" type="number" value={String(agentic.priorityMediumMinutes)} onChange={(v) => updateAgentic("priorityMediumMinutes", v)} />
          <FormField label="Token Base" type="number" value={String(agentic.tokenBase)} onChange={(v) => updateAgentic("tokenBase", v)} />
          <FormField label="Tokens/Minute" type="number" value={String(agentic.tokenPerMinute)} onChange={(v) => updateAgentic("tokenPerMinute", v)} />
          <FormField label="Tokens/Dependency" type="number" value={String(agentic.tokenPerDependency)} onChange={(v) => updateAgentic("tokenPerDependency", v)} />
          <FormField label="Tokens/Word" type="number" value={String(agentic.tokenPerWord)} onChange={(v) => updateAgentic("tokenPerWord", v)} />
        </div>
      </SettingsSection>
    </>
  );
}
