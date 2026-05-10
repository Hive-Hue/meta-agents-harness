import { useMemo } from "react";
import type { TaskRecord } from "./useTasksData";

export interface MissionInfo {
  id: string;
  name: string;
  task_count: number;
  done_count: number;
  in_progress_count: number;
  blocked_count: number;
  ready_count: number;
  progress_pct: number;
}

export function useMissionData(tasks: TaskRecord[]): MissionInfo[] {
  return useMemo(() => {
    const byMission = new Map<string, TaskRecord[]>();
    for (const task of tasks) {
      const key = task.missionId || "(none)";
      if (!byMission.has(key)) byMission.set(key, []);
      byMission.get(key)!.push(task);
    }

    const result: MissionInfo[] = [];
    for (const [id, missionTasks] of byMission) {
      const done = missionTasks.filter(t => t.state === "done" || t.state === "review").length;
      const in_progress = missionTasks.filter(t => t.state === "in_progress").length;
      const blocked = missionTasks.filter(t => t.state === "blocked").length;
      const ready = missionTasks.filter(t => t.state === "ready").length;
      const total = missionTasks.length;
      result.push({
        id,
        name: id,
        task_count: total,
        done_count: done,
        in_progress_count: in_progress,
        blocked_count: blocked,
        ready_count: ready,
        progress_pct: total > 0 ? Math.round((done / total) * 100) : 0,
      });
    }

    return result.sort((a, b) => a.id.localeCompare(b.id));
  }, [tasks]);
}