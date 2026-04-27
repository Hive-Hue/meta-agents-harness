import { useState } from "react";
import { Icon } from "../../components/ui/Icon";

interface LogEntry {
  time: string;
  level: "INFO" | "WARN" | "ERROR";
  msg: string;
}

const mockLogs: LogEntry[] = [
  { time: "10:42:06", level: "INFO", msg: "Dispatching task to engineering-lead" },
  { time: "10:42:07", level: "INFO", msg: "Context loaded: 3 docs (2.4KB total)" },
  { time: "10:42:08", level: "INFO", msg: "Delegating to backend-dev: implement API endpoint" },
  { time: "10:42:10", level: "INFO", msg: "backend-dev writing to webui/src/features/run/run.tsx" },
  { time: "10:42:12", level: "WARN", msg: "File domain check: runtime_impl allows webui/* — proceeding" },
  { time: "10:42:14", level: "INFO", msg: "backend-dev completed. Result: 1 file created, 2 modified" },
  { time: "10:42:15", level: "INFO", msg: "Artifact validation: all files within domain constraints" },
  { time: "10:42:16", level: "INFO", msg: "Evidence recorded: 3 artifacts, 2.4KB context" },
];

type FilterLevel = "ALL" | "INFO" | "WARN" | "ERROR";

export function LogPanel() {
  const [filter, setFilter] = useState<FilterLevel>("ALL");

  const filtered = filter === "ALL" ? mockLogs : mockLogs.filter((l) => l.level === filter);

  return (
    <div className="log-panel">
      <div className="log-panel__toolbar">
        {(["ALL", "INFO", "WARN", "ERROR"] as FilterLevel[]).map((level) => (
          <button
            className={"log-filter-btn" + (filter === level ? " log-filter-btn--active" : "")}
            key={level}
            type="button"
            onClick={() => setFilter(level)}
          >
            {level}
          </button>
        ))}
        <span className="log-toolbar-spacer" />
        <button className="log-copy-btn" type="button">
          <Icon name="content_copy" size={12} />
          Copy
        </button>
        <button className="log-copy-btn" type="button">
          <Icon name="download" size={12} />
          Download
        </button>
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
