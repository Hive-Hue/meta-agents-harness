import { useState, useCallback, useRef } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TaskComposer } from "./TaskComposer";
import { ExecutionMonitor } from "./ExecutionMonitor";
import { RunInspector } from "./RunInspector";
import { useConfig } from "../config/useConfigStore";
import type { LifecycleEvent } from "./LifecycleTimeline";
import "./run.css";

type RunState = "idle" | "queued" | "routed" | "running" | "completed" | "failed";

const idleEvents: LifecycleEvent[] = [
  { time: "—", state: "queued" as const, label: "No active run", desc: "Compose a task and start a run to begin" },
];

export function RunConsole() {
  const { config } = useConfig();
  const crews = config?.crews ?? [];
  const [runState, setRunState] = useState<RunState>("idle");
  const [taskText, setTaskText] = useState("");
  const [crew, setCrew] = useState(crews[0]?.id ?? "dev");
  const [runtime, setRuntime] = useState(".pi/");
  const [showRouting, setShowRouting] = useState(false);
  const [events, setEvents] = useState<LifecycleEvent[]>(idleEvents);
  const [logLines, setLogLines] = useState<{ time: string; level: "INFO" | "WARN" | "ERROR"; msg: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const timePrefix = () => new Date().toLocaleTimeString([], { hour12: false });

  const startRun = useCallback(async () => {
    if (!taskText.trim()) return;

    abortControllerRef.current = new AbortController();
    setShowRouting(false);
    setRunState("queued");
    setLogLines([]);
    setEvents([{ time: timePrefix(), state: "queued" as const, label: "Queued", desc: "Task received, connecting to runtime" }]);

    try {
      const response = await fetch("/api/mah/run-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskText, crew, runtime }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      setRunState("running");
      setEvents(prev => [...prev, { time: timePrefix(), state: "running" as const, label: "Running", desc: "Execution in progress", active: true }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          if (rawLine.startsWith("event: stdout")) {
            const data = rawLine.slice("event: stdout\ndata: ".length);
            if (data.trim()) {
              setLogLines(prev => [...prev, { time: timePrefix(), level: "INFO", msg: data }]);
            }
          } else if (rawLine.startsWith("event: stderr")) {
            const data = rawLine.slice("event: stderr\ndata: ".length);
            if (data.trim()) {
              setLogLines(prev => [...prev, { time: timePrefix(), level: "ERROR", msg: data }]);
            }
          } else if (rawLine.startsWith("event: done")) {
            const data = rawLine.slice("event: done\ndata: ".length);
            const code = parseInt(data) || 0;
            setRunState(code === 0 ? "completed" : "failed");
            setEvents(prev => {
              const updated = prev.map(e => ({ ...e, active: false }));
              return [...updated, { time: timePrefix(), state: code === 0 ? "completed" as const : "failed" as const, label: code === 0 ? "Completed" : "Failed", desc: "Exit code " + code, active: false }];
            });
          } else if (rawLine.startsWith("event: error")) {
            const data = rawLine.slice("event: error\ndata: ".length);
            setRunState("failed");
            setEvents(prev => {
              const updated = prev.map(e => ({ ...e, active: false }));
              return [...updated, { time: timePrefix(), state: "failed" as const, label: "Error", desc: data, active: false }];
            });
            setLogLines(prev => [...prev, { time: timePrefix(), level: "ERROR", msg: data }]);
          }
        }
      }
    } catch (err) {
      const err2 = err as Error;
      if (err2.name === "AbortError") {
        setRunState("failed");
        setEvents(prev => {
          const updated = prev.map(e => ({ ...e, active: false }));
          return [...updated, { time: timePrefix(), state: "failed" as const, label: "Aborted", desc: "Stopped by operator", active: false }];
        });
      } else {
        setRunState("failed");
        setEvents(prev => {
          const updated = prev.map(e => ({ ...e, active: false }));
          return [...updated, { time: timePrefix(), state: "failed" as const, label: "Error", desc: err2.message, active: false }];
        });
      }
    }
  }, [taskText, crew, runtime]);

  const stopRun = useCallback(() => {
    abortControllerRef.current?.abort();
    setRunState("failed");
    setEvents(prev => {
      const updated = prev.map(e => ({ ...e, active: false }));
      return [...updated, { time: timePrefix(), state: "failed" as const, label: "Aborted", desc: "Stopped by operator", active: false }];
    });
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
                <button className="run-action-btn run-action-btn--primary" type="button" onClick={startRun} disabled={!taskText}>
                  <Icon name="play_arrow" size={14} />Start New Run
                </button>
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
              onStartRun={startRun}
              onStopRun={stopRun}
              runState={runState}
            />
            <ExecutionMonitor events={events} logLines={logLines} />
          </div>
        </div>
      </main>
      <aside className="inspector run-inspector" aria-label="Run inspector">
        <RunInspector runState={runState} taskText={taskText} crew={crew} runtime={runtime} />
      </aside>
    </>
  );
}
