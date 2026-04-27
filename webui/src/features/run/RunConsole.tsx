import { useState, useCallback, useRef } from "react";
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

function RunConsoleInner() {
  const { config } = useConfig();
  const crews = config?.crews ?? [];
  const [runState, setRunState] = useState<RunState>("idle");
  const [taskText, setTaskText] = useState("");
  const [crew, setCrew] = useState(crews[0]?.id ?? "dev");
  const [runtime, setRuntime] = useState("pi");
  const [showRouting, setShowRouting] = useState(false);
  const [events, setEvents] = useState<LifecycleEvent[]>(idleEvents);
  const [logLines, setLogLines] = useState<{ time: string; level: "INFO" | "WARN" | "ERROR"; msg: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tp = () => new Date().toLocaleTimeString([], { hour12: false });

  const startRun = useCallback(async () => {
    if (!taskText.trim()) return;

    abortControllerRef.current = new AbortController();
    setShowRouting(false);
    setLogLines([]);
    setRunState("queued");
    setEvents([{ time: tp(), state: "queued" as const, label: "Queued", desc: "Task received, starting run" }]);

    try {
      const resp = await fetch("/api/mah/run-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskText, crew, runtime }),
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

          if (status.status === "running") {
            pollTimerRef.current = setTimeout(poll, POLL_INTERVAL);
          } else {
            const hasErrors = (status.logs ?? []).some((l: { level: string }) => l.level === "ERROR");
            setRunState(status.status === "completed" && !hasErrors ? "completed" : "failed");
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
  }, [taskText, crew, runtime]);

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
                  <button className="run-action-btn run-action-btn--primary" type="button" onClick={startRun} disabled={!taskText}>
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
              crews={crews}
              onCrewChange={setCrew}
              runtime={runtime}
              onRuntimeChange={setRuntime}
              showRouting={showRouting}
              onShowRouting={() => setShowRouting(true)}
              onHideRouting={() => setShowRouting(false)}
              onStartRun={startRun}
              onStopRun={stopRun}
              runState={runState}
            />
            <ExecutionMonitor events={events} logLines={logLines} />
          </div>
        </div>
      </main>
      <aside className="inspector run-inspector" aria-label="Run inspector">
        <RunInspector
          runState={runState}
          taskText={taskText}
          crew={crew}
          runtime={runtime}
          onRetry={startRun}
          onReset={resetRun}
        />
      </aside>
    </>
  );
}
