import { useState } from "react";
import { Icon } from "../../components/ui/Icon";

type LogEntry = { time: string; level: "INFO" | "WARN" | "ERROR"; msg: string };

type LogPanelProps = { logs: LogEntry[] };

type FilterLevel = "ALL" | "INFO" | "WARN" | "ERROR";

export function LogPanel({ logs }: LogPanelProps) {
  const [filter, setFilter] = useState<FilterLevel>("ALL");
  const filtered = filter === "ALL" ? logs : logs.filter(l => l.level === filter);

  return (
    <div className="log-panel">
      <div className="log-panel__toolbar">
        {(["ALL", "INFO", "WARN", "ERROR"] as FilterLevel[]).map(level => (
          <button className={"log-filter-btn" + (filter === level ? " log-filter-btn--active" : "")} key={level} type="button" onClick={() => setFilter(level)}>{level}</button>
        ))}
        <span className="log-toolbar-spacer" />
        <button className="log-copy-btn" type="button"><Icon name="content_copy" size={12} />Copy</button>
        <button className="log-copy-btn" type="button"><Icon name="download" size={12} />Download</button>
      </div>
      <div className="log-output">
        {filtered.map((log, i) => (
          <span className={"log-line log-line--" + log.level.toLowerCase()} key={i}>
            <span className="log-line__time">[{log.time}] </span>
            <span className="log-line__level">{log.level.padEnd(5)}</span>
            <span className="log-line__msg"> {log.msg}</span>
            {"\n"}
          </span>
        ))}
      </div>
    </div>
  );
}
