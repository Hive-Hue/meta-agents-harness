import { useState, useCallback, useEffect } from "react";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TaskComposer } from "./TaskComposer";
import { ExecutionMonitor } from "./ExecutionMonitor";
import { RunInspector } from "./RunInspector";
import type { LifecycleEvent } from "./LifecycleTimeline";
import "./run.css";

type RunState = "idle" | "queued" | "routed" | "running" | "completed" | "failed";

const idleEvents: LifecycleEvent[] = [
  { time: "—", state: "queued" as const, label: "No active run", desc: "Compose a task and start a run to begin" },
];

export function RunConsole() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [taskText, setTaskText] = useState("");
  const [crew, setCrew] = useState("dev");
  const [runtime, setRuntime] = useState(".pi/");
  const [showRouting, setShowRouting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [events, setEvents] = useState<LifecycleEvent[]>(idleEvents);

  const startRun = useCallback(() => {
    setShowRouting(false);
    const baseEvents: LifecycleEvent[] = [
      { time: "10:42:01", state: "queued", label: "Queued", desc: "Task received, waiting for routing" },
    ];
    setEvents(baseEvents);
    setRunState("queued");

    setTimeout(() => {
      setEvents((prev) => [
        ...prev,
        { time: "10:42:03", state: "routed", label: "Routed", desc: "engineering-lead selected (confidence 0.87)" },
      ]);
      setRunState("routed");
    }, 800);

    setTimeout(() => {
      setEvents((prev) => [
        ...prev,
        { time: "10:42:05", state: "running", label: "Context Loaded", desc: "3 documents injected (2.4KB)" },
      ]);
    }, 1500);

    setTimeout(() => {
      setEvents((prev) => [
        ...prev,
        { time: "10:42:06", state: "running", label: "Running", desc: "Delegation in progress", active: true },
      ]);
      setRunState("running");
    }, 2000);

    setTimeout(() => {
      setEvents((prev) => prev.map((e) => ({ ...e, active: false })).concat([
        { time: "10:42:15", state: "completed", label: "Completed", desc: "3 artifacts, 2.4KB context recorded", active: false },
      ]));
      setRunState("completed");
    }, 5000);
  }, []);

  const stopRun = useCallback(() => {
    setRunState("failed");
    setEvents((prev) => prev.map((e) => ({ ...e, active: false })).concat([
      { time: "10:42:08", state: "failed", label: "Aborted", desc: "Stopped by operator", active: false },
    ]));
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
              <p className="run-header__subtitle">
                Compose tasks, preview routing, and monitor execution
              </p>
            </div>
            <div className="run-header__actions">
              <StatusBadge tone={badge.tone} label={badge.label} />
              {runState === "idle" || runState === "completed" || runState === "failed" ? (
                <button className="run-action-btn run-action-btn--primary" type="button" onClick={startRun} disabled={!taskText}>
                  <Icon name="play_arrow" size={14} />
                  Start New Run
                </button>
              ) : (
                <button className="run-action-btn run-action-btn--danger" type="button" onClick={stopRun}>
                  <Icon name="stop" size={14} />
                  Stop
                </button>
              )}
            </div>
          </div>
        </section>
        <div className="run-body">
          <button
            className={"run-inspector-toggle" + (inspectorOpen ? "" : " run-inspector-toggle--closed")}
            type="button"
            onClick={() => setInspectorOpen(!inspectorOpen)}
            aria-label={inspectorOpen ? "Collapse inspector" : "Expand inspector"}
          >
            <Icon name={inspectorOpen ? "chevron_left" : "chevron_right"} size={16} />
          </button>
          <div className="run-content">
            <TaskComposer
              taskText={taskText}
              onTaskTextChange={setTaskText}
              crew={crew}
              onCrewChange={setCrew}
              runtime={runtime}
              onRuntimeChange={setRuntime}
              showRouting={showRouting}
              onShowRouting={() => setShowRouting(true)}
              onStartRun={startRun}
              onStopRun={stopRun}
              runState={runState}
            />
            <ExecutionMonitor events={events} />
          </div>
        </div>
      </main>
      <aside
        className={"inspector run-inspector" + (inspectorOpen ? "" : " run-inspector--collapsed")}
        aria-label="Run inspector"
      >
        <RunInspector runState={runState} taskText={taskText} crew={crew} runtime={runtime} />
      </aside>
    </>
  );
}
