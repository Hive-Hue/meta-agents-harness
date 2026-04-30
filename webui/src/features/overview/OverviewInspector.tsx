import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { useNavigate } from "react-router";
import type { ConfigInfo, SessionInfo, WorkspaceInfo } from "./useWorkspaceData";
import { relativeTime } from "./useWorkspaceData";

const quickActions = [
  { icon: "rocket_launch", label: "Bootstrap", route: "/bootstrap" },
  { icon: "checklist", label: "Run Task", route: "/tasks" },
  { icon: "verified", label: "Validate All", route: "/config" },
  { icon: "sync", label: "Sync", route: "/expertise" },
];

interface OverviewInspectorProps {
  workspace: WorkspaceInfo | null;
  config: ConfigInfo | null;
  sessions: SessionInfo[];
}

export function OverviewInspector({ workspace, config, sessions }: OverviewInspectorProps) {
  const navigate = useNavigate();

  const runtimeKeys = config ? Object.keys(config.runtimes ?? {}) : [];
  const firstRuntime = runtimeKeys[0] ?? "N/A";
  const crewId = config?.crews?.[0]?.id ?? "N/A";
  const orchestratorModel = config?.catalog?.models?.orchestrator_default ?? "N/A";
  const provider = orchestratorModel.includes("/") ? orchestratorModel.split("/")[0] : orchestratorModel;

  const workspaceDetails = [
    { label: "Path", value: workspace?.path ?? "N/A" },
    { label: "Config", value: workspace?.configExists ? "meta-agents.yaml" : "Not found" },
    { label: "Runtime", value: `.${firstRuntime}/` },
    { label: "Crew", value: crewId },
    { label: "Provider", value: provider },
  ];

  const recentActivity = sessions.slice(0, 5).map((s) => ({
    event: `Session on ${s.runtime ?? "unknown"}`,
    time: relativeTime(s.last_active_at),
    icon: "check_circle",
  }));

  // Fallback if no sessions
  if (recentActivity.length === 0) {
    recentActivity.push(
      { event: "Workspace loaded", time: "just now", icon: "check_circle" },
    );
  }

  return (
    <>
      <section className="inspector__header">
        <h3>Workspace Context</h3>
      </section>
      <section className="inspector__body">
        <div className="overview-inspector__command">
          <CommandPreview context="status" command="mah status" />
        </div>

        <div className="overview-inspector__details">
          <h4 className="overview-inspector__section-title">Workspace Details</h4>
          <dl className="overview-inspector__fields">
            {workspaceDetails.map((d) => (
              <div className="overview-inspector__field" key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="overview-inspector__actions-grid">
          <h4 className="overview-inspector__section-title">Quick Actions</h4>
          <div className="overview-inspector__action-buttons">
            {quickActions.map((action) => (
              <button
                className="overview-inspector__action-btn"
                type="button"
                key={action.label}
                onClick={() => navigate(action.route)}
              >
                <Icon name={action.icon} size={16} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="overview-inspector__activity">
          <h4 className="overview-inspector__section-title">Recent Activity</h4>
          <ul className="overview-inspector__timeline">
            {recentActivity.map((item, i) => (
              <li className="overview-inspector__timeline-item" key={i}>
                <Icon name={item.icon} size={14} />
                <span className="overview-inspector__timeline-event">{item.event}</span>
                <span className="overview-inspector__timeline-time">{item.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
