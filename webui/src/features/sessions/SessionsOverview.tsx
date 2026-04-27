import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";

const sessions = [
  {
    id: "ses_01j4f82x",
    runtime: ".pi/",
    crew: "DataPipelineCrew",
    agent: "PostgresExtractor",
    status: "Running",
    statusTone: "running" as const,
    started: "10:42 AM",
    updated: "Just now",
    task: "Extracting public.users...",
    selected: true,
  },
  {
    id: "ses_01j4e99z",
    runtime: ".claude/",
    crew: "ResearchOps",
    agent: "SummaryWriter",
    status: "Completed",
    statusTone: "completed" as const,
    started: "09:15 AM",
    updated: "09:28 AM",
    task: "Report generated",
    selected: false,
  },
  {
    id: "ses_01j4d55b",
    runtime: ".local/",
    crew: "DevBuildTest",
    agent: "LinterAgent",
    status: "Failed",
    statusTone: "failed" as const,
    started: "08:00 AM",
    updated: "08:02 AM",
    task: "ESLint Exit Code 1",
    selected: false,
  },
];

export function SessionsOverview() {
  return (
    <>
      <main className="sessions-main">
        <section className="screen-header">
          <div>
            <h2>Active Sessions</h2>
            <div className="screen-header__meta">
              <span className="live-summary">
                <span className="live-summary__dot" aria-hidden="true" />
                14 running
              </span>
              <span className="screen-header__separator" aria-hidden="true" />
              <span className="screen-header__clusters">
                3 clusters active: prod-cluster-1, staging-us-east, dev-local
              </span>
            </div>
          </div>

          <CommandPreview context="prod-cluster-1" command="mah sessions list" />
        </section>

        <section className="sessions-main__content" aria-label="Sessions table">
          <div className="sessions-table">
            <table>
              <thead>
                <tr>
                  <th aria-label="Selected session" />
                  <th>Session ID</th>
                  <th>Runtime / Crew</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Time Activity</th>
                  <th>Task State</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr className={session.selected ? "is-selected" : ""} key={session.id}>
                    <td>
                      <Icon
                        name={session.selected ? "radio_button_checked" : "radio_button_unchecked"}
                        className={session.selected ? "selection-icon selection-icon--active" : "selection-icon"}
                        size={18}
                        filled={session.selected}
                      />
                    </td>
                    <td className="session-id">{session.id}</td>
                    <td>
                      <div className="runtime-cell">
                        <span>{session.runtime}</span>
                        <strong>{session.crew}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="agent-cell">
                        <Icon name="smart_toy" size={16} />
                        {session.agent}
                      </span>
                    </td>
                    <td>
                      <StatusBadge tone={session.statusTone} label={session.status} />
                    </td>
                    <td className="time-cell">
                      <span>Start: {session.started}</span>
                      <span>Update: {session.updated}</span>
                    </td>
                    <td>
                      <span className={`task-cell task-cell--${session.statusTone}`}>
                        <Icon
                          name={
                            session.statusTone === "running"
                              ? "sync"
                              : session.statusTone === "completed"
                                ? "done_all"
                                : "warning"
                          }
                          size={16}
                        />
                        {session.task}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="inspector" aria-label="Session lifecycle inspector">
        <section className="inspector__header">
          <div className="inspector__title-row">
            <div>
              <h3>Session Lifecycle</h3>
              <p>ses_01j4f82x</p>
            </div>
            <button className="icon-button" type="button" aria-label="Close inspector">
              <Icon name="close" />
            </button>
          </div>
          <div className="inspector__actions">
            <button type="button">
              <Icon name="play_arrow" size={16} />
              Resume
            </button>
            <button type="button">
              <Icon name="ios_share" size={16} />
              Export
            </button>
          </div>
        </section>

        <section className="inspector__body">
          <div className="inspector-stats">
            <div>
              <span>Runtime</span>
              <strong>.pi/cluster</strong>
            </div>
            <div>
              <span>Uptime</span>
              <strong>14m 22s</strong>
            </div>
          </div>

          <ol className="timeline">
            <li>
              <span className="timeline__marker" aria-hidden="true" />
              <div>
                <time>10:42:01 AM</time>
                <h4>Session Initialized</h4>
                <code>Payload ID: req_99z21</code>
              </div>
            </li>
            <li>
              <span className="timeline__marker" aria-hidden="true" />
              <div>
                <time>10:42:05 AM</time>
                <h4>Crew Provisioned</h4>
                <div className="timeline__tags">
                  <span>POSTGRES_EXT</span>
                  <span>TRANSFORM_AG</span>
                </div>
              </div>
            </li>
            <li>
              <span className="timeline__marker timeline__marker--active" aria-hidden="true" />
              <div>
                <time className="timeline__active-label">Active Task</time>
                <h4>Executing Query</h4>
                <pre>
                  <code>{`action: query\ntarget: public.users\nlimit: 1000\nstatus: 'active'`}</code>
                </pre>
              </div>
            </li>
          </ol>
        </section>

        <section className="danger-zone" aria-label="Destructive action">
          <div className="danger-zone__panel">
            <p>
              <Icon name="warning" size={16} />
              Destructive Action
            </p>
            <span>Terminate and purge this session. This action is irreversible.</span>
            <label>
              Type DELETE to confirm
              <input type="text" placeholder="DELETE" />
            </label>
          </div>
          <button className="danger-zone__button" type="button">
            <Icon name="delete_forever" size={18} />
            Terminate Session
          </button>
        </section>
      </aside>
    </>
  );
}
