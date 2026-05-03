import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { requestGlobalConsoleOpen } from "../console/consoleBridge";
import { getAgenticEstimationSettings, type AgenticEstimationSettings } from "./agenticEstimationSettings";
import { useTasksData, type MissionRecord, type TaskRecord, type TaskState } from "./useTasksData";
import "./tasks.css";

type TasksView = "board" | "missions" | "pert" | "timeline" | "inbox" | "replan";

type InboxItem = {
  id: string;
  taskId: string;
  title: string;
  source: string;
  reason: string;
  owner: string;
  runtime: string;
  tone: "running" | "completed" | "failed";
};

type TimelineEntry = {
  id: string;
  lane: string;
  taskId: string;
  title: string;
  owner: string;
  runtime: string;
  start: number;
  duration: number;
  durationLabel: string;
  status: "active" | "completed" | "waiting" | "blocked";
  sessionId?: string;
};

type TimelineMilestone = {
  id: string;
  title: string;
  at: number;
  label: string;
  tone: "info" | "completed" | "risk";
  taskId?: string;
};

type TasksToast = {
  message: string;
  tone: "info" | "error";
};

const views: Array<{ id: TasksView; label: string }> = [
  { id: "board", label: "Board" },
  { id: "missions", label: "Missions" },
  { id: "pert", label: "PERT" },
  { id: "timeline", label: "Timeline" },
  { id: "inbox", label: "Inbox" },
  { id: "replan", label: "Replan" },
];

function normalizeView(value: string | null): TasksView {
  return views.some((view) => view.id === value) ? (value as TasksView) : "board";
}

function toneForState(state: TaskState): { tone: "running" | "completed" | "failed"; label: string } {
  if (state === "in_progress") return { tone: "running", label: "In Progress" };
  if (state === "review" || state === "done") return { tone: "completed", label: state === "done" ? "Done" : "Review" };
  if (state === "blocked") return { tone: "failed", label: "Blocked" };
  return { tone: "completed", label: state === "ready" ? "Ready" : "Backlog" };
}

function toneForMission(status: MissionRecord["status"]): { tone: "running" | "completed" | "failed"; label: string } {
  if (status === "active") return { tone: "running", label: "Active" };
  if (status === "completed") return { tone: "completed", label: "Completed" };
  if (status === "at_risk") return { tone: "failed", label: "At Risk" };
  return { tone: "completed", label: "Draft" };
}

