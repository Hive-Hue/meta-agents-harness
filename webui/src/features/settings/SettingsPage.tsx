import { useState } from "react";
import { ConfigProvider } from "../config/useConfigStore";
import { SettingsSidebar, type SettingsTab } from "./SettingsSidebar";
import { WorkspacePanel } from "./WorkspacePanel";
import { RuntimesPanel } from "./RuntimesPanel";
import { McpPanel } from "./McpPanel";
import { CrewsPanel } from "./CrewsPanel";
import { ExpertisePanel } from "./ExpertisePanel";
import { ContextPanel } from "./ContextPanel";
import { SyncReview } from "./SyncReview";
import { SecretsPanel } from "./SecretsPanel";
import { PreferencesPanel } from "./PreferencesPanel";
import { ModelsPanel } from "./ModelsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";
import { HermesGatewaySettingsPanel } from "./HermesGatewaySettingsPanel";
import "./settings.css";

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("workspace");

  const renderPanel = () => {
    switch (activeTab) {
      case "workspace": return <WorkspacePanel />;
      case "runtimes": return <RuntimesPanel />;
      case "mcp": return <McpPanel />;
      case "crews": return <CrewsPanel />;
      case "expertise": return <ExpertisePanel />;
      case "models": return <ModelsPanel />;
      case "skills": return <SkillsSettingsPanel />;
      case "context": return <ContextPanel />;
      case "sync": return <SyncReview />;
      case "hermes": return <HermesGatewaySettingsPanel />;
      case "secrets": return <SecretsPanel />;
      case "preferences": return <PreferencesPanel />;
    }
  };

  return (
    <div className="settings-page">
      <section className="settings-header">
        <h2>Settings</h2>
        <p className="settings-header__subtitle">
          Configure workspace, runtimes, crews, expertise, and preferences
        </p>
      </section>
      <ConfigProvider>
        <div className="settings-body">
          <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <section className="settings-panel">
            {renderPanel()}
          </section>
        </div>
      </ConfigProvider>
    </div>
  );
}
