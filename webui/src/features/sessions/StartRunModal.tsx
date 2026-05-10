import { useState } from "react";
import { Icon } from "../../components/ui/Icon";

const RUNTIMES = ["pi", "claude", "codex", "opencode", "openclaude", "hermes", "kilo"] as const;
type Runtime = typeof RUNTIMES[number];

interface StartRunModalProps {
  onClose: () => void;
}

export function StartRunModal({ onClose }: StartRunModalProps) {
  const [runtime, setRuntime] = useState<Runtime>("pi");
  const [crew, setCrew] = useState("dev");
  const [agent, setAgent] = useState("");
  const [task, setTask] = useState("");
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) {
      setError("Task is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          args: [
            "run",
            "--headless",
            "--runtime", runtime,
            "--crew", crew,
            "--agent", agent || undefined,
            "--goal", goal || undefined,
            "--",
            task,
          ].filter(Boolean),
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        onClose();
        // TODO: wire to reload SessionsOverview
      } else {
        setError(data.stderr || data.error || "Failed to start run");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box start-run-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-run-title"
      >
        <div className="modal-header">
          <h3 id="start-run-title">Start New Run</h3>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="start-run-modal__field">
            <label htmlFor="sr-runtime">Runtime</label>
            <select
              id="sr-runtime"
              value={runtime}
              onChange={e => setRuntime(e.target.value as Runtime)}
            >
              {RUNTIMES.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="start-run-modal__field">
            <label htmlFor="sr-crew">Crew</label>
            <input
              id="sr-crew"
              type="text"
              value={crew}
              onChange={e => setCrew(e.target.value)}
              placeholder="e.g. dev"
            />
          </div>

          <div className="start-run-modal__field">
            <label htmlFor="sr-agent">Agent <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input
              id="sr-agent"
              type="text"
              value={agent}
              onChange={e => setAgent(e.target.value)}
              placeholder="e.g. backend-dev"
            />
          </div>

          <div className="start-run-modal__field">
            <label htmlFor="sr-goal">Goal <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input
              id="sr-goal"
              type="text"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="e.g. Implement user authentication for v0.10.0"
            />
          </div>

          <div className="start-run-modal__field">
            <label htmlFor="sr-task">Task <span style={{ color: "var(--color-error)" }}>*</span></label>
            <textarea
              id="sr-task"
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Describe the task to run..."
              rows={4}
              required
            />
          </div>

          {error && (
            <div style={{ color: "var(--color-error)", fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="sessions-action-btn"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="sessions-action-btn sessions-action-btn--primary"
              disabled={submitting || !task.trim()}
            >
              <Icon name="play_arrow" size={14} />
              {submitting ? "Starting..." : "Start Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}