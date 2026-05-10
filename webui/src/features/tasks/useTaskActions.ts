import { useState, useCallback } from "react";
import type { TaskRecord } from "./useTasksData";

export interface TaskActions {
  transitionTask: (taskId: string, newState: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useTaskActions(
  tasks: TaskRecord[],
  onTasksChange: (tasks: TaskRecord[]) => void,
): TaskActions {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transitionTask = useCallback(async (taskId: string, newState: string) => {
    // Optimistic update
    const prevTasks = [...tasks];
    const updated = tasks.map(t =>
      t.id === taskId ? { ...t, state: newState as TaskRecord["state"] } : t,
    );
    onTasksChange(updated);
    setLoading(true);
    setError(null);

    try {
      const resp = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          args: [
            "task", "update", taskId,
            "--payload", JSON.stringify({ state: newState }),
          ],
        }),
      });
      const data = await resp.json();
      if (!data.ok) {
        // Revert on failure
        onTasksChange(prevTasks);
        setError(data.stderr || data.error || "Transition failed");
      }
    } catch (e) {
      onTasksChange(prevTasks);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tasks, onTasksChange]);

  return { transitionTask, loading, error };
}