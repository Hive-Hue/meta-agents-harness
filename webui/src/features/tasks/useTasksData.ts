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

type DeleteMissionResult = {
  mission?: MissionRecord;
  missions: MissionRecord[];
  tasks: TaskRecord[];
  removedTasks: TaskRecord[];
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
      setTasks(Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : []);
      return data.task as TaskRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const updateTask = useCallback(async (taskId: string, updates: Partial<TaskRecord>) => {
    setBusyAction(`update-task-${taskId}`);
    try {
      const data = await apiRequest(`/api/mah/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      }, workspacePath);
      setTasks(Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : []);
      return data.task as TaskRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const deleteTask = useCallback(async (taskId: string) => {
    setBusyAction(`delete-task-${taskId}`);
    try {
      const data = await apiRequest(`/api/mah/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      }, workspacePath);
      setTasks(Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : []);
      return data.task as TaskRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const createMission = useCallback(async (mission: Partial<MissionRecord>) => {
    setBusyAction("create-mission");
    try {
      const data = await apiRequest("/api/mah/missions", {
        method: "POST",
        body: JSON.stringify({ mission }),
      }, workspacePath);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : []);
      return data.mission as MissionRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const updateMission = useCallback(async (missionId: string, updates: Partial<MissionRecord>) => {
    setBusyAction(`update-mission-${missionId}`);
    try {
      const data = await apiRequest(`/api/mah/missions/${encodeURIComponent(missionId)}`, {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      }, workspacePath);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : []);
      return data.mission as MissionRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const deleteMission = useCallback(async (missionId: string, cascade = false): Promise<DeleteMissionResult> => {
    setBusyAction(`delete-mission-${missionId}`);
    try {
      const suffix = cascade ? "?cascade=true" : "";
      const data = await apiRequest(`/api/mah/missions/${encodeURIComponent(missionId)}${suffix}`, {
        method: "DELETE",
      }, workspacePath);
      const nextMissions = Array.isArray(data.missions) ? data.missions as MissionRecord[] : [];
      const nextTasks = Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : [];
      const removedTasks = Array.isArray(data.removedTasks) ? data.removedTasks as TaskRecord[] : [];
      setMissions(nextMissions);
      setTasks(nextTasks);
      return {
        mission: data.mission as MissionRecord | undefined,
        missions: nextMissions,
        tasks: nextTasks,
        removedTasks,
      };
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const commitMissionScope = useCallback(async (missionId: string) => {
    setBusyAction(`commit-${missionId}`);
    try {
      const data = await apiRequest(`/api/mah/missions/${encodeURIComponent(missionId)}/commit-scope`, {
        method: "POST",
      }, workspacePath);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : []);
      return data.mission as MissionRecord | undefined;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

  const applyMissionReplan = useCallback(async (missionId: string) => {
    setBusyAction(`replan-${missionId}`);
    try {
      const data = await apiRequest(`/api/mah/missions/${encodeURIComponent(missionId)}/replan`, {
        method: "POST",
      }, workspacePath);
      setTasks(Array.isArray(data.tasks) ? data.tasks as TaskRecord[] : []);
      setMissions(Array.isArray(data.missions) ? data.missions as MissionRecord[] : []);
      return `${data.summary || ""}`;
    } finally {
      setBusyAction("");
    }
  }, [workspacePath]);

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
    updateTask,
    deleteTask,
    createMission,
    updateMission,
    deleteMission,
    commitMissionScope,
    applyMissionReplan,
    runTask,
  };
}
