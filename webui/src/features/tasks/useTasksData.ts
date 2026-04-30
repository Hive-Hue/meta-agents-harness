import { useCallback, useEffect, useState } from "react";

export type TaskState = "backlog" | "ready" | "in_progress" | "blocked" | "review" | "done";
export type TaskPriority = "high" | "medium" | "low";

export type TaskRecord = {
  id: string;
  title: string;
  state: TaskState;
  priority: TaskPriority;
  missionId: string;
  crewId?: string;
  owner: string;
  runtime: string;
  dependencies: string[];
  estimate: string;
  confidence: number;
  risk: string;
  summary: string;
  lastUpdate: string;
  sessionId?: string;
  blockedReason?: string;
  rationale: string;
  command: string;
};

export type MissionRecord = {
  id: string;
  name: string;
  objective: string;
  status: "draft" | "active" | "at_risk" | "completed";
  dueWindow: string;
  risk: string;
  capacity: string;
  progress: number;
  health: string;
  successCriteria: string[];
  command: string;
};

type ApiPayload = Record<string, unknown>;

async function readJson(resp: Response): Promise<ApiPayload> {
  const text = await resp.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as ApiPayload : {};
  } catch {
    return {};
  }
}

async function apiRequest(path: string, init: RequestInit = {}, workspacePath = "."): Promise<ApiPayload> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-mah-workspace-path": workspacePath,
      ...(init.headers || {}),
    },
  });
  const data = await readJson(resp);
  if (!resp.ok || data.ok === false) {
    throw new Error(`${data.error || `request failed: ${resp.status}`}`);
  }
  return data;
}

export function useTasksData(workspacePath: string) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksData, missionsData] = await Promise.all([
        apiRequest("/api/mah/tasks", { method: "GET" }, workspacePath),
        apiRequest("/api/mah/missions", { method: "GET" }, workspacePath),
      ]);
      setTasks(Array.isArray(tasksData.tasks) ? tasksData.tasks as TaskRecord[] : []);
      setMissions(Array.isArray(missionsData.missions) ? missionsData.missions as MissionRecord[] : []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTask = useCallback(async (task: Partial<TaskRecord>) => {
    setBusyAction("create-task");
    try {
      const data = await apiRequest("/api/mah/tasks", {
        method: "POST",
        body: JSON.stringify({ task }),
      }, workspacePath);
      setTasks(Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : tasks);
      return data.task as TaskRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [tasks, workspacePath]);

  const createMission = useCallback(async (mission: Partial<MissionRecord>) => {
    setBusyAction("create-mission");
    try {
      const data = await apiRequest("/api/mah/missions", {
        method: "POST",
        body: JSON.stringify({ mission }),
      }, workspacePath);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : missions);
      return data.mission as MissionRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [missions, workspacePath]);

  const commitMissionScope = useCallback(async (missionId: string) => {
    setBusyAction(`commit-${missionId}`);
    try {
      const data = await apiRequest(`/api/mah/missions/${encodeURIComponent(missionId)}/commit-scope`, {
        method: "POST",
      }, workspacePath);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : missions);
      return data.mission as MissionRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [missions, workspacePath]);

  const applyMissionReplan = useCallback(async (missionId: string) => {
    setBusyAction(`replan-${missionId}`);
    try {
      const data = await apiRequest(`/api/mah/missions/${encodeURIComponent(missionId)}/replan`, {
        method: "POST",
      }, workspacePath);
      setTasks(Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : tasks);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : missions);
      return `${data.summary || ""}`;
    } finally {
      setBusyAction("");
    }
  }, [missions, tasks, workspacePath]);

  const runTask = useCallback(async (taskId: string) => {
    setBusyAction(`run-${taskId}`);
    try {
      const data = await apiRequest(`/api/mah/tasks/${encodeURIComponent(taskId)}/run`, {
        method: "POST",
      }, workspacePath);
      const updatedTask = data.task as TaskRecord | undefined;
      if (updatedTask) {
        setTasks((current) => current.map((item) => item.id === updatedTask.id ? updatedTask : item));
      }
      return updatedTask;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  return {
    tasks,
    missions,
    loading,
    error,
    busyAction,
    reload,
    createTask,
    createMission,
    commitMissionScope,
    applyMissionReplan,
    runTask,
  };
}
