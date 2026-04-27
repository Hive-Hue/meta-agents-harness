import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";

type RunInspectorProps = {
  runState: string;
  taskText: string;
  crew: string;
  runtime: string;
};

export function RunInspector({ runState, taskText, crew, runtime }: RunInspectorProps) {
  const commandParts = ["mah run"];
  if (taskText) commandParts.push('--task "' + taskText.slice(0, 40) + (taskText.length > 40 ? '..."' : '"'));
  if (crew) commandParts.push("--crew " + crew);
  if (runtime) commandParts.push("--runtime " + runtime);
  const command = commandParts.join(" ");

  return (
    <>
      <section className="inspector__header">
        <h3>Run Inspector</h3>
      </section>
      <section className="inspector__body">
        <div className="run-inspector__command">
          <CommandPreview context="run" command={command} />
        </div>

        <div>
          <h4 className="run-inspector__section-title">Run Info</h4>
          <dl className="run-inspector__fields">
            <div className="run-inspector__field">
              <dt>Session</dt>
              <dd>ses_run_01j4f</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Runtime</dt>
              <dd>{runtime}</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Crew</dt>
              <dd>{crew}</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Started</dt>
              <dd>10:42:01 AM</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Elapsed</dt>
              <dd>{runState === "idle" ? "—" : "14s"}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="run-inspector__section-title">Agent Info</h4>
          <dl className="run-inspector__fields">
            <div className="run-inspector__field">
              <dt>Agent</dt>
              <dd>engineering-lead</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Role</dt>
              <dd>lead</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Model</dt>
              <dd>glm-4.7</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Confidence</dt>
              <dd>0.87</dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="run-inspector__section-title">Domain Profile</h4>
          <dl className="run-inspector__fields">
            <div className="run-inspector__field">
              <dt>Profile</dt>
              <dd>runtime_impl</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Read</dt>
              <dd>Yes</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Edit</dt>
              <dd>Yes</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Bash</dt>
              <dd>Yes</dd>
            </div>
          </dl>
        </div>

        <div className="run-inspector__actions">
          <button className="run-inspector__action-btn run-inspector__action-btn--primary" type="button">
            <Icon name="play_arrow" size={14} />
            Resume Run
          </button>
          <button className="run-inspector__action-btn" type="button">
            <Icon name="replay" size={14} />
            Retry Run
          </button>
          <button className="run-inspector__action-btn" type="button">
            <Icon name="download" size={14} />
            Export Logs
          </button>
          <button className="run-inspector__action-btn" type="button">
            <Icon name="add" size={14} />
            New Run
          </button>
        </div>
      </section>
    </>
  );
}
