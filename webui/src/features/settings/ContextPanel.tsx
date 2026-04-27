import { useState } from "react";
import { SettingsSection } from "./SettingsSection";
import { FormField } from "./FormField";
import { ToggleSwitch } from "./ToggleSwitch";

export function ContextPanel() {
  const [budget, setBudget] = useState("2048");
  const [autoIndex, setAutoIndex] = useState(true);
  const [autoPromote, setAutoPromote] = useState(false);

  return (
    <>
      <SettingsSection title="Context Memory">
        <FormField label="Operational Memory Path" value=".mah/context/operational/" mono copyable disabled />
        <FormField label="Proposal Path" value=".mah/context/proposals/" mono copyable disabled />
        <FormField label="Max Retrieval Budget" type="number" value={budget} onChange={setBudget} min={256} max={8192} suffix="tokens" />
        <ToggleSwitch checked={autoIndex} onChange={setAutoIndex} label="Auto-index on change" />
        <ToggleSwitch checked={autoPromote} onChange={setAutoPromote} label="Auto-promote proposals" />
        <FormField label="Index Format" value="markdown + qmd" disabled />
      </SettingsSection>

      <SettingsSection title="Corpus Stats">
        <div className="settings-stats">
          <div className="settings-stat">
            <span className="settings-stat__label">Total Documents</span>
            <span className="settings-stat__value">14</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Operational</span>
            <span className="settings-stat__value">8</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Proposed</span>
            <span className="settings-stat__value">3</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Excluded</span>
            <span className="settings-stat__value">3</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat__label">Last Indexed</span>
            <span className="settings-stat__value" style={{ fontSize: 12 }}>2026-04-25 21:30</span>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
