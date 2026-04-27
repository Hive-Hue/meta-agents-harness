import { Icon } from "../../components/ui/Icon";

export type SettingsTab = "workspace" | "runtimes" | "crews" | "models" | "skills" | "expertise" | "context" | "secrets" | "preferences";

const tabs: { id: SettingsTab; icon: string; label: string }[] = [
  { id: "workspace", icon: "folder", label: "Workspace" },
  { id: "runtimes", icon: "terminal", label: "Runtimes" },
  { id: "crews", icon: "groups", label: "Crews" },
  { id: "models", icon: "smart_toy", label: "Models" },
  { id: "skills", icon: "build", label: "Skills" },
  { id: "expertise", icon: "psychology", label: "Expertise" },
  { id: "context", icon: "database", label: "Context Memory" },
  { id: "secrets", icon: "key", label: "Secrets" },
  { id: "preferences", icon: "tune", label: "Preferences" },
];

type SettingsSidebarProps = {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
};

export function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  return (
    <div className="settings-sidebar">
      {tabs.map((tab) => (
        <button
          className={"settings-sidebar__tab" + (activeTab === tab.id ? " settings-sidebar__tab--active" : "")}
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
        >
          <Icon name={tab.icon} size={18} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