function parseEstimateMinutes(estimate: string): number {
  const hours = /(\d+)h/.exec(estimate)?.[1];
  const minutes = /(\d+)m/.exec(estimate)?.[1];
  return (hours ? Number(hours) * 60 : 0) + (minutes ? Number(minutes) : 0);
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatMinutesShort(totalMinutes: number): string {
  return `${totalMinutes}m`;
}

function formatClock(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function laneForTask(task: TaskRecord, index: number): string {
  if (task.owner.includes("planning")) return "Planning Team";
  if (task.owner.includes("eng") || task.owner.includes("ops")) return "Engineering Team";
  if (task.owner.includes("validation") || task.owner.includes("security")) return "Validation Team";
  if (task.owner.includes("context")) return "Context Team";
  return index % 2 === 0 ? "Execution Team" : "Validation Team";
}

function normalizeMilestoneTone(value: unknown): TimelineMilestone["tone"] {
  if (value === "completed") return "completed";
  if (value === "risk" || value === "failed" || value === "blocked") return "risk";
  return "info";
}

function extractTimelineMilestones(tasks: TaskRecord[], entryLookup: Map<string, TimelineEntry>): TimelineMilestone[] {
  return tasks.flatMap((task) => {
    const entry = entryLookup.get(task.id);
    const taskWithMilestones = task as TaskRecord & {
      milestone?: boolean | string | { id?: string; title?: string; at?: number; label?: string; tone?: string };
      milestones?: Array<{ id?: string; title?: string; at?: number; label?: string; tone?: string }>;
    };
    const rawSources: Array<boolean | string | { id?: string; title?: string; at?: number; label?: string; tone?: string }> = [];

    if (typeof taskWithMilestones.milestone !== "undefined") rawSources.push(taskWithMilestones.milestone);
    if (Array.isArray(taskWithMilestones.milestones)) rawSources.push(...taskWithMilestones.milestones);

    return rawSources.flatMap((source, index) => {
      const fallbackAt = entry ? entry.start + entry.duration : 0;
      if (typeof source === "boolean") {
        if (!source || !entry) return [];
        return [{
          id: `${task.id}-milestone-${index}`,
          taskId: task.id,
          title: `${task.id} milestone`,
          at: fallbackAt,
          label: formatClock(8 * 60 + fallbackAt),
          tone: task.state === "done" ? "completed" : "info",
        }];
      }
      if (typeof source === "string") {
        return [{
          id: `${task.id}-milestone-${index}`,
          taskId: task.id,
          title: source,
          at: fallbackAt,
          label: formatClock(8 * 60 + fallbackAt),
          tone: task.state === "done" ? "completed" : "info",
        }];
      }
      if (!source) return [];
      return [{
        id: source.id || `${task.id}-milestone-${index}`,
        taskId: task.id,
        title: source.title || `${task.id} milestone`,
        at: typeof source.at === "number" ? source.at : fallbackAt,
        label: source.label || formatClock(8 * 60 + (typeof source.at === "number" ? source.at : fallbackAt)),
        tone: normalizeMilestoneTone(source.tone),
      }];
    });
  });
}

type PertNodeLayout = {
  task: TaskRecord;
  stage: number;
  lane: number;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  duration: number;
  aiDuration: number;
  tokenEstimate: number;
  costEstimateUsd: number;
  x: number;
  y: number;
  width: number;
  height: number;
  critical: boolean;
};

type PertEdgeLayout = {
  fromId: string;
  toId: string;
  critical: boolean;
};

function buildPertDiagram(tasks: TaskRecord[], settings: AgenticEstimationSettings) {
  const runtimeDurationFactor = (runtime: string): number => {
    const normalized = runtime.toLowerCase();
    if (normalized.includes("pi/local")) return settings.runtimeDurationFactor["pi/local"] ?? settings.runtimeDurationFactor.default ?? 1;
    if (normalized.includes("pi")) return settings.runtimeDurationFactor.pi ?? settings.runtimeDurationFactor.default ?? 1;
    if (normalized.includes("hermes")) return settings.runtimeDurationFactor.hermes ?? settings.runtimeDurationFactor.default ?? 1;
    if (normalized.includes("opencode")) return settings.runtimeDurationFactor.opencode ?? settings.runtimeDurationFactor.default ?? 1;
    if (normalized.includes("openclaude")) return settings.runtimeDurationFactor.openclaude ?? settings.runtimeDurationFactor.default ?? 1;
    if (normalized.includes("claude")) return settings.runtimeDurationFactor.claude ?? settings.runtimeDurationFactor.default ?? 1;
    return settings.runtimeDurationFactor.default ?? 1;
  };

  const runtimeCostPer1kTokensUsd = (runtime: string): number => {
    const normalized = runtime.toLowerCase();
    if (normalized.includes("hermes")) return settings.runtimeCostPer1kTokensUsd.hermes ?? settings.runtimeCostPer1kTokensUsd.default ?? 0.003;
    if (normalized.includes("pi")) return settings.runtimeCostPer1kTokensUsd.pi ?? settings.runtimeCostPer1kTokensUsd.default ?? 0.003;
    if (normalized.includes("opencode")) return settings.runtimeCostPer1kTokensUsd.opencode ?? settings.runtimeCostPer1kTokensUsd.default ?? 0.003;
    if (normalized.includes("openclaude")) return settings.runtimeCostPer1kTokensUsd.openclaude ?? settings.runtimeCostPer1kTokensUsd.default ?? 0.003;
    if (normalized.includes("claude")) return settings.runtimeCostPer1kTokensUsd.claude ?? settings.runtimeCostPer1kTokensUsd.default ?? 0.003;
    return settings.runtimeCostPer1kTokensUsd.default ?? 0.003;
  };

  const estimateTokens = (task: TaskRecord, durationMinutes: number): number => {
    const dependencyWeight = task.dependencies.length * settings.tokenPerDependency;
    const textWeight = `${task.title} ${task.summary || ""}`.trim().split(/\s+/).filter(Boolean).length * settings.tokenPerWord;
    const priorityWeight = task.priority === "high" ? settings.tokenPriorityHigh : task.priority === "medium" ? settings.tokenPriorityMedium : 180;
    return Math.max(1200, Math.round(settings.tokenBase + durationMinutes * settings.tokenPerMinute + dependencyWeight + textWeight + priorityWeight));
  };

  const taskMap = new Map(tasks.map((task) => [task.id, task] as const));
  const successors = new Map<string, string[]>();
  tasks.forEach((task) => successors.set(task.id, []));
  tasks.forEach((task) => {
    task.dependencies.forEach((dependencyId) => {
      if (!successors.has(dependencyId)) successors.set(dependencyId, []);
      successors.get(dependencyId)!.push(task.id);
    });
  });

  const stageMemo = new Map<string, number>();
  const stageOf = (taskId: string): number => {
    if (stageMemo.has(taskId)) return stageMemo.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 0;
    const stage = task.dependencies.length === 0 ? 0 : Math.max(...task.dependencies.map((dependencyId) => stageOf(dependencyId))) + 1;
    stageMemo.set(taskId, stage);
    return stage;
  };

  const esMemo = new Map<string, number>();
  const efMemo = new Map<string, number>();
  const earliestStartOf = (taskId: string): number => {
    if (esMemo.has(taskId)) return esMemo.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 0;
    const es = task.dependencies.length === 0 ? 0 : Math.max(...task.dependencies.map((dependencyId) => earliestFinishOf(dependencyId)));
    esMemo.set(taskId, es);
    return es;
  };
  const earliestFinishOf = (taskId: string): number => {
    if (efMemo.has(taskId)) return efMemo.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 0;
    const ef = earliestStartOf(taskId) + parseEstimateMinutes(task.estimate);
    efMemo.set(taskId, ef);
    return ef;
  };

  const stageGroups = new Map<number, TaskRecord[]>();
  tasks.forEach((task) => {
    const stage = stageOf(task.id);
    const group = stageGroups.get(stage) || [];
    group.push(task);
    stageGroups.set(stage, group);
  });

  const sortedStages = Array.from(stageGroups.keys()).sort((a, b) => a - b);
  sortedStages.forEach((stage) => {
    stageGroups.get(stage)!.sort((a, b) => {
      const criticalDelta = Number(a.dependencies.length === 0) - Number(b.dependencies.length === 0);
      if (criticalDelta !== 0) return criticalDelta;
      return a.id.localeCompare(b.id);
    });
  });

  const projectFinish = Math.max(0, ...tasks.map((task) => earliestFinishOf(task.id)));
  const lsMemo = new Map<string, number>();
  const lfMemo = new Map<string, number>();
  const latestFinishOf = (taskId: string): number => {
    if (lfMemo.has(taskId)) return lfMemo.get(taskId)!;
    const next = successors.get(taskId) || [];
    const lf = next.length === 0 ? projectFinish : Math.min(...next.map((successorId) => latestStartOf(successorId)));
    lfMemo.set(taskId, lf);
    return lf;
  };
  const latestStartOf = (taskId: string): number => {
    if (lsMemo.has(taskId)) return lsMemo.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 0;
    const ls = latestFinishOf(taskId) - parseEstimateMinutes(task.estimate);
    lsMemo.set(taskId, ls);
    return ls;
  };

  const NODE_WIDTH = 236;
  const NODE_HEIGHT = 148;
  const COLUMN_GAP = 82;
  const ROW_GAP = 34;
  const TOP_OFFSET = 76;
  const LEFT_OFFSET = 56;

  const layouts: PertNodeLayout[] = [];
  sortedStages.forEach((stage) => {
    const group = stageGroups.get(stage) || [];
    const totalStageHeight = group.length * NODE_HEIGHT + Math.max(0, group.length - 1) * ROW_GAP;
    const stageTop = TOP_OFFSET + Math.max(0, (3 * (NODE_HEIGHT + ROW_GAP) - totalStageHeight) / 2);
    group.forEach((task, index) => {
      const duration = parseEstimateMinutes(task.estimate);
      const aiDuration = Math.max(
        8,
        Math.round((settings.baseMinutes + duration * runtimeDurationFactor(task.runtime) + task.dependencies.length * settings.dependencyMinutes + `${task.summary || ""}`.split(/\s+/).filter(Boolean).length * settings.summaryWordMinutes + (task.priority === "high" ? settings.priorityHighMinutes : task.priority === "medium" ? settings.priorityMediumMinutes : 0))),
      );
      const tokenEstimate = estimateTokens(task, aiDuration);
      const costEstimateUsd = Number(((tokenEstimate / 1000) * runtimeCostPer1kTokensUsd(task.runtime)).toFixed(3));
      const es = earliestStartOf(task.id);
      const ef = earliestFinishOf(task.id);
      const ls = latestStartOf(task.id);
      const lf = latestFinishOf(task.id);
      const slack = Math.max(0, ls - es);
      layouts.push({
        task,
        stage,
        lane: index,
        es,
        ef,
        ls,
        lf,
        slack,
        duration,
        aiDuration,
        tokenEstimate,
        costEstimateUsd,
        x: LEFT_OFFSET + stage * (NODE_WIDTH + COLUMN_GAP),
        y: stageTop + index * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        critical: slack === 0,
      });
    });
  });

  const edges: PertEdgeLayout[] = tasks.flatMap((task) =>
    task.dependencies.map((dependencyId) => ({
      fromId: dependencyId,
      toId: task.id,
      critical: (layouts.find((node) => node.task.id === dependencyId)?.critical && layouts.find((node) => node.task.id === task.id)?.critical) || false,
    })),
  );

  const maxStage = Math.max(0, ...sortedStages);
  const maxBottom = Math.max(0, ...layouts.map((node) => node.y + node.height));
  const width = LEFT_OFFSET * 2 + (maxStage + 1) * NODE_WIDTH + maxStage * COLUMN_GAP;
  const height = maxBottom + 52;
  const totalSlack = layouts.reduce((sum, node) => sum + node.slack, 0);
  const totalAiMinutes = layouts.reduce((sum, node) => sum + node.aiDuration, 0);
  const totalTokenEstimate = layouts.reduce((sum, node) => sum + node.tokenEstimate, 0);
  const totalCostEstimateUsd = Number(layouts.reduce((sum, node) => sum + node.costEstimateUsd, 0).toFixed(3));

  return {
    nodes: layouts,
    edges,
    width,
    height,
    projectFinish,
    totalAiMinutes,
    totalTokenEstimate,
    totalCostEstimateUsd,
    totalSlack,
    criticalCount: layouts.filter((node) => node.critical).length,
    stageCount: maxStage + 1,
  };
}

export function TasksPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { workspacePath } = useWorkspace();
  const {
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
    commitMissionScope,
    applyMissionReplan,
    runTask,
  } = useTasksData(workspacePath);
  const [toast, setToast] = useState<TasksToast | null>(null);
  const [isBoardModalOpen, setIsBoardModalOpen] = useState(false);
  const [isPertModalOpen, setIsPertModalOpen] = useState(false);
  const [isFlowHelpOpen, setIsFlowHelpOpen] = useState(false);
  const [isTaskCreateOpen, setIsTaskCreateOpen] = useState(false);
  const [isTaskEditOpen, setIsTaskEditOpen] = useState(false);
  const [isMissionCreateOpen, setIsMissionCreateOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    missionId: "",
    crewId: "dev",
    owner: "planning-lead",
    runtime: "openclaude",
    priority: "medium" as "high" | "medium" | "low",
    summary: "",
  });
  const [taskEditDraft, setTaskEditDraft] = useState<Partial<TaskRecord>>({});
  const [agenticSettings, setAgenticSettings] = useState<AgenticEstimationSettings>(() => getAgenticEstimationSettings());
  const [missionDraft, setMissionDraft] = useState({
    name: "",
    objective: "",
    dueWindow: "",
    risk: "Medium",
    capacity: "70%",
  });
  const activeView = normalizeView(searchParams.get("view"));
  const selectedTaskId = searchParams.get("task") ?? "";
  const selectedMissionId = searchParams.get("mission") ?? "";

  const updateTasksParams = useCallback((
    updates: Partial<Record<"view" | "task" | "mission", string | null>>,
    replace = false,
  ) => {
    const next = new URLSearchParams(searchParams);
    (Object.entries(updates) as Array<["view" | "task" | "mission", string | null]>).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  const handleSelectView = useCallback((view: TasksView) => {
    updateTasksParams({ view }, false);
  }, [updateTasksParams]);

  const handleSelectMission = useCallback((missionId: string) => {
    updateTasksParams({ mission: missionId }, true);
  }, [updateTasksParams]);

  const handleSelectTask = useCallback((taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    updateTasksParams({ task: taskId, mission: task?.missionId || selectedMissionId || null }, true);
  }, [selectedMissionId, tasks, updateTasksParams]);

  useEffect(() => {
    if (!searchParams.get("view")) {
      updateTasksParams({ view: "board" }, true);
      return;
    }
    if (tasks.length > 0 && !tasks.some((task) => task.id === selectedTaskId)) {
      updateTasksParams({ task: tasks[0].id }, true);
    }
  }, [searchParams, selectedTaskId, tasks, updateTasksParams]);

  useEffect(() => {
    if (missions.length > 0 && !missions.some((mission) => mission.id === selectedMissionId)) {
      updateTasksParams({ mission: missions[0].id }, true);
    }
  }, [missions, selectedMissionId, updateTasksParams]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0],
    [selectedTaskId, tasks],
  );
  const selectedMission = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionId) ?? missions[0],
    [missions, selectedMissionId],
  );

  const counts = useMemo(() => {
    const blocked = tasks.filter((task) => task.state === "blocked").length;
    const active = tasks.filter((task) => task.state === "in_progress").length;
    return {
      total: tasks.length,
      blocked,
      active,
    };
  }, [tasks]);

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    const missionTasks = tasks.filter((task) => !selectedMissionId || task.missionId === selectedMissionId);
    const visibleTasks = missionTasks.slice(0, 8);
    const taskMap = new Map(missionTasks.map((task) => [task.id, task] as const));
    const esMemo = new Map<string, number>();

    const earliestStartOf = (taskId: string): number => {
      if (esMemo.has(taskId)) return esMemo.get(taskId)!;
      const task = taskMap.get(taskId);
      if (!task) return 0;
      const start = task.dependencies.length === 0
        ? 0
        : Math.max(...task.dependencies.map((dependencyId) => {
          const dependency = taskMap.get(dependencyId);
          if (!dependency) return 0;
          return earliestStartOf(dependencyId) + parseEstimateMinutes(dependency.estimate);
        }));
      esMemo.set(taskId, start);
      return start;
    };

    const orderedTasks = [...visibleTasks].sort((left, right) => {
      const startDelta = earliestStartOf(left.id) - earliestStartOf(right.id);
      if (startDelta !== 0) return startDelta;
      return left.id.localeCompare(right.id);
    });

    const laneCursor = new Map<string, number>();

    return orderedTasks.map((task, index) => {
      const lane = laneForTask(task, index);
      const earliestStart = earliestStartOf(task.id);
      const laneStart = laneCursor.get(lane) ?? 0;
      const start = Math.max(earliestStart, laneStart);
      const duration = Math.max(20, parseEstimateMinutes(task.estimate));
      laneCursor.set(lane, start + duration + 15);

      return {
        id: `TL-${task.id}`,
        lane,
        taskId: task.id,
        title: task.title,
        owner: task.owner,
        runtime: task.runtime,
        start,
        duration,
        durationLabel: formatMinutes(duration),
        status:
          task.state === "done" || task.state === "review"
            ? "completed"
            : task.state === "blocked"
              ? "blocked"
              : task.state === "in_progress"
                ? "active"
                : "waiting",
        sessionId: task.sessionId,
      };
    });
  }, [selectedMissionId, tasks]);

  const timelineMilestones = useMemo<TimelineMilestone[]>(() => {
    const entryLookup = new Map(timelineEntries.map((entry) => [entry.taskId, entry] as const));
    const missionTasks = tasks.filter((task) => !selectedMissionId || task.missionId === selectedMissionId).slice(0, 8);
    return extractTimelineMilestones(missionTasks, entryLookup);
  }, [selectedMissionId, tasks, timelineEntries]);

  const inboxItems = useMemo<InboxItem[]>(() => (
    tasks
      .filter((task) => !selectedMissionId || task.missionId === selectedMissionId)
      .slice(0, 3)
      .map((task, index) => ({
      id: `INBOX-${index + 1}`,
      taskId: task.id,
      title: task.title,
      source: task.sessionId || task.state.replaceAll("_", " "),
      reason: task.blockedReason || task.summary || "No additional context available.",
      owner: task.owner,
      runtime: task.runtime,
      tone:
        task.state === "blocked"
          ? "failed"
          : task.state === "in_progress"
            ? "running"
            : "completed",
    }))
  ), [selectedMissionId, tasks]);

  useEffect(() => {
    if (!isPertModalOpen && !isBoardModalOpen && !isFlowHelpOpen && !isTaskCreateOpen && !isTaskEditOpen && !isMissionCreateOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPertModalOpen(false);
      if (event.key === "Escape") setIsBoardModalOpen(false);
      if (event.key === "Escape") setIsFlowHelpOpen(false);
      if (event.key === "Escape") setIsTaskCreateOpen(false);
      if (event.key === "Escape") setIsTaskEditOpen(false);
      if (event.key === "Escape") setIsMissionCreateOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBoardModalOpen, isFlowHelpOpen, isMissionCreateOpen, isPertModalOpen, isTaskCreateOpen, isTaskEditOpen]);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const reloadSettings = () => setAgenticSettings(getAgenticEstimationSettings());
    window.addEventListener("mah:agentic-estimation-changed", reloadSettings);
    window.addEventListener("storage", reloadSettings);
    return () => {
      window.removeEventListener("mah:agentic-estimation-changed", reloadSettings);
      window.removeEventListener("storage", reloadSettings);
    };
  }, []);

  const openTaskCreateModal = () => {
    setTaskDraft({
      title: "",
      missionId: selectedMissionId || missions[0]?.id || "",
      crewId: "dev",
      owner: "planning-lead",
      runtime: "openclaude",
      priority: "medium",
      summary: "",
    });
    setIsTaskCreateOpen(true);
  };

  const openTaskEditModal = (task?: TaskRecord) => {
    if (!task) return;
    setTaskEditDraft({
      title: task.title,
      summary: task.summary,
      owner: task.owner,
      runtime: task.runtime,
      priority: task.priority,
      state: task.state,
      risk: task.risk,
    });
    setIsTaskEditOpen(true);
  };

  const handleCreateTask = async () => {
    if (!taskDraft.title.trim()) return;
    const missionId = taskDraft.missionId || selectedMissionId || "";
    try {
      const created = await createTask({
        title: taskDraft.title.trim(),
        missionId,
        crewId: taskDraft.crewId.trim() || "dev",
        owner: taskDraft.owner.trim() || "planning-lead",
        runtime: taskDraft.runtime.trim() || "openclaude",
        priority: taskDraft.priority,
        summary: taskDraft.summary.trim() || "Task created from the Tasks workspace.",
      });
      if (created) {
        setIsTaskCreateOpen(false);
        updateTasksParams({ view: "board", task: created.id, mission: created.missionId }, false);
        setToast({ message: `Task ${created.id} criada em .mah/tasks.`, tone: "info" });
      }
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  const openMissionCreateModal = () => {
    setMissionDraft({
      name: "",
      objective: "",
      dueWindow: "",
      risk: "Medium",
      capacity: "70%",
    });
    setIsMissionCreateOpen(true);
  };

  const handleCreateMission = async () => {
    if (!missionDraft.name.trim()) return;
    try {
      const created = await createMission({
        name: missionDraft.name.trim(),
        objective: missionDraft.objective.trim() || "Mission criada a partir da WebUI Tasks.",
        dueWindow: missionDraft.dueWindow.trim() || "TBD",
        risk: missionDraft.risk.trim() || "Medium",
        capacity: missionDraft.capacity.trim() || "70%",
      });
      if (created) {
        setIsMissionCreateOpen(false);
        updateTasksParams({ view: "missions", mission: created.id }, false);
        setToast({ message: `Mission ${created.name} criada em .mah/tasks.`, tone: "info" });
      }
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  const handleCommitScope = async () => {
    if (!selectedMissionId) return;
    try {
      const updated = await commitMissionScope(selectedMissionId);
      if (updated) setToast({ message: `Scope da mission ${updated.name} foi committed.`, tone: "info" });
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  const handleApplyReplan = async () => {
    if (!selectedMissionId) return;
    try {
      const summary = await applyMissionReplan(selectedMissionId);
      setToast({ message: summary || "Agentic replan aplicado.", tone: "info" });
      updateTasksParams({ view: "replan" }, false);
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  const handleRunTask = async (taskId: string) => {
    try {
      const updated = await runTask(taskId);
      if (updated?.sessionId) {
        updateTasksParams({ task: updated.id, mission: updated.missionId }, false);
        setToast({ message: `Execução iniciada para ${updated.id}.`, tone: "info" });
      }
      const returnTo = `${location.pathname}?${searchParams.toString()}`;
      navigate(`/run?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  const handleResumeTaskSession = (task?: TaskRecord) => {
    if (!task?.sessionId) return;
    void requestGlobalConsoleOpen(task.runtime, task.sessionId).catch((nextError) => {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    });
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<TaskRecord>) => {
    try {
      const updated = await updateTask(taskId, updates);
      if (updated) {
        updateTasksParams({ task: updated.id, mission: updated.missionId }, true);
        setToast({ message: `Task ${updated.id} updated.`, tone: "info" });
      }
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const removed = await deleteTask(taskId);
      if (!removed) return;
      const remaining = tasks.filter((item) => item.id !== taskId);
      const nextTask = remaining[0];
      updateTasksParams({ task: nextTask?.id || null, mission: nextTask?.missionId || selectedMissionId || null }, true);
      setToast({ message: `Task ${taskId} deleted.`, tone: "info" });
    } catch (nextError) {
      setToast({ message: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  };

  return (
    <>
      <main className="tasks-main">
        <section className="screen-header">
          <div>
            <h2>Tasks</h2>
            <div className="screen-header__meta">
              <span className="live-summary">
                <span className="live-summary__dot" aria-hidden="true" />
                Active mission: {selectedMission?.name || "Loading mission state"}
              </span>
              <span className="screen-header__separator" />
              <span>{counts.total} total tasks</span>
              <span className="screen-header__separator" />
              <span>{counts.blocked} blocked</span>
              <span className="screen-header__separator" />
              <span>{counts.active} in progress</span>
            </div>
          </div>
          <CommandPreview context="tasks" command={selectedMissionId ? `mah task list --mission ${selectedMissionId} --json` : "mah task list --json"} />
        </section>

        <section className="tasks-main__content">
          {error && <div className="tasks-callout tasks-callout--error">{error}</div>}
          <div className="tasks-nav">
            <div className="tasks-topbar">
              <div className="tasks-topbar__summary">
                <div className="tasks-topbar__summary-row">
                  <strong>Manage multi-agent work orchestration and mission lifecycle.</strong>
                  <button
                    type="button"
                    className="tasks-help-trigger"
                    aria-label="Open mission and task creation help"
                    onClick={() => setIsFlowHelpOpen(true)}
                  >
                    <Icon name="help" size={16} />
                  </button>
                </div>
                <span>Mission defines scope and window. Task is the executable work item inside that mission.</span>
              </div>
              <div className="tasks-toolbar">
                <button type="button" className="tasks-toolbar__btn" onClick={openMissionCreateModal}>
                  <Icon name="flag" size={16} />
                  {busyAction === "create-mission" ? "Creating..." : "New Mission"}
                </button>
                <button type="button" className="tasks-toolbar__btn tasks-toolbar__btn--primary" onClick={openTaskCreateModal}>
                  <Icon name="add" size={16} />
                  {busyAction === "create-task" ? "Creating..." : "New Task"}
                </button>
                <button type="button" className="tasks-toolbar__btn" onClick={() => void handleCommitScope()}>
                  <Icon name="playlist_add_check" size={16} />
                  Commit Scope
                </button>
                <button type="button" className="tasks-toolbar__btn" onClick={() => handleSelectView("replan")}>
                  <Icon name="hub" size={16} />
                  Open Replan
                </button>
                <button type="button" className="tasks-toolbar__btn" onClick={() => void reload()}>
                  <Icon name="refresh" size={16} />
                  Refresh
                </button>
              </div>
            </div>

            <div className="tasks-tabs" role="tablist" aria-label="Tasks views">
              {views.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-selected={activeView === view.id}
                  className={`tasks-tab${activeView === view.id ? " tasks-tab--active" : ""}`}
                  onClick={() => handleSelectView(view.id)}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? <div className="loading-state">Loading task storage...</div> : null}
          {!loading && tasks.length === 0 ? <div className="empty-state">No tasks stored yet. Use Create Task to start.</div> : null}
          {!loading && tasks.length > 0 && activeView === "board" && (
            <BoardView
              selectedTaskId={selectedTaskId}
              selectedMission={selectedMission}
              onSelectTask={handleSelectTask}
              onOpenPert={() => handleSelectView("pert")}
              onOpenModal={() => setIsBoardModalOpen(true)}
              tasks={tasks}
            />
          )}
          {activeView === "missions" && missions.length > 0 && (
            <MissionsView
              tasks={tasks}
              missions={missions}
              selectedMissionId={selectedMissionId}
              onSelectMission={handleSelectMission}
              onSelectTask={handleSelectTask}
              onCreateMission={openMissionCreateModal}
            />
          )}
          {activeView === "pert" && tasks.length > 0 && (
            <PertView
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onOpenModal={() => setIsPertModalOpen(true)}
              onCloseModal={undefined}
              agenticSettings={agenticSettings}
              tasks={tasks}
            />
          )}
          {activeView === "timeline" && tasks.length > 0 && (
            <TimelineView
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              timelineEntries={timelineEntries}
              milestones={timelineMilestones}
            />
          )}
          {activeView === "inbox" && tasks.length > 0 && (
            <InboxView selectedTaskId={selectedTaskId} onSelectTask={handleSelectTask} inboxItems={inboxItems} />
          )}
          {activeView === "replan" && tasks.length > 0 && (
            <ReplanView
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              selectedMission={selectedMission}
              tasks={tasks}
              onApplyReplan={() => void handleApplyReplan()}
              busy={busyAction.startsWith("replan-")}
            />
          )}
          {!loading && activeView === "missions" && missions.length === 0 && (
            <SubpageEmpty message="No missions stored yet. Create Mission to start organizing scope." />
          )}
          {!loading && ["pert", "timeline", "inbox", "replan"].includes(activeView) && tasks.length === 0 && (
            <SubpageEmpty message="This view needs tasks in storage before it can render useful navigation." />
          )}
        </section>
      </main>

      <aside className="inspector tasks-inspector" aria-label="Tasks inspector">
        {activeView === "missions" && selectedMission ? (
          <MissionInspector mission={selectedMission} />
        ) : (
          <TaskInspector
            task={selectedTask}
            busyAction={busyAction}
            onRunTask={() => void handleRunTask(selectedTask?.id || "")}
            onResumeTaskSession={() => handleResumeTaskSession(selectedTask)}
            onOpenSessions={() => navigate("/sessions")}
            onCreateTask={openTaskCreateModal}
            onEditTask={() => openTaskEditModal(selectedTask)}
            onDeleteTask={(taskId) => void handleDeleteTask(taskId)}
          />
        )}
      </aside>

      {isMissionCreateOpen ? (
        <div className="tasks-modal-backdrop" onClick={() => setIsMissionCreateOpen(false)}>
          <section className="tasks-modal tasks-modal--compose" onClick={(event) => event.stopPropagation()}>
            <div className="tasks-modal__header">
              <div>
                <p className="tasks-panel__label">New Mission</p>
                <h3>Create mission container</h3>
              </div>
              <button type="button" className="tasks-toolbar__btn" onClick={() => setIsMissionCreateOpen(false)}>
                <Icon name="close" size={16} />
                Close
              </button>
            </div>

            <div className="tasks-form">
              <div className="tasks-form__grid">
                <label className="tasks-field tasks-field--full">
                  <span>Name</span>
                  <input
                    type="text"
                    value={missionDraft.name}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Q4 Audit Hardening"
                  />
                </label>
                <label className="tasks-field tasks-field--full">
                  <span>Objective</span>
                  <textarea
                    rows={4}
                    value={missionDraft.objective}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, objective: event.target.value }))}
                    placeholder="Define scope, expected delivery window, and success criteria."
                  />
                </label>
                <label className="tasks-field">
                  <span>Due Window</span>
                  <input
                    type="text"
                    value={missionDraft.dueWindow}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, dueWindow: event.target.value }))}
                    placeholder="Nov 01 - Nov 28"
                  />
                </label>
                <label className="tasks-field">
                  <span>Risk</span>
                  <select
                    value={missionDraft.risk}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, risk: event.target.value }))}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </label>
                <label className="tasks-field">
                  <span>Capacity</span>
                  <input
                    type="text"
                    value={missionDraft.capacity}
                    onChange={(event) => setMissionDraft((current) => ({ ...current, capacity: event.target.value }))}
                    placeholder="70%"
                  />
                </label>
              </div>
              <div className="tasks-modal__actions">
                <button type="button" className="tasks-toolbar__btn" onClick={() => setIsMissionCreateOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tasks-toolbar__btn tasks-toolbar__btn--primary"
                  onClick={() => void handleCreateMission()}
                  disabled={!missionDraft.name.trim() || busyAction === "create-mission"}
                >
                  <Icon name="flag" size={16} />
                  {busyAction === "create-mission" ? "Creating..." : "Create Mission"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isTaskCreateOpen ? (
        <div className="tasks-modal-backdrop" onClick={() => setIsTaskCreateOpen(false)}>
          <section className="tasks-modal tasks-modal--compose" onClick={(event) => event.stopPropagation()}>
            <div className="tasks-modal__header">
              <div>
                <p className="tasks-panel__label">New Task</p>
                <h3>Create executable work item</h3>
              </div>
              <button type="button" className="tasks-toolbar__btn" onClick={() => setIsTaskCreateOpen(false)}>
                <Icon name="close" size={16} />
                Close
              </button>
            </div>

            <div className="tasks-form">
              <div className="tasks-form__grid">
                <label className="tasks-field tasks-field--full">
                  <span>Title</span>
                  <input
                    type="text"
                    value={taskDraft.title}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Verify auth middleware"
                  />
                </label>
                <label className="tasks-field tasks-field--full">
                  <span>Summary</span>
                  <textarea
                    rows={4}
                    value={taskDraft.summary}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, summary: event.target.value }))}
                    placeholder="Describe the concrete execution expected for this task."
                  />
                </label>
                <label className="tasks-field">
                  <span>Mission (optional)</span>
                  <select
                    value={taskDraft.missionId}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, missionId: event.target.value }))}
                  >
                    <option value="">No mission</option>
                    {missions.map((mission) => (
                      <option key={mission.id} value={mission.id}>{mission.name}</option>
                    ))}
                  </select>
                </label>
                <label className="tasks-field">
                  <span>Crew</span>
                  <input
                    type="text"
                    value={taskDraft.crewId}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, crewId: event.target.value }))}
                    placeholder="dev"
                  />
                </label>
                <label className="tasks-field">
                  <span>Owner</span>
                  <input
                    type="text"
                    value={taskDraft.owner}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, owner: event.target.value }))}
                    placeholder="planning-lead"
                  />
                </label>
                <label className="tasks-field">
                  <span>Runtime</span>
                  <select
                    value={taskDraft.runtime}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, runtime: event.target.value }))}
                  >
                    <option value="openclaude">openclaude</option>
                    <option value="pi">pi</option>
                    <option value="claude">claude</option>
                    <option value="hermes">hermes</option>
                    <option value="opencode">opencode</option>
                    <option value="kilo">kilo</option>
                  </select>
                </label>
                <label className="tasks-field">
                  <span>Priority</span>
                  <select
                    value={taskDraft.priority}
                    onChange={(event) => setTaskDraft((current) => ({ ...current, priority: event.target.value as "high" | "medium" | "low" }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <div className="tasks-modal__actions">
                <button type="button" className="tasks-toolbar__btn" onClick={() => setIsTaskCreateOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tasks-toolbar__btn tasks-toolbar__btn--primary"
                  onClick={() => void handleCreateTask()}
                  disabled={!taskDraft.title.trim() || busyAction === "create-task"}
                >
                  <Icon name="add" size={16} />
                  {busyAction === "create-task" ? "Creating..." : "Create Task"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isTaskEditOpen && selectedTask ? (
        <div className="tasks-modal-backdrop" onClick={() => setIsTaskEditOpen(false)}>
          <section className="tasks-modal tasks-modal--compose" onClick={(event) => event.stopPropagation()}>
            <div className="tasks-modal__header">
              <div>
                <p className="tasks-panel__label">Edit Task</p>
                <h3>{selectedTask.id}</h3>
              </div>
              <button type="button" className="tasks-toolbar__btn" onClick={() => setIsTaskEditOpen(false)}>
                <Icon name="close" size={16} />
                Close
              </button>
            </div>

            <div className="tasks-form">
              <div className="tasks-form__grid">
                <label className="tasks-field tasks-field--full">
                  <span>Title</span>
                  <input type="text" value={taskEditDraft.title || ""} onChange={(event) => setTaskEditDraft((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="tasks-field tasks-field--full">
                  <span>Summary</span>
                  <textarea rows={4} value={taskEditDraft.summary || ""} onChange={(event) => setTaskEditDraft((current) => ({ ...current, summary: event.target.value }))} />
                </label>
                <label className="tasks-field">
                  <span>State</span>
                  <select value={taskEditDraft.state || selectedTask.state} onChange={(event) => setTaskEditDraft((current) => ({ ...current, state: event.target.value as TaskState }))}>
                    <option value="backlog">Backlog</option>
                    <option value="ready">Ready</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="review">Review</option>
                    <option value="done">Done</option>
                  </select>
                </label>
                <label className="tasks-field">
                  <span>Priority</span>
                  <select value={taskEditDraft.priority || selectedTask.priority} onChange={(event) => setTaskEditDraft((current) => ({ ...current, priority: event.target.value as "high" | "medium" | "low" }))}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="tasks-field">
                  <span>Owner</span>
                  <input type="text" value={taskEditDraft.owner || ""} onChange={(event) => setTaskEditDraft((current) => ({ ...current, owner: event.target.value }))} />
                </label>
                <label className="tasks-field">
                  <span>Runtime</span>
                  <input type="text" value={taskEditDraft.runtime || ""} onChange={(event) => setTaskEditDraft((current) => ({ ...current, runtime: event.target.value }))} />
                </label>
                <label className="tasks-field tasks-field--full">
                  <span>Risk</span>
                  <input type="text" value={taskEditDraft.risk || ""} onChange={(event) => setTaskEditDraft((current) => ({ ...current, risk: event.target.value }))} />
                </label>
              </div>
              <div className="tasks-modal__actions">
                <button type="button" className="tasks-toolbar__btn" onClick={() => setIsTaskEditOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tasks-toolbar__btn tasks-toolbar__btn--primary"
                  onClick={async () => {
                    await handleUpdateTask(selectedTask.id, taskEditDraft);
                    setIsTaskEditOpen(false);
                  }}
                  disabled={busyAction === `update-task-${selectedTask.id}`}
                >
                  <Icon name="save" size={16} />
                  {busyAction === `update-task-${selectedTask.id}` ? "Saving..." : "Save Task"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isPertModalOpen && activeView === "pert" ? (
        <div className="tasks-modal-backdrop" onClick={() => setIsPertModalOpen(false)}>
          <section className="tasks-modal tasks-modal--pert" onClick={(event) => event.stopPropagation()}>
            <PertView
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onOpenModal={() => undefined}
              onCloseModal={() => setIsPertModalOpen(false)}
              agenticSettings={agenticSettings}
              tasks={tasks}
              expanded
            />
          </section>
        </div>
      ) : null}

      {isBoardModalOpen && activeView === "board" ? (
        <div className="tasks-modal-backdrop" onClick={() => setIsBoardModalOpen(false)}>
          <section className="tasks-modal tasks-modal--board" onClick={(event) => event.stopPropagation()}>
            <BoardView
              selectedTaskId={selectedTaskId}
              selectedMission={selectedMission}
              onSelectTask={handleSelectTask}
              onOpenPert={() => handleSelectView("pert")}
              onOpenModal={() => undefined}
              onCloseModal={() => setIsBoardModalOpen(false)}
              tasks={tasks}
              expanded
            />
          </section>
        </div>
      ) : null}

      {isFlowHelpOpen ? (
        <div className="tasks-modal-backdrop" onClick={() => setIsFlowHelpOpen(false)}>
          <section className="tasks-modal tasks-modal--flow-help" onClick={(event) => event.stopPropagation()}>
            <div className="tasks-modal__header">
              <div>
                <p className="tasks-panel__label">Creation Flow</p>
                <h3>Mission first, task next</h3>
              </div>
              <button type="button" className="tasks-toolbar__btn" onClick={() => setIsFlowHelpOpen(false)}>
                <Icon name="close" size={16} />
                Close
              </button>
            </div>
            <div className="tasks-flow-guide__steps">
              <span>1. Create Mission</span>
              <span>2. Add Tasks</span>
              <span>3. Run or Resume</span>
            </div>
            <div className="tasks-flow-guide__cards">
              <div className="tasks-flow-guide__card">
                <strong>Mission</strong>
                <p>Planning container for goal, delivery window, risk, capacity, and success criteria. Use it to define the sprint, stream, or delivery slice.</p>
              </div>
              <div className="tasks-flow-guide__card">
                <strong>Task</strong>
                <p>Executable unit of work inside a mission. It gets an owner, runtime, dependencies, session link, and execution history.</p>
              </div>
            </div>
            <div className="tasks-flow-guide__notes">
              <div>
                <strong>When to create a mission</strong>
                <p>Create one when you need a new objective, delivery window, or backlog boundary for a stream of work.</p>
              </div>
              <div>
                <strong>When to create a task</strong>
                <p>Create one when a concrete unit of execution exists and can be assigned, estimated, tracked, and run.</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className={`tasks-toast${toast.tone === "error" ? " tasks-toast--error" : ""}${toast.message.toLowerCase().includes("deleted") ? " tasks-toast--delete" : ""}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button
            type="button"
            className={`tasks-toast__close${toast.message.toLowerCase().includes("deleted") ? " tasks-toast__close--danger" : ""}`}
            aria-label="Fechar notificação"
            onClick={() => setToast(null)}
          >
            <Icon name={toast.message.toLowerCase().includes("deleted") ? "delete" : "close"} size={14} />
          </button>
        </div>
      ) : null}
    </>
  );
}

function SubpageEmpty({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

function BoardView({
  selectedTaskId,
  selectedMission,
  onSelectTask,
  onOpenPert,
  onOpenModal,
  onCloseModal,
  tasks,
  expanded = false,
}: {
  selectedTaskId: string;
  selectedMission?: MissionRecord;
  onSelectTask: (id: string) => void;
  onOpenPert: () => void;
  onOpenModal: () => void;
  onCloseModal?: () => void;
  tasks: TaskRecord[];
  expanded?: boolean;
}) {
  const boardColumns: Array<{ id: TaskState; title: string }> = [
    { id: "backlog", title: "Backlog" },
    { id: "ready", title: "Ready" },
    { id: "in_progress", title: "In Progress" },
    { id: "blocked", title: "Blocked" },
    { id: "review", title: "Review" },
  ];

  return (
    <div className="tasks-stack">
      <section className="tasks-panel tasks-mission-band">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">Active Mission</p>
            <h3>{selectedMission?.name || "No mission selected"}</h3>
            <p className="tasks-panel__copy">{selectedMission?.objective || "Select a mission to anchor board navigation and planning."}</p>
          </div>
          <div className="tasks-inline-actions">
            {!expanded ? (
              <button type="button" className="tasks-toolbar__btn" onClick={onOpenModal}>
                <Icon name="open_in_full" size={16} />
                Expand Board
              </button>
            ) : null}
            <button type="button" className="tasks-toolbar__btn" onClick={onOpenPert}>
              <Icon name="refresh" size={16} />
              Open PERT
            </button>
            {expanded && onCloseModal ? (
              <button type="button" className="tasks-toolbar__btn" onClick={onCloseModal}>
                <Icon name="close" size={16} />
                Close
              </button>
            ) : null}
          </div>
        </div>
        <div className="tasks-kpis">
          <div><span>Due Window</span><strong>{selectedMission?.dueWindow || "TBD"}</strong></div>
          <div><span>Risk Level</span><strong>{selectedMission?.risk || "Unknown"}</strong></div>
          <div><span>Capacity</span><strong>{selectedMission?.capacity || "—"}</strong></div>
          <div><span>Health</span><strong>{selectedMission?.health || "Awaiting selection"}</strong></div>
        </div>
      </section>

      <section className={`tasks-board${expanded ? " tasks-board--expanded" : ""}`}>
        {boardColumns.map((column) => (
          <div key={column.id} className={`tasks-board__column${expanded ? " tasks-board__column--expanded" : ""}`}>
            <div className="tasks-board__column-header">
              <h3>{column.title}</h3>
              <span>{tasks.filter((task) => task.state === column.id).length}</span>
            </div>
            <div className={`tasks-board__cards${expanded ? " tasks-board__cards--expanded" : ""}`}>
              {tasks
                .filter((task) => task.state === column.id)
                .map((task) => (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    className={`task-card${selectedTaskId === task.id ? " task-card--selected" : ""}${task.state === "blocked" ? " task-card--blocked" : ""}`}
                    onClick={() => onSelectTask(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectTask(task.id);
                      }
                    }}
                  >
                    <div className="task-card__top">
                      <span className={`task-card__priority task-card__priority--${task.priority}`}>{task.priority}</span>
                      <span className="task-card__mission">{task.missionId}</span>
                    </div>
                    <strong>{task.title}</strong>
                    <p>{task.summary}</p>
                    <div className="task-card__meta">
                      <span>{task.owner}</span>
                      <span>{task.runtime}</span>
                    </div>
                    <div className="task-card__meta">
                      <span>{task.dependencies.length} deps</span>
                      <span>{task.estimate}</span>
                    </div>
                    {task.sessionId && <div className="task-card__session">Session: {task.sessionId}</div>}
                    {task.blockedReason && <div className="task-card__blocked">{task.blockedReason}</div>}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </section>

    </div>
  );
}

function MissionsView({
  tasks,
  missions,
  selectedMissionId,
  onSelectMission,
  onSelectTask,
  onCreateMission,
}: {
  tasks: TaskRecord[];
  missions: MissionRecord[];
  selectedMissionId: string;
  onSelectMission: (id: string) => void;
  onSelectTask: (id: string) => void;
  onCreateMission: () => void;
}) {
  const currentMission = missions.find((mission) => mission.id === selectedMissionId) ?? missions[0];
  const missionTasks = tasks.filter((task) => task.missionId === currentMission.id);
  const blockedCount = missionTasks.filter((task) => task.state === "blocked").length;
  const criticalCount = missionTasks.filter((task) => task.priority === "high" || task.state === "blocked").length;
  const avgConfidence = missionTasks.length > 0
    ? Math.round(missionTasks.reduce((sum, task) => sum + (task.confidence || 0), 0) / missionTasks.length)
    : 0;
  const deliveryConfidence = missionTasks.length > 0
    ? `${avgConfidence}%`
    : "n/a";

  return (
    <div className="tasks-stack">
      <section className="tasks-missions-grid">
        {missions.map((mission) => {
          const badge = toneForMission(mission.status);
          return (
            <button
              key={mission.id}
              type="button"
              className={`tasks-panel tasks-mission-card${selectedMissionId === mission.id ? " tasks-mission-card--selected" : ""}`}
              onClick={() => onSelectMission(mission.id)}
            >
              <div className="tasks-panel__header">
                <div>
                  <p className="tasks-panel__label">Mission</p>
                  <h3>{mission.name}</h3>
                </div>
                <StatusBadge tone={badge.tone} label={badge.label} />
              </div>
              <p className="tasks-panel__copy">{mission.objective}</p>
              <div className="tasks-kpis">
                <div><span>Window</span><strong>{mission.dueWindow}</strong></div>
                <div><span>Capacity</span><strong>{mission.capacity}</strong></div>
                <div><span>Progress</span><strong>{mission.progress}%</strong></div>
                <div><span>Risk</span><strong>{mission.risk}</strong></div>
              </div>
            </button>
          );
        })}
      </section>

      <section className="tasks-panel">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">Selected Mission</p>
            <h3>{currentMission.name}</h3>
          </div>
          <div className="tasks-inline-actions">
            <div className="tasks-panel__health">{currentMission.health}</div>
            <button type="button" className="tasks-toolbar__btn" onClick={onCreateMission}>
              <Icon name="add" size={16} />
              Create Mission
            </button>
          </div>
        </div>
        <div className="tasks-progress">
          <div className="tasks-progress__bar">
            <div className="tasks-progress__fill" style={{ width: `${currentMission.progress}%` }} />
          </div>
          <span>{currentMission.progress}% mission progress</span>
        </div>
        <div className="tasks-kpis">
          <div><span>Nodes</span><strong>{missionTasks.length}</strong></div>
          <div><span>Blocked</span><strong>{blockedCount}</strong></div>
          <div><span>Critical</span><strong>{criticalCount}</strong></div>
          <div><span>Delivery</span><strong>{deliveryConfidence}</strong></div>
        </div>
      </section>

      <section className="tasks-table tasks-panel">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">Scoped Tasks</p>
            <h3>Mission backlog</h3>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Owner</th>
              <th>Runtime</th>
              <th>Status</th>
              <th>Estimate</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {missionTasks.map((task) => {
              const badge = toneForState(task.state);
              return (
                <tr key={task.id} onClick={() => onSelectTask(task.id)}>
                  <td>
                    <div className="tasks-table__task">
                      <strong>{task.id}</strong>
                      <span>{task.title}</span>
                    </div>
                  </td>
                  <td>{task.owner}</td>
                  <td>{task.runtime}</td>
                  <td><StatusBadge tone={badge.tone} label={badge.label} /></td>
                  <td>{task.estimate}</td>
                  <td>{task.risk}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PertView({
  selectedTaskId,
  onSelectTask,
  onOpenModal,
  onCloseModal,
  agenticSettings,
  tasks,
  expanded = false,
}: {
  selectedTaskId: string;
  onSelectTask: (id: string) => void;
  onOpenModal: () => void;
  onCloseModal?: () => void;
  agenticSettings: AgenticEstimationSettings;
  tasks: TaskRecord[];
  expanded?: boolean;
}) {
  const diagram = useMemo(() => buildPertDiagram(tasks, agenticSettings), [agenticSettings, tasks]);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const INITIAL_ZOOM = 0.75;
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingViewport, setIsDraggingViewport] = useState(false);

  const clampZoom = useCallback((value: number) => Math.min(1.8, Math.max(0.65, Number(value.toFixed(2)))), []);

  const centerDiagram = useCallback((nextZoom: number) => {
    const container = editorRef.current;
    if (!container) return;
    const centeredPanX = (container.clientWidth - diagram.width * nextZoom) / 2;
    const centeredPanY = (container.clientHeight - diagram.height * nextZoom) / 2 - 70;
    setPan({
      x: Number(centeredPanX.toFixed(2)),
      y: Number(centeredPanY.toFixed(2)),
    });
  }, [diagram.height, diagram.width]);

  useEffect(() => {
    setZoom(INITIAL_ZOOM);
    const frameId = window.requestAnimationFrame(() => centerDiagram(INITIAL_ZOOM));
    return () => window.cancelAnimationFrame(frameId);
  }, [INITIAL_ZOOM, centerDiagram, expanded]);

  const handleEditorWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = editorRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const previousZoom = zoom;
    const nextZoom = clampZoom(previousZoom + (event.deltaY < 0 ? 0.1 : -0.1));
    if (nextZoom === previousZoom) return;

    const focalX = (offsetX - pan.x) / previousZoom;
    const focalY = (offsetY - pan.y) / previousZoom;
    setZoom(nextZoom);
    setPan({
      x: offsetX - focalX * nextZoom,
      y: offsetY - focalY * nextZoom,
    });
  }, [clampZoom, pan.x, pan.y, zoom]);

  const handleEditorPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".tasks-pert__node")) return;
    const container = editorRef.current;
    if (!container) return;
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsDraggingViewport(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pan.x, pan.y]);

  const handleEditorPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    const deltaX = event.clientX - dragStateRef.current.startX;
    const deltaY = event.clientY - dragStateRef.current.startY;
    setPan({
      x: dragStateRef.current.panX + deltaX,
      y: dragStateRef.current.panY + deltaY,
    });
  }, []);

  const handleEditorPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current.active) {
      dragStateRef.current.active = false;
      setIsDraggingViewport(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  return (
    <div className="tasks-stack">
      <section className="tasks-panel">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">PERT Network</p>
            <h3>Critical path flowchart</h3>
          </div>
          <div className="tasks-pert__header-actions">
            <div className="tasks-kpis tasks-kpis--inline">
              <div><span>Nodes</span><strong>{diagram.nodes.length}</strong></div>
              <div><span>Critical Path</span><strong>{diagram.criticalCount}</strong></div>
              <div><span>Total Slack</span><strong>{formatMinutes(diagram.totalSlack)}</strong></div>
              <div><span>ETA</span><strong>{formatMinutes(diagram.projectFinish)}</strong></div>
              <div><span>AI ETA</span><strong>{formatMinutes(diagram.totalAiMinutes)}</strong></div>
              <div><span>Tokens</span><strong>{diagram.totalTokenEstimate.toLocaleString()}</strong></div>
              <div><span>Est. Cost</span><strong>${diagram.totalCostEstimateUsd.toFixed(3)}</strong></div>
            </div>
            {!expanded ? (
              <button type="button" className="tasks-toolbar__btn" onClick={onOpenModal}>
                <Icon name="open_in_full" size={16} />
                Expand Diagram
              </button>
            ) : null}
            {expanded && onCloseModal ? (
              <button type="button" className="tasks-toolbar__btn" onClick={onCloseModal}>
                <Icon name="close" size={16} />
                Close
              </button>
            ) : null}
          </div>
        </div>
        {/* <div className="tasks-callout">
          PERT/CPM flow based on dependency arrows, expected duration, earliest/latest times, and slack across the active mission.
        </div> */}
        <div className="tasks-pert__toolbar">
          <div className="tasks-pert-hint">
            <span>Wheel to zoom</span>
            <span>Click and drag canvas to pan</span>
            <span>Zoom {Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <div
          ref={editorRef}
          className={`tasks-pert-editor${expanded ? " tasks-pert-editor--expanded" : ""}${isDraggingViewport ? " tasks-pert-editor--dragging" : ""}`}
          onWheel={handleEditorWheel}
          onPointerDown={handleEditorPointerDown}
          onPointerMove={handleEditorPointerMove}
          onPointerUp={handleEditorPointerUp}
          onPointerCancel={handleEditorPointerUp}
        >
          <div className="tasks-pert-editor__viewport">
            <div
              className="tasks-pert-editor__canvas"
              style={{
                width: diagram.width,
                height: diagram.height,
                left: pan.x,
                top: pan.y,
                transform: `scale(${zoom})`,
              }}
            >
            <svg className="tasks-pert-editor__edges" viewBox={`0 0 ${diagram.width} ${diagram.height}`} preserveAspectRatio="none">
              <defs>
                <marker id="tasks-pert-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-dim)" />
                </marker>
                <marker id="tasks-pert-arrow-critical" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
              </defs>
              {diagram.edges.map((edge) => {
                const from = diagram.nodes.find((node) => node.task.id === edge.fromId);
                const to = diagram.nodes.find((node) => node.task.id === edge.toId);
                if (!from || !to) return null;
                const startX = from.x + from.width;
                const startY = from.y + from.height / 2;
                const endX = to.x;
                const endY = to.y + to.height / 2;
                const midX = startX + (endX - startX) / 2;
                const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
                return (
                  <path
                    key={`${edge.fromId}-${edge.toId}`}
                    d={path}
                    className={`tasks-pert-editor__edge${edge.critical ? " tasks-pert-editor__edge--critical" : ""}`}
                    markerEnd={edge.critical ? "url(#tasks-pert-arrow-critical)" : "url(#tasks-pert-arrow)"}
                  />
                );
              })}
            </svg>
            {diagram.nodes.map((node) => (
              <button
                key={node.task.id}
                type="button"
                className={`tasks-pert__node${selectedTaskId === node.task.id ? " tasks-pert__node--selected" : ""}${node.task.state === "blocked" ? " tasks-pert__node--blocked" : ""}${node.critical ? " tasks-pert__node--critical" : ""}${node.task.state === "in_progress" ? " tasks-pert__node--active" : ""}${node.task.state === "done" || node.task.state === "review" ? " tasks-pert__node--done" : ""}`}
                style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
                onClick={() => onSelectTask(node.task.id)}
              >
                <div className="tasks-pert__node-topline">
                  <span className="tasks-pert__node-id">{node.task.id}</span>
                  <span className="tasks-pert__node-badge">{node.task.priority}</span>
                </div>
                <strong>{node.task.title}</strong>
                <div className="tasks-pert__node-meta">
                  <span>{node.task.owner}</span>
                  <span>{node.task.runtime}</span>
                </div>
                <div className="tasks-pert__metrics">
                  <span><small>ES</small>{formatMinutesShort(node.es)}</span>
                  <span><small>EF</small>{formatMinutesShort(node.ef)}</span>
                  <span><small>LS</small>{formatMinutesShort(node.ls)}</span>
                  <span><small>LF</small>{formatMinutesShort(node.lf)}</span>
                </div>
                <div className="tasks-pert__node-footer">
                  <span>{node.task.estimate}</span>
                  <span>Slack {formatMinutes(node.slack)}</span>
                </div>
                <div className="tasks-pert__node-ai">
                  <span>AI {formatMinutes(node.aiDuration)}</span>
                  <span>{node.tokenEstimate.toLocaleString()} tok</span>
                  <span>${node.costEstimateUsd.toFixed(3)}</span>
                </div>
              </button>
            ))}
            </div>
          </div>
        </div>
        <div className="tasks-legend">
          <span><i className="tasks-legend__dot tasks-legend__dot--critical" /> Critical path</span>
          <span><i className="tasks-legend__dot tasks-legend__dot--active" /> In progress</span>
          <span><i className="tasks-legend__dot tasks-legend__dot--blocked" /> Blocked</span>
          <span><i className="tasks-legend__dot tasks-legend__dot--done" /> Completed</span>
        </div>
        {/* {selectedNode ? (
          <div className="tasks-pert__details">
            <strong>{selectedNode.task.id}</strong>
            <span>{selectedNode.task.rationale}</span>
            <span>
              CPM: ES {formatMinutes(selectedNode.es)} / EF {formatMinutes(selectedNode.ef)} / LS {formatMinutes(selectedNode.ls)} / LF {formatMinutes(selectedNode.lf)}
            </span>
          </div>
        ) : null} */}
      </section>
    </div>
  );
}

function TimelineView({
  selectedTaskId,
  onSelectTask,
  timelineEntries,
  milestones,
}: {
  selectedTaskId: string;
  onSelectTask: (id: string) => void;
  timelineEntries: TimelineEntry[];
  milestones: TimelineMilestone[];
}) {
  const lanes = Array.from(new Set(timelineEntries.map((entry) => entry.lane)));
  const ganttStartMinutes = 8 * 60;
  const projectStart = Math.min(0, ...timelineEntries.map((entry) => entry.start), ...milestones.map((item) => item.at));
  const projectEnd = Math.max(
    60,
    ...timelineEntries.map((entry) => entry.start + entry.duration),
    ...milestones.map((item) => item.at + 15),
  );
  const totalSpan = Math.max(60, projectEnd - projectStart);
  const markCount = 6;
  const timeMarks = Array.from({ length: markCount }, (_, index) => {
    const offset = Math.round((totalSpan / (markCount - 1)) * index / 15) * 15;
    return {
      offset,
      label: formatClock(ganttStartMinutes + projectStart + offset),
    };
  });
  const toPercent = (value: number) => ((value - projectStart) / totalSpan) * 100;

  const maxConcurrent = timelineEntries.reduce((peak, current) => {
    const overlap = timelineEntries.filter((entry) =>
      entry.start < current.start + current.duration && current.start < entry.start + entry.duration,
    ).length;
    return Math.max(peak, overlap);
  }, 0);

  return (
    <div className="tasks-stack">
      <section className="tasks-panel">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">Timeline</p>
            <h3>Execution Gantt</h3>
          </div>
          <div className="tasks-kpis tasks-kpis--inline">
            <div><span>Active Sessions</span><strong>{timelineEntries.filter((entry) => entry.sessionId).length}</strong></div>
            <div><span>Parallel Tasks</span><strong>{maxConcurrent}</strong></div>
            <div><span>Milestones</span><strong>{milestones.length}</strong></div>
            <div><span>Predicted Finish</span><strong>{formatClock(ganttStartMinutes + projectEnd)}</strong></div>
          </div>
        </div>
        <div className="tasks-gantt">
          <div className="tasks-gantt__scale">
            <div className="tasks-gantt__label tasks-gantt__label--scale">
              <strong>Schedule</strong>
              <span>{formatClock(ganttStartMinutes + projectStart)} to {formatClock(ganttStartMinutes + projectEnd)}</span>
            </div>
            <div className="tasks-gantt__scale-track">
              {timeMarks.map((mark) => (
                <span key={`${mark.offset}-${mark.label}`} className="tasks-gantt__scale-mark" style={{ left: `${toPercent(projectStart + mark.offset)}%` }}>
                  {mark.label}
                </span>
              ))}
            </div>
          </div>
          {milestones.length > 0 ? (
            <div className="tasks-gantt__row tasks-gantt__row--milestones">
              <div className="tasks-gantt__label">
                <strong>Milestones</strong>
                <span>{milestones.length} markers</span>
              </div>
              <div className="tasks-gantt__track">
                {milestones.map((milestone) => (
                  <button
                    key={milestone.id}
                    type="button"
                    className={`tasks-gantt__milestone tasks-gantt__milestone--${milestone.tone}`}
                    style={{ left: `${toPercent(milestone.at)}%` }}
                    onClick={() => milestone.taskId ? onSelectTask(milestone.taskId) : undefined}
                    disabled={!milestone.taskId}
                  >
                    <i />
                    <span>{milestone.title}</span>
                    <small>{milestone.label}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {lanes.map((lane) => (
            <div key={lane} className="tasks-gantt__row">
              <div className="tasks-gantt__label">
                <strong>{lane}</strong>
                <span>{timelineEntries.filter((entry) => entry.lane === lane).length} tasks scheduled</span>
              </div>
              <div className="tasks-gantt__track">
                {timelineEntries.filter((entry) => entry.lane === lane).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`tasks-gantt__bar tasks-gantt__bar--${entry.status}${selectedTaskId === entry.taskId ? " tasks-gantt__bar--selected" : ""}`}
                    style={{
                      left: `${toPercent(entry.start)}%`,
                      width: `${Math.max(8, toPercent(entry.start + entry.duration) - toPercent(entry.start))}%`,
                    }}
                    onClick={() => onSelectTask(entry.taskId)}
                    data-title={entry.title}
                  >
                    <div className="tasks-gantt__bar-topline">
                      <strong>{entry.taskId}</strong>
                      <span>{entry.durationLabel}</span>
                    </div>
                    <span className="tasks-gantt__bar-title">{entry.title}</span>
                    <div className="tasks-gantt__bar-meta">
                      <span>{entry.owner}</span>
                      <span>{formatClock(ganttStartMinutes + entry.start)} to {formatClock(ganttStartMinutes + entry.start + entry.duration)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="tasks-callout">
          Gantt timeline uses dependency-aware start offsets and renders milestone markers only when milestone metadata exists in task payloads.
        </div>
      </section>
    </div>
  );
}

function InboxView({
  selectedTaskId,
  onSelectTask,
  inboxItems,
}: {
  selectedTaskId: string;
  onSelectTask: (id: string) => void;
  inboxItems: InboxItem[];
}) {
  return (
    <div className="tasks-stack">
      <section className="tasks-panel">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">Inbox</p>
            <h3>Suggested follow-ups</h3>
          </div>
        </div>
        <div className="tasks-inbox">
          {inboxItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tasks-inbox__item${selectedTaskId === item.taskId ? " tasks-inbox__item--selected" : ""}`}
              onClick={() => onSelectTask(item.taskId)}
            >
              <div className="tasks-inbox__header">
                <strong>{item.title}</strong>
                <StatusBadge tone={item.tone} label={item.source} />
              </div>
              <p>{item.reason}</p>
              <div className="tasks-inbox__meta">
                <span>{item.owner}</span>
                <span>{item.runtime}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReplanView({
  selectedTaskId,
  onSelectTask,
  selectedMission,
  tasks,
  onApplyReplan,
  busy,
}: {
  selectedTaskId: string;
  onSelectTask: (id: string) => void;
  selectedMission?: MissionRecord;
  tasks: TaskRecord[];
  onApplyReplan: () => void;
  busy: boolean;
}) {
  const missionTasks = tasks.filter((task) => !selectedMission || task.missionId === selectedMission.id);
  const currentPlan = missionTasks
    .filter((task) => task.state === "in_progress" || task.state === "blocked")
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === "blocked" ? -1 : 1;
      return parseEstimateMinutes(b.estimate) - parseEstimateMinutes(a.estimate);
    })
    .slice(0, 4);
  const proposedPlan = [...currentPlan]
    .sort((a, b) => {
      const aScore = (a.state === "blocked" ? 10 : 0) + (a.priority === "high" ? 5 : 0) + a.dependencies.length;
      const bScore = (b.state === "blocked" ? 10 : 0) + (b.priority === "high" ? 5 : 0) + b.dependencies.length;
      return bScore - aScore;
    })
    .slice(0, 4);

  const totalCurrentMinutes = currentPlan.reduce((sum, task) => sum + parseEstimateMinutes(task.estimate), 0);
  const totalProposedMinutes = proposedPlan.reduce((sum, task) => sum + Math.max(15, parseEstimateMinutes(task.estimate) - 20), 0);
  const deltaMinutes = Math.max(0, totalCurrentMinutes - totalProposedMinutes);
  const blockedCurrent = currentPlan.filter((task) => task.state === "blocked").length;
  const blockedProposed = proposedPlan.filter((task) => task.state === "blocked").length;
  const riskShift = blockedCurrent > 0
    ? Math.round(((blockedCurrent - blockedProposed) / blockedCurrent) * 100)
    : 0;

  return (
    <div className="tasks-stack">
      <section className="tasks-panel">
        <div className="tasks-panel__header">
          <div>
            <p className="tasks-panel__label">Agentic Replan</p>
            <h3>Resolve bottlenecks</h3>
          </div>
          <div className="tasks-kpis tasks-kpis--inline">
            <div><span>Active Mission</span><strong>{selectedMission?.name || "No mission selected"}</strong></div>
            <div><span>Bottlenecks</span><strong>{blockedCurrent} blocked</strong></div>
            <div><span>Delta ETA</span><strong>{deltaMinutes > 0 ? `-${formatMinutes(deltaMinutes)}` : "0m"}</strong></div>
            <div><span>Risk Shift</span><strong>{riskShift > 0 ? `-${riskShift}%` : "0%"}</strong></div>
          </div>
        </div>

        <div className="tasks-replan">
          <div className="tasks-replan__plan">
            <h4>Current Plan</h4>
            {currentPlan.map((task) => (
              <button
                key={`current-${task.id}`}
                type="button"
                className={`tasks-replan__node${task.state === "blocked" ? " tasks-replan__node--critical" : ""}${selectedTaskId === task.id ? " tasks-replan__node--selected" : ""}`}
                onClick={() => onSelectTask(task.id)}
              >
                <strong>{task.id}</strong>
                <span>{task.title}</span>
                <span>{task.owner} · {task.runtime}</span>
              </button>
            ))}
            {currentPlan.length === 0 ? <p className="tasks-panel__copy">No active bottlenecks in current mission.</p> : null}
          </div>
          <div className="tasks-replan__plan">
            <h4>Proposed Replan</h4>
            {proposedPlan.map((task, index) => (
              <button
                key={`proposed-${task.id}`}
                type="button"
                className={`tasks-replan__node${index === 0 ? " tasks-replan__node--highlight" : ""}${selectedTaskId === task.id ? " tasks-replan__node--selected" : ""}`}
                onClick={() => onSelectTask(task.id)}
              >
                <strong>{task.id}</strong>
                <span>{index === 0 ? "Prioritize and unblock first" : "Parallelize after bottleneck release"}</span>
                <span>{task.owner} · {task.runtime}</span>
              </button>
            ))}
            {proposedPlan.length === 0 ? <p className="tasks-panel__copy">No replan recommendation available yet.</p> : null}
          </div>
        </div>

        <div className="tasks-callout">
          Replan impact: prioritize blocked/high-risk tasks first, then parallelize dependent tasks to reduce overall mission latency.
        </div>

        <div className="tasks-toolbar">
          <button type="button" className="tasks-toolbar__btn tasks-toolbar__btn--primary" onClick={onApplyReplan}>
            <Icon name="check_circle" size={16} />
            {busy ? "Applying..." : "Apply Replan"}
          </button>
        </div>
      </section>
    </div>
  );
}

function TaskInspector({
  task,
  busyAction,
  onRunTask,
  onResumeTaskSession,
  onOpenSessions,
  onCreateTask,
  onEditTask,
  onDeleteTask,
}: {
  task?: TaskRecord;
  busyAction: string;
  onRunTask: () => void;
  onResumeTaskSession: () => void;
  onOpenSessions: () => void;
  onCreateTask: () => void;
  onEditTask: () => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
  }, [task?.id]);

  if (!task) {
    return (
      <section className="inspector__body sessions-inspector__empty">
        <Icon name="info" size={32} />
        <p>Select a task to inspect details</p>
      </section>
    );
  }
  const badge = toneForState(task.state);
  const isDeleting = busyAction === `delete-task-${task.id}`;
  return (
    <>
      <section className="inspector__header">
        <div className="inspector__title-row">
          <div>
            <h3>Task Inspector</h3>
            <p>{task.id}</p>
          </div>
        </div>
      </section>
      <section className="inspector__body">
        <div className="inspector-stats">
          <div><span>Status</span><strong><StatusBadge tone={badge.tone} label={badge.label} /></strong></div>
          <div><span>Mission</span><strong>{task.missionId || "—"}</strong></div>
          <div><span>Owner</span><strong>{task.owner}</strong></div>
          <div><span>Runtime</span><strong>{task.runtime}</strong></div>
          <div><span>Estimate</span><strong>{task.estimate} (auto)</strong></div>
          <div><span>Confidence</span><strong>{task.confidence}%</strong></div>
          <div><span>Linked Session</span><strong>{task.sessionId ?? "—"}</strong></div>
          <div><span>Last Update</span><strong>{task.lastUpdate}</strong></div>
        </div>

        <div className="tasks-toolbar">
          <button type="button" className="tasks-toolbar__btn tasks-toolbar__btn--primary" onClick={onRunTask}>
            <Icon name="play_circle" size={16} />
            Run Task
          </button>
          <button type="button" className="tasks-toolbar__btn" onClick={onResumeTaskSession} disabled={!task.sessionId}>
            <Icon name="terminal" size={16} />
            Resume Session
          </button>
          <button type="button" className="tasks-toolbar__btn" onClick={onOpenSessions}>
            <Icon name="history" size={16} />
            Open Sessions
          </button>
          <button type="button" className="tasks-toolbar__btn" onClick={onCreateTask}>
            <Icon name="add" size={16} />
            New Task
          </button>
          <button type="button" className="tasks-toolbar__btn" onClick={onEditTask}>
            <Icon name="edit" size={16} />
            Edit Task
          </button>
          <button
            type="button"
            className={`tasks-toolbar__btn${confirmDelete ? " tasks-toolbar__btn--danger" : ""}`}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              onDeleteTask(task.id);
            }}
            disabled={isDeleting}
          >
            <Icon name="delete" size={16} />
            {isDeleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
          </button>
        </div>

        <div className="tasks-inspector__section">
          <h4>Summary</h4>
          <p>{task.summary}</p>
        </div>

        <div className="tasks-inspector__section">
          <h4>Routing Rationale</h4>
          <p>{task.rationale}</p>
        </div>

        <div className="tasks-inspector__section">
          <CommandPreview context="task-run" command={task.command} />
        </div>

        <div className="tasks-inspector__section">
          <h4>Risk Notes</h4>
          <ul className="tasks-inspector__list">
            <li>Dependency risk: {task.risk}</li>
            <li>Context availability: {task.blockedReason ? "partial" : "ready for execution"}</li>
            <li>Validation requirement: final review required before completion</li>
          </ul>
        </div>
      </section>
    </>
  );
}

function MissionInspector({ mission }: { mission: MissionRecord }) {
  const badge = toneForMission(mission.status);
  return (
    <>
      <section className="inspector__header">
        <div className="inspector__title-row">
          <div>
            <h3>Mission Inspector</h3>
            <p>{mission.name}</p>
          </div>
        </div>
      </section>
      <section className="inspector__body">
        <div className="inspector-stats">
          <div><span>Status</span><strong><StatusBadge tone={badge.tone} label={badge.label} /></strong></div>
          <div><span>Window</span><strong>{mission.dueWindow}</strong></div>
          <div><span>Risk</span><strong>{mission.risk}</strong></div>
          <div><span>Capacity</span><strong>{mission.capacity}</strong></div>
          <div><span>Progress</span><strong>{mission.progress}%</strong></div>
          <div><span>Health</span><strong>{mission.health}</strong></div>
        </div>

        <div className="tasks-inspector__section">
          <h4>Objective</h4>
          <p>{mission.objective}</p>
        </div>

        <div className="tasks-inspector__section">
          <h4>Success Criteria</h4>
          <ul className="tasks-inspector__list">
            {mission.successCriteria.map((criteria) => (
              <li key={criteria}>{criteria}</li>
            ))}
          </ul>
        </div>

        <div className="tasks-inspector__section">
          <CommandPreview context="mission-status" command={mission.command} />
        </div>

        <div className="tasks-inspector__section">
          <h4>Readiness</h4>
          <p>{mission.health}. Maintain progress above {Math.max(50, mission.progress - 10)}% while preventing new blocked tasks.</p>
        </div>
      </section>
    </>
  );
}
