import { useCallback } from "react";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";

type RunInspectorProps = {
  runState: string;
  taskText: string;
  crew: string;
  runtime: string;
  onRetry?: () => void;
  onReset?: () => void;
};

export function RunInspector({ runState, taskText, crew, runtime, onRetry, onReset }: RunInspectorProps) {
  // Fixed command: mah --headless run --runtime <rt> --crew <crew> --task "<task>"
  const parts = ["mah", "--headless", "run"];
  if (runtime) parts.push("--runtime", runtime);
  if (crew) parts.push("--crew", crew);
  if (taskText) parts.push("--task", `"${taskText.slice(0, 50)}${taskText.length > 50 ? "..." : ""}"`);
  const command = parts.join(" ");

  const handleExportLogs = useCallback(() => {
    const content = [
      `Run Inspector Export`,
      `Task: ${taskText || "(none)"}`,
      `Crew: ${crew}`,
      `Runtime: ${runtime}`,
      `State: ${runState}`,
      "---",
      `Command: ${command}`,
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-inspector-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [taskText, crew, runtime, runState, command]);

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
              <dt>Runtime</dt>
              <dd>{runtime}</dd>
            </div>
            <div className="run-inspector__field">
              <dt>Crew</dt>
              <dd>{crew}</dd>
            </div>
          </dl>
        </div>

        <div className="run-inspector__actions">
          {runState === "failed" && (
            <button className="run-inspector__action-btn run-inspector__action-btn--primary" type="button" onClick={onRetry}>
              <Icon name="replay" size={14} />
              Retry Run
            </button>
          )}
          <button className="run-inspector__action-btn" type="button" onClick={onReset}>
            <Icon name="add" size={14} />
            New Run
          </button>
          <button className="run-inspector__action-btn" type="button" onClick={handleExportLogs}>
            <Icon name="download" size={14} />
            Export Info
          </button>
        </div>
      </section>
    </>
  );
}
