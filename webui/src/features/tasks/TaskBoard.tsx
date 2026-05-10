import { Icon } from "../../components/ui/Icon";
import type { TaskRecord } from "./useTasksData";

interface TaskBoardProps {
  tasks: TaskRecord[];
  onSelectTask: (task: TaskRecord) => void;
  onTransitionTask: (taskId: string, newState: string) => void;
}

type ColumnDef = {
  id: TaskRecord["state"];
  title: string;
  colorVar: string;
};

const COLUMNS: ColumnDef[] = [
  { id: "backlog", title: "Backlog", colorVar: "var(--color-text-dim)" },
  { id: "ready", title: "Ready", colorVar: "var(--color-secondary-cyan)" },
  { id: "in_progress", title: "In Progress", colorVar: "#f59e0b" },
  { id: "done", title: "Done", colorVar: "#22c55e" },
  { id: "blocked", title: "Blocked", colorVar: "var(--color-error)" },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

function PriorityDot({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] || "#888";
  return <span className="task-card__priority-dot" style={{ background: color }} title={priority} />;
}

export function TaskBoard({ tasks, onSelectTask, onTransitionTask }: TaskBoardProps) {
  return (
    <div className="task-board">
      {COLUMNS.map(col => {
        const colTasks = tasks.filter(t => t.state === col.id);
        return (
          <div key={col.id} className="task-board__column">
            <div className="task-board__column-header">
              <span
                className="task-board__column-dot"
                style={{ background: col.colorVar }}
              />
              <h3 className="task-board__column-title">{col.title}</h3>
              <span className="task-board__column-count">{colTasks.length}</span>
            </div>
            <div className="task-board__cards">
              {colTasks.map(task => (
                <div
                  key={task.id}
                  className={`task-card${task.state === "blocked" ? " task-card--blocked" : ""}`}
                  onClick={() => onSelectTask(task)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onSelectTask(task); }}
                >
                  <div className="task-card__header">
                    <span className="task-card__id">{task.id}</span>
                    <PriorityDot priority={task.priority} />
                  </div>
                  <div className="task-card__title">{task.title}</div>
                  <div className="task-card__meta">
                    <span className="task-card__owner">@{task.owner}</span>
                    {task.runtime && (
                      <span className="task-card__runtime">{task.runtime}</span>
                    )}
                  </div>
                  {task.blockedReason && (
                    <div className="task-card__blocked-reason">
                      <Icon name="block" size={10} />
                      {task.blockedReason}
                    </div>
                  )}
                </div>
              ))}
              {colTasks.length === 0 && (
                <div className="task-board__empty">No tasks</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}