import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useLocation } from "react-router";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TaskComposer } from "./TaskComposer";
import { ExecutionMonitor } from "./ExecutionMonitor";
import { RunInspector } from "./RunInspector";
import { useConfig, ConfigProvider } from "../config/useConfigStore";
import type { LifecycleEvent } from "./LifecycleTimeline";
import "./run.css";

type RunState = "idle" | "queued" | "routed" | "running" | "completed" | "failed";

const idleEvents: LifecycleEvent[] = [
  { time: "—", state: "queued" as const, label: "No active run", desc: "Compose a task and start a run to begin" },
];

const POLL_INTERVAL = 500;

export function RunConsole() {
  return (
    <ConfigProvider>
      <RunConsoleInner />
    </ConfigProvider>
  );
}

type StartRunOverrides = {
  taskText?: string;
  crew?: string;
  runtime?: string;
  routingScope?: "active_crew" | "full_crews";
};

function RunConsoleInner() {
  const { config } = useConfig();
  const location = useLocation();
  const crews = config?.crews ?? [];
  const [runState, setRunState] = useState<RunState>("idle");
  const [taskText, setTaskText] = useState("");
  const [crew, setCrew] = useState(crews[0]?.id ?? "dev");
  const [runtime, setRuntime] = useState("pi");
  const [routingScope, setRoutingScope] = useState<"active_crew" | "full_crews">("active_crew");
  const [showRouting, setShowRouting] = useState(false);
  const [events, setEvents] = useState<LifecycleEvent[]>(idleEvents);
  const [logLines, setLogLines] = useState<{ time: string; level: "INFO" | "WARN" | "ERROR"; msg: string }[]>([]);
  const [contextDocs, setContextDocs] = useState<Array<{ name: string; size: string; relevance: number }>>([]);
  const [artifacts, setArtifacts] = useState<Array<{ path: string; action: "created" | "modified"; size: string }>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunConsumedRef = useRef(false);
  const prefillConsumedRef = useRef(false);
  const runtimeOptions = useMemo(() => {
    const configured = Object.keys(config?.runtimes ?? {}).map((item) => `${item || ""}`.trim()).filter(Boolean);
    const merged = new Set(configured.length > 0 ? configured : ["pi"]);
    const current = `${runtime || ""}`.trim();
    if (current) merged.add(current);
    return Array.from(merged);
  }, [config?.runtimes, runtime]);
  const crewOptions = useMemo(() => {
    const configured = (crews ?? []).filter((item) => `${item?.id || ""}`.trim());
    const current = `${crew || ""}`.trim();
    if (!current || configured.some((item) => item.id === current)) return configured;
    return [...configured, { id: current, display_name: current }];
  }, [crews, crew]);

  useEffect(() => {
    if (!runtimeOptions.includes(runtime)) {
      setRuntime(runtimeOptions[0]);
    }
  }, [runtime, runtimeOptions]);

  const tp = () => new Date().toLocaleTimeString([], { hour12: false });

  const startRun = useCallback(async (overrides?: StartRunOverrides) => {
    const effectiveTask = `${overrides?.taskText ?? taskText ?? ""}`.trim();
    const effectiveCrew = `${overrides?.crew ?? crew ?? ""}`.trim() || "dev";
    const effectiveRuntime = `${overrides?.runtime ?? runtime ?? ""}`.trim() || "pi";
    const effectiveRoutingScope = overrides?.routingScope ?? routingScope;
    if (!effectiveTask) return;

    abortControllerRef.current = new AbortController();
    setShowRouting(false);
    setLogLines([]);
    setContextDocs([]);
    setArtifacts([]);
    setRunState("queued");
    setEvents([{ time: tp(), state: "queued" as const, label: "Queued", desc: "Task received, starting run" }]);

    try {
      const resp = await fetch("/api/mah/run-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: effectiveTask,
          crew: effectiveCrew,
          runtime: effectiveRuntime,
          routingScope: effectiveRoutingScope,
        }),
        signal: abortControllerRef.current.signal,
      });
      const result = await resp.json();
      if (!result.ok) throw new Error(result.error || "Failed to start run");

      const { sessionId } = result;
      setRunState("running");

      const poll = async () => {
        if (abortControllerRef.current?.signal.aborted) return;
        try {
          const statusRes = await fetch(`/api/mah/run-status/${sessionId}`, { signal: abortControllerRef.current!.signal });
          const status = await statusRes.json();
          if (!status.ok) return;

          const lifecycleMap: Record<string, RunState> = { queued: "queued", running: "running", completed: "completed", failed: "failed" };
          const lastEvent = status.events?.[status.events.length - 1];
          setRunState(lifecycleMap[lastEvent?.event ?? "running"] ?? "running");

          const mapped: LifecycleEvent[] = (status.events ?? []).map((e: { event: string; at: string; details?: { label?: string; desc?: string } }) => ({
            time: new Date(e.at).toLocaleTimeString([], { hour12: false }),
            state: (lifecycleMap[e.event] ?? "running") as LifecycleEvent["state"],
            label: e.details?.label ?? e.event,
            desc: e.details?.desc ?? "",
            active: e.event === "running",
          }));
          setEvents(mapped.length ? mapped : [{ time: tp(), state: "running" as const, label: "Running", desc: "In progress", active: true }]);

          setLogLines(status.logs ?? []);
          setContextDocs(status.contextDocs ?? []);
          setArtifacts(status.artifacts ?? []);

          if (status.status === "running") {
            pollTimerRef.current = setTimeout(poll, POLL_INTERVAL);
          } else {
            setRunState(status.status === "completed" ? "completed" : "failed");
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") setRunState("failed");
        }
      };

      pollTimerRef.current = setTimeout(poll, POLL_INTERVAL);

    } catch (err) {
      const err2 = err as Error;
      setRunState("failed");
      setEvents(prev => [...prev.map(e => ({ ...e, active: false })), { time: tp(), state: "failed" as const, label: err2.name === "AbortError" ? "Aborted" : "Error", desc: err2.message, active: false }]);
      if (err2.name !== "AbortError") setLogLines(prev => [...prev, { time: tp(), level: "ERROR", msg: err2.message }]);
    }
  }, [taskText, crew, runtime, routingScope]);

  useEffect(() => {
    const navState = location.state as
      | { autoRun?: boolean; taskText?: string; crew?: string; runtime?: string; sourceTaskId?: string }
      | null;
    const nextTask = `${navState?.taskText || ""}`.trim();
    const nextCrew = `${navState?.crew || ""}`.trim();
    const nextRuntime = `${navState?.runtime || ""}`.trim();
    if (!prefillConsumedRef.current) {
      if (nextTask) setTaskText(nextTask);
      if (nextCrew) setCrew(nextCrew);
      if (nextRuntime) setRuntime(nextRuntime);
      prefillConsumedRef.current = true;
    }

    if (!navState?.autoRun || autoRunConsumedRef.current) return;
    autoRunConsumedRef.current = true;
    setTimeout(() => {
      void startRun({
        taskText: nextTask,
        crew: nextCrew || crew,
        runtime: nextRuntime || runtime,
      });
    }, 0);
  }, [location.state, startRun]);

  const stopRun = useCallback(() => {
    abortControllerRef.current?.abort();
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setRunState("failed");
    setEvents(prev => [...prev.map(e => ({ ...e, active: false })), { time: tp(), state: "failed" as const, label: "Aborted", desc: "Stopped by operator", active: false }]);
  }, []);

  const resetRun = useCallback(() => {
    setTaskText("");
    setEvents(idleEvents);
    setLogLines([]);
    setContextDocs([]);
    setArtifacts([]);
    setRunState("idle");
    setShowRouting(false);
  }, []);

  const stateToBadge: Record<RunState, { tone: "running" | "completed" | "failed"; label: string }> = {
    idle: { tone: "completed", label: "Idle" },
    queued: { tone: "running", label: "Queued" },
    routed: { tone: "running", label: "Routed" },
    running: { tone: "running", label: "Running" },
    completed: { tone: "completed", label: "Completed" },
    failed: { tone: "failed", label: "Failed" },
  };

  const badge = stateToBadge[runState];

  return (
    <>
      <main className="run-main">
        <section className="run-header">
          <div className="run-header__top">
            <div>
              <h2>Run Console</h2>
              <p className="run-header__subtitle">Compose tasks, preview routing, and monitor execution</p>
            </div>
            <div className="run-header__actions">
              <StatusBadge tone={badge.tone} label={badge.label} />
              {runState === "idle" || runState === "completed" || runState === "failed" ? (
                <>
                  <button className="run-action-btn run-action-btn--primary" type="button" onClick={() => { void startRun(); }} disabled={!taskText}>
                    <Icon name="play_arrow" size={14} />Start
                  </button>
                </>
              ) : (
                <button className="run-action-btn run-action-btn--danger" type="button" onClick={stopRun}>
                  <Icon name="stop" size={14} />Stop
                </button>
              )}
            </div>
          </div>
        </section>
        <div className="run-body">
          <div className="run-content">
            <TaskComposer
              taskText={taskText}
              onTaskTextChange={setTaskText}
              crew={crew}
              crews={crewOptions}
              onCrewChange={setCrew}
              runtime={runtime}
              runtimes={runtimeOptions}
              onRuntimeChange={setRuntime}
              routingScope={routingScope}
              onRoutingScopeChange={setRoutingScope}
              showRouting={showRouting}
              onShowRouting={() => setShowRouting(true)}
              onHideRouting={() => setShowRouting(false)}
              onStartRun={() => { void startRun(); }}
              onStopRun={stopRun}
              runState={runState}
              canStartRun
            />
            <ExecutionMonitor events={events} logLines={logLines} contextDocs={contextDocs} artifacts={artifacts} />
          </div>
        </div>
      </main>
      <aside className="inspector run-inspector" aria-label="Run inspector">
        <RunInspector
          runState={runState}
          taskText={taskText}
          crew={crew}
          runtime={runtime}
          routingScope={routingScope}
          onRetry={startRun}
          onReset={resetRun}
        />
      </aside>
    </>
  );
}
