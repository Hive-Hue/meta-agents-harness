import { Icon } from "../../components/ui/Icon";
import { RoutingPreview } from "./RoutingPreview";

type TaskComposerProps = {
  taskText: string;
  onTaskTextChange: (val: string) => void;
  crew: string;
  crews: Array<{ id: string; display_name?: string }>;
  onCrewChange: (val: string) => void;
  runtime: string;
  onRuntimeChange: (val: string) => void;
  routingScope: "active_crew" | "full_crews";
  onRoutingScopeChange: (val: "active_crew" | "full_crews") => void;
  showRouting: boolean;
  onShowRouting: () => void;
  onHideRouting: () => void;
  onStartRun: () => void;
  onStopRun: () => void;
  runState: string;
};

export function TaskComposer({
  taskText, onTaskTextChange,
  crew, crews, onCrewChange,
  runtime, onRuntimeChange,
  routingScope, onRoutingScopeChange,
  showRouting, onShowRouting, onHideRouting,
  onStartRun, onStopRun,
  runState,
}: TaskComposerProps) {
  const isRunning = runState === "running" || runState === "queued" || runState === "routed";

  return (
    <div className="run-composer">
      <textarea
        className="run-composer__textarea"
        placeholder="Describe the task for the agent crew..."
        rows={3}
        value={taskText}
        onChange={(e) => onTaskTextChange(e.target.value)}
        disabled={isRunning}
      />
      <div className="run-composer__row">
        <select className="run-composer__select" value={crew} onChange={(e) => onCrewChange(e.target.value)} disabled={isRunning}>
          {crews.length > 0
            ? crews.map(c => <option key={c.id} value={c.id}>{c.display_name || c.id}</option>)
            : <option value="dev">dev</option>}
        </select>
        <select className="run-composer__select" value={runtime} onChange={(e) => onRuntimeChange(e.target.value)} disabled={isRunning}>
          <option value="pi">pi</option>
          <option value="claude">claude</option>
          <option value="opencode">opencode</option>
          <option value="hermes">hermes</option>
          <option value="kilo">kilo</option>
        </select>
        <select
          className="run-composer__select"
          value={routingScope}
          onChange={(e) => onRoutingScopeChange(e.target.value as "active_crew" | "full_crews")}
          disabled={isRunning}
        >
          <option value="active_crew">Active Crew</option>
          <option value="full_crews">Full Crews</option>
        </select>
        <button className="run-action-btn" type="button" onClick={onShowRouting} disabled={isRunning || !taskText}>
          <Icon name="route" size={14} />Preview Routing
        </button>
        {!isRunning ? (
          <button className="run-action-btn run-action-btn--primary" type="button" onClick={onStartRun} disabled={!taskText}>
            <Icon name="play_arrow" size={14} />Start Run
          </button>
        ) : (
          <button className="run-action-btn run-action-btn--danger" type="button" onClick={onStopRun}>
            <Icon name="stop" size={14} />Stop
          </button>
        )}
      </div>
      {showRouting && (
        <RoutingPreview
          crew={crew}
          runtime={runtime}
          routingScope={routingScope}
          taskText={taskText}
          onClose={onHideRouting}
          onRefresh={() => {/* TODO: call expertise routing */}}
        />
      )}
    </div>
  );
}
