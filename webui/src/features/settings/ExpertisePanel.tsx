import { useState } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";

export function ExpertisePanel() {
  const [autoSeed, setAutoSeed] = useState(true);
  const [retention, setRetention] = useState("30");
  const [validatedThreshold, setValidatedThreshold] = useState("0.6");
  const [restrictedThreshold, setRestrictedThreshold] = useState("0.3");
  const [governanceCycle, setGovernanceCycle] = useState("weekly");

  return (
    <>
      <SettingsSection title="Expertise Governance">
        <ToggleSwitch checked={autoSeed} onChange={setAutoSeed} label="Auto-seed on crew creation" />
        <FormField label="Evidence Retention Window" type="number" value={retention} onChange={setRetention} min={1} max={365} suffix="days" />
        <FormField label="Confidence Threshold (Validated)" type="number" value={validatedThreshold} onChange={setValidatedThreshold} min={0} max={1} suffix="0-1" />
        <FormField label="Confidence Threshold (Restricted)" type="number" value={restrictedThreshold} onChange={setRestrictedThreshold} min={0} max={1} suffix="0-1" />
        <FormField
          label="Governance Cycle"
          type="select"
          value={governanceCycle}
          onChange={setGovernanceCycle}
          options={[
            { value: "weekly", label: "Weekly" },
            { value: "biweekly", label: "Biweekly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
      </SettingsSection>

      <SettingsSection title="Catalog Stats">
        <div className="settings-stats">
          <div className="settings-stat">
            <span className="settings-stat__label">Total Agents</span>
            <span className="settings-stat__value">10</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Validated</span>
            <span className="settings-stat__value">10</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Experimental</span>
            <span className="settings-stat__value">0</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Restricted</span>
            <span className="settings-stat__value">0</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Evidence Events</span>
            <span className="settings-stat__value">47</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Last Sync</span>
            <span className="settings-stat__value" style={{ fontSize: 13 }}>2026-04-25</span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
