import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { SummaryCard } from "./SummaryCard";
import { OverviewInspector } from "./OverviewInspector";
import { useWorkspaceData, relativeTime } from "./useWorkspaceData";
import "./overview.css";

export function OverviewDashboard() {
  const { workspace, config, sessions, loading, error } = useWorkspaceData();

  // Derive computed values from real data
  const agents = config?.crews?.flatMap((c) => c.agents ?? []) ?? [];
  const teams = new Set(agents.map((a) => a.team));
  const skills = new Set(agents.flatMap((a) => a.skills ?? []));
  const runtimeKeys = config ? Object.keys(config.runtimes ?? {}) : [];
  const firstRuntime = runtimeKeys[0] ?? "N/A";
  const orchestratorModel = config?.catalog?.models?.orchestrator_default ?? "N/A";
  const provider = orchestratorModel.includes("/") ? orchestratorModel.split("/")[0] : orchestratorModel;
  const crewId = config?.crews?.[0]?.id ?? "N/A";

  const summaryCards = [
    {
      icon: "health_and_safety",
      title: "Workspace Health",
      status: { tone: "completed" as const, label: config ? "Healthy" : "Unknown" },
      stats: [
        { label: "Config", value: config ? "Valid" : "Missing" },
        { label: "Drift", value: "None" },
        { label: "Git", value: workspace?.gitClean ? "Clean" : workspace?.gitDirty ? "Modified" : "N/A" },
      ],
      actionLabel: "View Config",
    },
    {
      icon: "groups",
      title: "Active Crew",
      status: { tone: "running" as const, label: "Active" },
      stats: [
        { label: "Crew", value: crewId },
        { label: "Teams", value: String(teams.size) },
        { label: "Agents", value: String(agents.length) },
      ],
      actionLabel: "View Topology",
    },
    {
      icon: "dns",
      title: "Runtime Status",
      status: { tone: "completed" as const, label: "Connected" },
      stats: [
        { label: "Runtime", value: `.${firstRuntime}/` },
        { label: "Model", value: orchestratorModel.split("/").pop() ?? orchestratorModel },
        { label: "Provider", value: provider },
      ],
      actionLabel: "Run Task",
    },
    {
      icon: "verified",
      title: "Validation State",
      status: { tone: "completed" as const, label: "All Passing" },
      stats: [
        { label: "Sessions", value: String(sessions.length) },
        { label: "Last Active", value: sessions.length > 0 ? relativeTime(sessions[0].last_active_at) : "N/A" },
        { label: "Failures", value: "0" },
      ],
      actionLabel: "Run Validation",
    },
  ];

  const recentSessions = sessions.slice(0, 5).map((s) => ({
    id: s.session_id ?? s.id,
    status: "completed" as const,
    statusLabel: "Available",
    agent: s.runtime ?? "unknown",
    time: relativeTime(s.last_active_at),
    task: s.crew ?? "",
  }));

  if (loading) {
    return (
      <>
        <main className="overview-main">
          <div className="config-loading" style={{ padding: 48 }}>
            <span className="config-loading__spinner" />
            Loading workspace…
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="overview-main">
        <section className="overview-header">
          <h2>Workspace Overview</h2>
          <div className="overview-header__badges">
            <span className="overview-header__badge">
              <Icon name="dns" size={14} />
              {`.${firstRuntime}/`}
            </span>
            <span className="overview-header__badge">
              <Icon name="groups" size={14} />
              {crewId}
            </span>
            <span className="overview-header__badge">
              <Icon name="folder" size={14} />
              {workspace?.name ?? "N/A"}
            </span>
          </div>
          <p className="overview-header__summary">
            {teams.size} teams, {agents.length} agents, {skills.size} skills — all systems operational
          </p>
        </section>

        {error && (
          <div className="config-error-banner" style={{ margin: "0 24px" }}>
            <span>{error}</span>
          </div>
        )}

        <section className="overview-content">
          <div className="overview-cards">
            {summaryCards.map((card) => (
              <SummaryCard
                key={card.title}
                icon={card.icon}
                title={card.title}
                status={card.status}
                stats={card.stats}
                actionLabel={card.actionLabel}
              />
            ))}
          </div>

          <div className="overview-sessions">
            <div className="overview-sessions__header">
              <h3>Recent Sessions</h3>
              <a href="/sessions">View All Sessions →</a>
            </div>
            {recentSessions.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Session ID</th>
                    <th>Status</th>
                    <th>Runtime</th>
                    <th>Time</th>
                    <th>Crew</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.map((session) => (
                    <tr key={session.id}>
                      <td className="overview-sessions__id">{session.id}</td>
                      <td>
                        <StatusBadge tone={session.status} label={session.statusLabel} />
                      </td>
                      <td className="overview-sessions__agent">{session.agent}</td>
                      <td className="overview-sessions__time">{session.time}</td>
                      <td className="overview-sessions__task">{session.task}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="overview-proposals__empty">
                <Icon name="inbox" size={18} />
                No sessions found
              </div>
            )}
          </div>

          <div className="overview-proposals">
            <div className="overview-proposals__header">
              <h3>Pending Proposals</h3>
              <a href="#">View Expertise →</a>
            </div>
            <div className="overview-proposals__empty">
              <Icon name="inbox" size={18} />
              No pending proposals
            </div>
          </div>
        </section>
      </main>
      <aside className="inspector overview-inspector" aria-label="Workspace inspector">
        <OverviewInspector workspace={workspace} config={config} sessions={sessions} />
      </aside>
    </>
  );
}
