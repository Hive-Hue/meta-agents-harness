import { useState } from "react";
import { LifecycleTimeline, type LifecycleEvent } from "./LifecycleTimeline";
import { LogPanel } from "./LogPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";

type MonitorTab = "lifecycle" | "logs" | "artifacts";

type ExecutionMonitorProps = {
  events: LifecycleEvent[];
  logLines: { time: string; level: "INFO" | "WARN" | "ERROR"; msg: string }[];
};

export function ExecutionMonitor({ events, logLines }: ExecutionMonitorProps) {
  const [activeTab, setActiveTab] = useState<MonitorTab>("lifecycle");

  const tabs: { id: MonitorTab; label: string }[] = [
    { id: "lifecycle", label: "Lifecycle" },
    { id: "logs", label: "Logs" },
    { id: "artifacts", label: "Artifacts & Context" },
  ];

  return (
    <div className="run-monitor">
      <div className="run-monitor__tabs">
        {tabs.map((tab) => (
          <button
            className={"run-monitor__tab" + (activeTab === tab.id ? " run-monitor__tab--active" : "")}
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="run-monitor__panel">
        {activeTab === "lifecycle" && <LifecycleTimeline events={events} />}
        {activeTab === "logs" && <LogPanel logs={logLines} />}
        {activeTab === "artifacts" && <ArtifactsPanel />}
      </div>
    </div>
  );
}
