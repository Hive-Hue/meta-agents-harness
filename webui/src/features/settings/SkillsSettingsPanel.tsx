import { useState, useEffect, useCallback } from "react";
import { Icon } from "../../components/ui/Icon";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";

export function SkillsSettingsPanel() {
  const [skillsPath, setSkillsPath] = useState("skills/");
  const [skillCount, setSkillCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const scanSkills = useCallback(() => {
    setLoading(true);
    fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["skills", "list", "--json"] }),
    })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.ok && payload.stdout) {
          try {
            const parsed = JSON.parse(payload.stdout);
            setSkillCount(parsed.count ?? parsed.skills?.length ?? 0);
          } catch { setSkillCount(0); }
        }
      })
      .catch(() => setSkillCount(0))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { scanSkills(); }, [scanSkills]);

  return (
    <>
      <SettingsSection title="Skills Configuration" defaultOpen={true}>
        <FormField
          label="Skills Folder Path"
          value={skillsPath}
          onChange={setSkillsPath}
          mono
          hint="Directory containing skill definitions (SKILL.md files). Relative to workspace root."
        />
        <div className="settings-field">
          <label className="settings-field__label">Skills Status</label>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {loading ? (
              <span style={{ fontSize: 13, color: "var(--color-text-dim)" }}>
                <span className="config-loading__spinner" style={{ width: 14, height: 14, borderWidth: 2, display: "inline-block", verticalAlign: "middle", marginRight: 6 }} />
                Scanning…
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#4CAF50" }}>
                <Icon name="check_circle" size={16} />
                {skillCount} skills installed
              </span>
            )}
          </div>
        </div>
        <div className="settings-btn-row">
          <button className="settings-btn" type="button" onClick={scanSkills}>
            <Icon name="refresh" size={14} />
            Scan Skills
          </button>
        </div>
      </SettingsSection>
    </>
  );
}
