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

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

const CONTEXT_LINES = 3;

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

function computeHunks(diffLines: DiffLine[], contextSize: number): DiffHunk[] {
  const changeIndices = diffLines
    .map((l, i) => (l.type !== "unchanged" ? i : -1))
    .filter((i) => i >= 0);

  if (changeIndices.length === 0) return [];

  const hunks: DiffHunk[] = [];
  let currentStart = Math.max(0, changeIndices[0] - contextSize);
  let currentEnd = Math.min(diffLines.length - 1, changeIndices[0] + contextSize);

  for (let i = 1; i < changeIndices.length; i++) {
    const ci = changeIndices[i];
    if (ci - contextSize <= currentEnd + 1) {
      currentEnd = Math.min(diffLines.length - 1, ci + contextSize);
    } else {
      hunks.push({
        header: "",
        lines: diffLines.slice(currentStart, currentEnd + 1),
      });
      currentStart = Math.max(0, ci - contextSize);
      currentEnd = Math.min(diffLines.length - 1, ci + contextSize);
    }
  }
  hunks.push({
    header: "",
    lines: diffLines.slice(currentStart, currentEnd + 1),
  });

  for (const hunk of hunks) {
    const firstOrig = hunk.lines.find((l) => l.lineOriginal != null);
    const firstMod = hunk.lines.find((l) => l.lineModified != null);
    const origStart = firstOrig?.lineOriginal ?? 0;
    const modStart = firstMod?.lineModified ?? 0;
    const origCount = hunk.lines.filter((l) => l.type !== "added").length;
    const modCount = hunk.lines.filter((l) => l.type !== "removed").length;
    hunk.header = `@@ -${origStart},${origCount} +${modStart},${modCount} @@`;
  }

  return hunks;
}

export function DiffView() {
  const { config, serverConfig, isDirty } = useConfig();

  const { hunks, addedCount, removedCount } = useMemo(() => {
    const dumpOpts = { lineWidth: -1, quotingType: "'" } as const;
    const originalLines = (serverConfig ? yaml.dump(serverConfig, dumpOpts) : "").split("\n");
    const modifiedLines = (config ? yaml.dump(config, dumpOpts) : "").split("\n");
    const lines = computeDiff(originalLines, modifiedLines);
    return {
      hunks: computeHunks(lines, CONTEXT_LINES),
      addedCount: lines.filter((l) => l.type === "added").length,
      removedCount: lines.filter((l) => l.type === "removed").length,
    };
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
        <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-dim)", fontSize: 13 }}>
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
      <div className="diff-view__stats">
        <span className="diff-view__stat--removed">-{removedCount} lines</span>
        <span className="diff-view__stat--added">+{addedCount} lines</span>
      </div>
      <div className="diff-view__unified">
        {hunks.map((hunk, hi) => (
          <div className="diff-hunk" key={hi}>
            <div className="diff-hunk__header">{hunk.header}</div>
            {hunk.lines.map((line, li) => (
              <div className={"diff-line diff-line--" + line.type} key={li}>
                <span className="diff-line__num">{line.lineOriginal ?? ""}</span>
                <span className="diff-line__num--right">{line.lineModified ?? ""}</span>
                <span className="diff-line__prefix">
                  {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                </span>
                <span className="diff-line__content">{line.content}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="diff-view__legend">
        <span className="diff-view__legend-item diff-view__legend-item--added">Added</span>
        <span className="diff-view__legend-item diff-view__legend-item--removed">Removed</span>
        <span className="diff-view__legend-item diff-view__legend-item--unchanged">Context</span>
      </div>
    </div>
  );
}
