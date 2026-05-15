import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import type { TaskRecord } from "./useTasksData";

interface TaskInspectorProps {
  task: TaskRecord | null;
  onClose: () => void;
  onTransition: (taskId: string, newState: string) => void;
  onRunTask?: (taskId: string) => void;
  onEditTask: (task: TaskRecord) => void;
  onDeleteTask: (taskId: string) => void;
  busyAction?: string;
}

const STATE_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  backlog: ["ready"],
  ready: ["in_progress"],
  in_progress: ["done", "blocked"],
  blocked: ["ready", "in_progress"],
  review: ["done"],
  done: [],
};

// Maps to actual TaskState values from useTasksData
const TRANSITION_BUTTONS: Record<string, string> = {
  backlog: "ready",
  ready: "in_progress",
  in_progress: "done",
  blocked: "ready",
  review: "done",
};

function stateTone(state: string): "running" | "completed" | "failed" {
  if (state === "in_progress") return "running";
  if (state === "done" || state === "review") return "completed";
  if (state === "blocked") return "failed";
  return "completed";
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function TaskInspector({
  task,
  onClose,
  onTransition,
  onRunTask,
  onEditTask,
  onDeleteTask,
  busyAction = "",
}: TaskInspectorProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
  }, [task?.id]);

  if (!task) {
    return (
      <div className="task-inspector task-inspector--empty">
        <Icon name="info" size={32} />
        <p>Select a task to view details</p>
      </div>
    );
  }

  const validNext = VALID_TRANSITIONS[task.state] || [];
  const canTransition = validNext.length > 0;
  const isDeleting = busyAction === `delete-task-${task.id}`;

  return (
    <div className="task-inspector">
      {/* Header */}
      <div className="task-inspector__header">
        <div className="task-inspector__title-row">
          <div>
            <span className="task-inspector__id">{task.id}</span>
            <span className={`task-inspector__state-badge task-inspector__state-badge--${task.state}`}>
              {STATE_LABELS[task.state] || task.state}
            </span>
            <span className={`task-inspector__priority-badge task-inspector__priority-badge--${task.priority}`}>
              {task.priority}
            </span>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <h3 className="task-inspector__title">{task.title}</h3>
      </div>

      {/* Body */}
      <div className="task-inspector__body">
        {/* Metadata */}
        <div className="task-inspector__section">
          <h4 className="task-inspector__section-title">Metadata</h4>
          <div className="task-inspector__meta-grid">
            <div><span>Owner</span><strong>@{task.owner}</strong></div>
            <div><span>Runtime</span><strong>{task.runtime || "—"}</strong></div>
            <div><span>Mission</span><strong>{task.missionId || "—"}</strong></div>
            <div><span>Estimate</span><strong>{task.estimate || "—"}</strong></div>
            <div><span>Confidence</span><strong>{task.confidence != null ? `${Math.round(task.confidence * 100)}%` : "—"}</strong></div>
            <div><span>Risk</span><strong>{task.risk || "—"}</strong></div>
          </div>
        </div>

        <div className="task-inspector__section task-inspector__section--action-row">
          <div className="task-inspector__action-col">
            <h4 className="task-inspector__section-title">Task Actions</h4>
            <div className="task-inspector__state-actions">
              {task.state === "ready" && onRunTask ? (
                <button
                  type="button"
                  className="task-inspector__action-btn task-inspector__action-btn--primary"
                  onClick={() => onRunTask(task.id)}
                >
                  <Icon name="play_circle" size={14} />
                  Run Task
                </button>
              ) : null}
              <button
                type="button"
                className="task-inspector__action-btn"
                onClick={() => onEditTask(task)}
              >
                <Icon name="edit" size={14} />
                Edit Task
              </button>
              <button
                type="button"
                className={`task-inspector__action-btn${confirmDelete ? " task-inspector__action-btn--danger" : ""}`}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  onDeleteTask(task.id);
                }}
                disabled={isDeleting}
              >
                <Icon name="delete" size={14} />
                {isDeleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete Task"}
              </button>
            </div>
          </div>
          <div className="task-inspector__action-col">
            <h4 className="task-inspector__section-title">State Machine</h4>
            <div className="task-inspector__state-actions">
              {validNext.map(next => (
                <button
                  key={next}
                  type="button"
                  className="task-inspector__action-btn"
                  onClick={() => onTransition(task.id, next)}
                >
                  <Icon name="arrow_forward" size={14} />
                  Mark {STATE_LABELS[next] || next}
                </button>
              ))}
              {!canTransition && (
                <span className="task-inspector__no-actions">No valid transitions</span>
              )}
            </div>
          </div>
        </div>

        {/* Dependencies */}
        <div className="task-inspector__section">
          <h4 className="task-inspector__section-title">Dependencies</h4>
          {task.dependencies && task.dependencies.length > 0 ? (
            <ul className="task-inspector__deps">
              {task.dependencies.map(dep => (
                <li key={dep} className="task-inspector__dep">
                  <Icon name="link" size={12} />
                  {dep}
                </li>
              ))}
            </ul>
          ) : (
            <p className="task-inspector__empty">No dependencies</p>
          )}
        </div>

        {/* Rationale */}
        {task.rationale && (
          <div className="task-inspector__section">
            <h4 className="task-inspector__section-title">Rationale</h4>
            <p className="task-inspector__rationale">{task.rationale}</p>
          </div>
        )}

        {/* Command */}
        {task.command && (
          <div className="task-inspector__section">
            <h4 className="task-inspector__section-title">Command</h4>
            <code className="task-inspector__command">{task.command}</code>
          </div>
        )}

        {/* Blocked Reason */}
        {task.blockedReason && (
          <div className="task-inspector__section task-inspector__section--alert">
            <h4 className="task-inspector__section-title">Blocked Reason</h4>
            <p className="task-inspector__blocked-reason">{task.blockedReason}</p>
          </div>
        )}

        {/* Last Update */}
        <div className="task-inspector__section task-inspector__meta">
          <span>Last updated: {formatTimestamp(task.lastUpdate)}</span>
        </div>
      </div>
    </div>
  );
}
