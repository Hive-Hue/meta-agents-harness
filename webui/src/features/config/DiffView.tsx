import { useMemo } from "react";
import { Icon } from "../../components/ui/Icon";
import { useConfig } from "./useConfigStore";
import yaml from "js-yaml";

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  lineOriginal?: number;
  lineModified?: number;
}

function computeDiff(original: string[], modified: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let oi = 0;
  let mi = 0;

  while (oi < original.length || mi < modified.length) {
    const orig = oi < original.length ? original[oi] : null;
    const mod = mi < modified.length ? modified[mi] : null;

    if (orig === mod) {
      result.push({ type: "unchanged", content: orig ?? "", lineOriginal: oi + 1, lineModified: mi + 1 });
      oi++;
      mi++;
    } else {
      const modNext = mi + 1 < modified.length ? modified[mi + 1] : null;
      const origNext = oi + 1 < original.length ? original[oi + 1] : null;

      if (orig === modNext) {
        result.push({ type: "added", content: mod ?? "", lineModified: mi + 1 });
        mi++;
      } else if (mod === origNext) {
        result.push({ type: "removed", content: orig ?? "", lineOriginal: oi + 1 });
        oi++;
      } else {
        if (orig !== null) {
          result.push({ type: "removed", content: orig, lineOriginal: oi + 1 });
          oi++;
        }
        if (mod !== null) {
          result.push({ type: "added", content: mod, lineModified: mi + 1 });
          mi++;
        }
      }
    }
  }

  return result;
}

export function DiffView() {
  const { config, serverConfig, isDirty } = useConfig();

  const diffLines = useMemo(() => {
    const dumpOpts = { lineWidth: -1, quotingType: "'" } as const;
    const originalLines = (serverConfig ? yaml.dump(serverConfig, dumpOpts) : "").split("\n");
    const modifiedLines = (config ? yaml.dump(config, dumpOpts) : "").split("\n");
    return computeDiff(originalLines, modifiedLines);
  }, [config, serverConfig]);

  if (!isDirty) {
    return (
      <div className="diff-view">
        <div className="diff-view__header">
          <div className="diff-view__col-header">
            <Icon name="remove" size={14} />
            Original
          </div>
          <div className="diff-view__col-header diff-view__col-header--modified">
            <Icon name="add" size={14} />
            Modified
          </div>
        </div>
        <div style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          No changes — working config matches saved state.
        </div>
      </div>
    );
  }

  return (
    <div className="diff-view">
      <div className="diff-view__header">
        <div className="diff-view__col-header">
          <Icon name="remove" size={14} />
          Original
        </div>
        <div className="diff-view__col-header diff-view__col-header--modified">
          <Icon name="add" size={14} />
          Modified
        </div>
      </div>
      <div className="diff-view__content">
        <div className="diff-view__column">
          {diffLines
            .filter((l) => l.type !== "added")
            .map((line, i) => (
              <div className={"diff-line diff-line--" + line.type} key={i}>
                <span className="diff-line__num">{line.lineOriginal ?? ""}</span>
                <span className="diff-line__prefix">{line.type === "removed" ? "-" : " "}</span>
                <span className="diff-line__content">{line.content}</span>
              </div>
            ))}
        </div>
        <div className="diff-view__column">
          {diffLines
            .filter((l) => l.type !== "removed")
            .map((line, i) => (
              <div className={"diff-line diff-line--" + line.type} key={i}>
                <span className="diff-line__num">{line.lineModified ?? ""}</span>
                <span className="diff-line__prefix">{line.type === "added" ? "+" : " "}</span>
                <span className="diff-line__content">{line.content}</span>
              </div>
            ))}
        </div>
      </div>
      <div className="diff-view__legend">
        <span className="diff-view__legend-item diff-view__legend-item--added">Added</span>
        <span className="diff-view__legend-item diff-view__legend-item--removed">Removed</span>
        <span className="diff-view__legend-item diff-view__legend-item--unchanged">Unchanged</span>
      </div>
    </div>
  );
}
