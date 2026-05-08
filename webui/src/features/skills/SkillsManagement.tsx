import { useMemo, useState, useEffect, useCallback } from "react";
import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";
import "./skills.css";

// Real CLI types
type RealSkill = {
  skill: string;
  status: "installed" | "missing";
  assigned_count: number;
  assigned_to: string[];
  refs: string[];
  file_path: string;
};

type InspectData = {
  skill: string;
  file_path: string;
  title: string;
  summary: string;
  description?: string;
  sections: string[];
  assignments: Array<{ crew: string; agent: string; ref: string }>;
  assignment_count: number;
};

// Display type derived from real data
type SkillEntry = {
  id: string;
  name: string;
  category: "core" | "stitch" | "governance" | "automation";
  scope: "global" | "crew" | "agent";
  attachedTo: string;
  status: "active" | "experimental" | "disabled";
  assignedCount: number;
  filePath: string;
};

type SkillAction = "explain" | "inspect" | "add" | "remove";
type ExecutionStepStatus = "pending" | "running" | "completed" | "failed";

type ActionStep = {
  label: string;
  args: string[];
};

type MahExecResponse = {
  ok: boolean;
  status: number;
  command: string;
  stdout: string;
  stderr: string;
  error?: string;
};

type ActionExecution = {
  action: SkillAction;
  command: string;
  steps: ActionStep[];
  stepStatuses: ExecutionStepStatus[];
  completed: boolean;
  failed: boolean;
  logs: string[];
};

function deriveCategory(name: string): SkillEntry["category"] {
  if (name.startsWith("caveman")) return "automation";
  if (name.startsWith("expertise")) return "governance";
  if (name.startsWith("stitch")) return "stitch";
  return "core";
}

function realToEntry(s: RealSkill): SkillEntry {
  const firstAgent = s.assigned_to.length > 0 ? s.assigned_to[0].split(":").pop() ?? s.assigned_to[0] : "Unassigned";
  return {
    id: s.skill,
    name: s.skill,
    category: deriveCategory(s.skill),
    scope: s.assigned_count > 0 ? "agent" : "global",
    attachedTo: firstAgent,
    status: s.status === "installed" ? "active" : "disabled",
    assignedCount: s.assigned_count,
    filePath: s.file_path,
  };
}

function statusToBadge(status: SkillEntry["status"]): { tone: "running" | "completed" | "failed"; label: string } {
  if (status === "active") return { tone: "completed", label: "Active" };
  if (status === "experimental") return { tone: "running", label: "Experimental" };
  return { tone: "failed", label: "Disabled" };
}

function actionLabel(action: SkillAction): string {
  if (action === "explain") return "Explain";
  if (action === "inspect") return "Inspect";
  if (action === "add") return "Add to Agent";
  return "Remove from Agent";
}

function buildActionSteps(skillName: string, action: SkillAction, attachedTo: string): ActionStep[] {
  if (action === "explain") {
    return [
      { label: `Inspect ${skillName} metadata`, args: ["skills", "inspect", skillName, "--json"] },
      { label: "Generate explanation output", args: ["skills", "explain", skillName, "--json"] },
    ];
  }
  if (action === "inspect") {
    return [
      { label: `Inspect ${skillName} definition`, args: ["skills", "inspect", skillName, "--json"] },
      { label: "Generate explain trace", args: ["skills", "explain", skillName, "--json"] },
      { label: `Validate assignments for ${attachedTo}`, args: ["skills", "list", "--agent", attachedTo, "--json"] },
    ];
  }
  return [];
}

function buildActionStepsForAgent(skillName: string, action: SkillAction, agent: string): ActionStep[] {
  if (action === "add") {
    return [
      { label: `Inspect target agent ${agent}`, args: ["skills", "list", "--agent", agent, "--json"] },
      { label: `Attach ${skillName} to ${agent}`, args: ["skills", "add", skillName, "--agent", agent, "--json"] },
      { label: "Verify assignment update", args: ["skills", "list", "--agent", agent, "--json"] },
    ];
  }
  return [
    { label: `Inspect target agent ${agent}`, args: ["skills", "list", "--agent", agent, "--json"] },
    { label: `Detach ${skillName} from ${agent}`, args: ["skills", "remove", skillName, "--agent", agent, "--json"] },
    { label: "Verify assignment update", args: ["skills", "list", "--agent", agent, "--json"] },
  ];
}

function buildActionCommandForAgent(skillName: string, action: SkillAction, agent: string): string {
  if (action === "explain") return `mah skills explain ${skillName}`;
  if (action === "inspect") return `mah skills inspect ${skillName}`;
  if (action === "add") return `mah skills add ${skillName} --agent ${agent}`;
  return `mah skills remove ${skillName} --agent ${agent}`;
}

function stepStatusToTone(status: ExecutionStepStatus): "running" | "completed" | "failed" {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function stepStatusToLabel(status: ExecutionStepStatus): string {
  if (status === "running") return "Running";
  if (status === "completed") return "Done";
  if (status === "failed") return "Failed";
  return "Pending";
}

export function SkillsManagement() {
  const [skillsData, setSkillsData] = useState<RealSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<InspectData | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [statusFilter, setStatusFilter] = useState<SkillEntry["status"] | "">("");
  const [scopeFilter, setScopeFilter] = useState<SkillEntry["scope"] | "">("");
  const [query, setQuery] = useState("");
  const [preparedCommand, setPreparedCommand] = useState("mah skills list --format table --scope all");
  const [execution, setExecution] = useState<ActionExecution | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [targetAgent, setTargetAgent] = useState<string>("");

  // Fetch skills list
  const fetchSkills = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["skills", "list", "--json"] }),
    })
      .then((r) => r.json())
      .then((payload: MahExecResponse) => {
        if (payload.ok && payload.stdout) {
          try {
            const parsed = JSON.parse(payload.stdout);
            setSkillsData(parsed.skills || []);
          } catch {
            setSkillsData([]);
          }
        } else {
          setError(payload.error || payload.stderr || "Failed to fetch skills");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // Fetch agents from config
  useEffect(() => {
    fetch("/api/mah/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.config?.crews) {
          const all = data.config.crews
            .flatMap((c: Record<string, unknown>) => (c.agents as Array<Record<string, unknown>>) ?? [])
            .map((a: Record<string, unknown>) => a.id as string);
          setAgents(all);
        }
      })
      .catch(() => {});
  }, []);

  // Derive display entries
  const skillEntries = useMemo(() => skillsData.map(realToEntry), [skillsData]);

  const filteredSkills = useMemo(() => {
    return skillEntries.filter((skill) => {
      if (statusFilter && skill.status !== statusFilter) return false;
      if (scopeFilter && skill.scope !== scopeFilter) return false;
      if (query && !skill.name.toLowerCase().includes(query.toLowerCase()) && !skill.attachedTo.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [skillEntries, statusFilter, scopeFilter, query]);

  const selectedSkill = filteredSkills.find((s) => s.id === selectedSkillId) ?? filteredSkills[0] ?? null;

  // Fetch inspect data when selection changes
  useEffect(() => {
    if (!selectedSkill) { setInspectData(null); return; }
    fetch("/api/mah/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: ["skills", "inspect", selectedSkill.name, "--json"] }),
    })
      .then((r) => r.json())
      .then((payload: MahExecResponse) => {
        if (payload.ok && payload.stdout) {
          try {
            setInspectData(JSON.parse(payload.stdout));
          } catch { setInspectData(null); }
        } else { setInspectData(null); }
      })
      .catch(() => setInspectData(null));
  }, [selectedSkill?.name]);

  function openActionPopup(action: SkillAction) {
    if (!selectedSkill) return;
    const agent = (action === "add" || action === "remove") ? (targetAgent || selectedSkill.attachedTo) : selectedSkill.attachedTo;
    if (action === "add" || action === "remove") setTargetAgent(agent);
    const command = buildActionCommandForAgent(selectedSkill.name, action, agent);
    const steps = (action === "add" || action === "remove")
      ? buildActionStepsForAgent(selectedSkill.name, action, agent)
      : buildActionSteps(selectedSkill.name, action, selectedSkill.attachedTo);
    setPreparedCommand(command);
    setExecution({
      action, command, steps,
      stepStatuses: steps.map(() => "pending"),
      completed: false, failed: false,
      logs: [`Ready to execute ${actionLabel(action)} for ${selectedSkill.name}. Target: ${agent}`],
    });
  }

  async function runNextStep() {
    if (!execution || execution.completed || isExecuting) return;
    const nextIndex = execution.stepStatuses.findIndex((s) => s !== "completed");
    if (nextIndex === -1) { setExecution((c) => c ? { ...c, completed: true } : c); return; }
    const step = execution.steps[nextIndex];
    if (!step) return;
    setIsExecuting(true);
    setExecution((c) => c ? {
      ...c, failed: false,
      stepStatuses: c.stepStatuses.map((s, i) => i === nextIndex ? "running" : s),
      logs: [...c.logs, `Running step ${nextIndex + 1}/${c.steps.length}: ${step.label}`],
    } : c);
    try {
      const response = await fetch("/api/mah/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: step.args }),
      });
      const payload = (await response.json()) as MahExecResponse;
      const stdout = `${payload.stdout || ""}`.trim();
      const stderr = `${payload.stderr || ""}`.trim();
      const success = response.ok && payload.ok && payload.status === 0;
      setExecution((c) => {
        if (!c) return c;
        const nextStatuses = c.stepStatuses.map((s, i) => i === nextIndex ? (success ? "completed" : "failed") : s);
        const allDone = nextStatuses.every((s) => s === "completed");
        const logs = [...c.logs, payload.command || `mah ${step.args.join(" ")}`,
          ...(stdout ? [`stdout: ${stdout.slice(0, 420)}`] : []),
          ...(stderr ? [`stderr: ${stderr.slice(0, 420)}`] : []),
          success ? `Step ${nextIndex + 1} completed.` : `Step ${nextIndex + 1} failed (exit ${payload.status}).`,
        ];
        if (allDone) logs.push("Action completed.");
        return { ...c, stepStatuses: nextStatuses, completed: allDone, failed: !success, logs };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecution((c) => c ? {
        ...c, failed: true,
        stepStatuses: c.stepStatuses.map((s, i) => i === nextIndex ? "failed" : s),
        logs: [...c.logs, `Step ${nextIndex + 1} failed: ${msg}`],
      } : c);
    } finally { setIsExecuting(false); }
  }

  if (loading) {
    return (
      <main className="skills-main">
        <div className="config-loading" style={{ padding: 48 }}>
          <span className="config-loading__spinner" />
          Loading skills…
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="skills-main">
        <section className="screen-header">
          <div>
            <h2>Skills Management</h2>
            <div className="screen-header__meta">
              <span className="screen-header__clusters">
                {filteredSkills.length} skills · {skillEntries.filter((s) => s.status === "active").length} installed · {skillEntries.reduce((sum, s) => sum + s.assignedCount, 0)} assignments
              </span>
            </div>
          </div>
          <CommandPreview context="dev-crew" command={preparedCommand} />
        </section>

        {error && (
          <div className="config-error-banner" style={{ margin: "0 32px" }}>
            <span>{error}</span>
            <button className="config-error-banner__dismiss" type="button" onClick={() => setError(null)}>×</button>
          </div>
        )}

        <section className="skills-main__toolbar">
          <input className="skills-filter" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by skill or agent…" aria-label="Filter skills" />
          <select className="skills-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SkillEntry["status"] | "")} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="active">Installed</option>
            <option value="disabled">Missing</option>
          </select>
          <select className="skills-filter" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as SkillEntry["scope"] | "")} aria-label="Filter by scope">
            <option value="">All scopes</option>
            <option value="global">Unassigned</option>
            <option value="agent">Assigned</option>
          </select>
        </section>

        <section className="skills-main__content">
          <div className="skills-mobile-actions" aria-label="Skill management actions">
            <button type="button" onClick={() => openActionPopup("explain")} disabled={!selectedSkill}><Icon name="info" size={16} />Explain</button>
            <button type="button" onClick={() => openActionPopup("inspect")} disabled={!selectedSkill}><Icon name="visibility" size={16} />Inspect</button>
            <button type="button" onClick={() => openActionPopup("add")} disabled={!selectedSkill}><Icon name="add_circle" size={16} />Add</button>
            <button type="button" className="skills-mobile-actions__remove" onClick={() => openActionPopup("remove")} disabled={!selectedSkill}><Icon name="remove_circle" size={16} />Remove</button>
          </div>
          <div className="skills-table">
            <table>
              <thead>
                <tr>
                  <th aria-label="Selected skill" />
                  <th>Skill</th>
                  <th>Category</th>
                  <th>Scope</th>
                  <th>Attached To</th>
                  <th>Status</th>
                  <th>Assignments</th>
                </tr>
              </thead>
              <tbody>
                {filteredSkills.map((skill) => {
                  const badge = statusToBadge(skill.status);
                  const selected = selectedSkill?.id === skill.id;
                  return (
                    <tr className={selected ? "is-selected" : ""} key={skill.id} onClick={() => setSelectedSkillId(skill.id)}>
                      <td><Icon name={selected ? "radio_button_checked" : "radio_button_unchecked"} className={selected ? "selection-icon selection-icon--active" : "selection-icon"} size={18} filled={selected} /></td>
                      <td className="skill-name">{skill.name}</td>
                      <td>{skill.category}</td>
                      <td>{skill.scope}</td>
                      <td><span className="skill-agent"><Icon name="smart_toy" size={14} />{skill.attachedTo}</span></td>
                      <td><StatusBadge tone={badge.tone} label={badge.label} /></td>
                      <td className="skill-usage">{skill.assignedCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="inspector" aria-label="Skill detail inspector">
        <section className="inspector__header">
          <div className="inspector__title-row">
            <div>
              <h3>Skill Detail</h3>
              <p>{inspectData?.title ?? selectedSkill?.name ?? "No skill selected"}</p>
            </div>
          </div>
        </section>
        <section className="inspector__body">
          {selectedSkill ? (
            <>
              <div className="inspector-stats">
                <div><span>Scope</span><strong>{selectedSkill.scope}</strong></div>
                <div><span>Status</span><strong>{selectedSkill.status === "active" ? "Installed" : "Missing"}</strong></div>
                <div><span>Assignments</span><strong>{selectedSkill.assignedCount}</strong></div>
                <div><span>Category</span><strong>{selectedSkill.category}</strong></div>
              </div>
              {inspectData ? (
                <>
                  <h4 className="skills-inspector__title">Summary</h4>
                  <p className="skills-inspector__summary">{inspectData?.description || inspectData?.summary || "No description available."}</p>
                  <h4 className="skills-inspector__title">Assigned Agents</h4>
                  <ul className="skills-inspector__refs">
                    {inspectData.assignments.map((a, i) => (
                      <li key={i}>{a.crew}/{a.agent} ({a.ref})</li>
                    ))}
                  </ul>
                  {inspectData.sections.length > 0 && (
                    <>
                      <h4 className="skills-inspector__title">Sections</h4>
                      <ul className="skills-inspector__refs">
                        {inspectData.sections.map((s) => <li key={s}>{s}</li>)}
                      </ul>
                    </>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--color-text-dim)", fontSize: 12 }}>Loading skill details…</p>
              )}
              <div className="skills-inspector__actions">
                <button type="button" onClick={() => openActionPopup("explain")}><Icon name="info" size={16} />Explain</button>
                <button type="button" onClick={() => openActionPopup("inspect")}><Icon name="visibility" size={16} />Inspect</button>
                <button type="button" onClick={() => openActionPopup("add")}><Icon name="add_circle" size={16} />Add to Agent</button>
                <button type="button" className="skills-inspector__remove" onClick={() => openActionPopup("remove")}><Icon name="remove_circle" size={16} />Remove from Agent</button>
              </div>
            </>
          ) : (
            <p className="skills-inspector__empty">No skill matches the current filters.</p>
          )}
        </section>
      </aside>

      {execution && selectedSkill ? (
        <div className="skills-action-modal" role="dialog" aria-modal="true" aria-label="Skill action execution dialog">
          <div className="skills-action-modal__backdrop" onClick={() => setExecution(null)} />
          <section className="skills-action-modal__panel">
            <header className="skills-action-modal__header">
              <div><h3>{actionLabel(execution.action)}</h3><p>{selectedSkill.name}</p></div>
              <button className="icon-button" type="button" aria-label="Close action dialog" onClick={() => setExecution(null)}><Icon name="close" /></button>
            </header>
            <div className="skills-action-modal__body">
              <div className="skills-action-modal__command"><CommandPreview context="skills-action" command={execution.command} /></div>
              {(execution.action === "add" || execution.action === "remove") && (
                <div className="skills-action-modal__agent-select">
                  <label>Target Agent</label>
                  <select value={targetAgent} onChange={(e) => {
                    const newAgent = e.target.value;
                    setTargetAgent(newAgent);
                    const newCmd = buildActionCommandForAgent(selectedSkill.name, execution.action, newAgent);
                    const newSteps = buildActionStepsForAgent(selectedSkill.name, execution.action, newAgent);
                    setExecution((prev) => prev ? { ...prev, command: newCmd, steps: newSteps, stepStatuses: newSteps.map(() => "pending"), logs: [`Target agent changed to ${newAgent}`] } : prev);
                    setPreparedCommand(newCmd);
                  }}>
                    {agents.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              )}
              <ol className="skills-action-steps">
                {execution.steps.map((step, index) => (
                  <li key={`${index}-${step.label}`}>
                    <span>{step.label}</span>
                    <StatusBadge tone={stepStatusToTone(execution.stepStatuses[index] ?? "pending")} label={stepStatusToLabel(execution.stepStatuses[index] ?? "pending")} />
                  </li>
                ))}
              </ol>
              <div className="skills-action-log" aria-live="polite">
                {execution.logs.map((logLine, index) => <p key={`${logLine}-${index}`}>{logLine}</p>)}
              </div>
            </div>
            <footer className="skills-action-modal__footer">
              <button type="button" onClick={() => setExecution(null)}>Close</button>
              <button type="button" className="skills-action-modal__run" onClick={runNextStep} disabled={execution.completed || isExecuting}>
                {execution.completed ? "Execution Complete" : isExecuting ? "Executing…" : execution.failed ? `Retry Step ${execution.stepStatuses.findIndex((s) => s !== "completed") + 1} of ${execution.steps.length}` : `Execute Step ${execution.stepStatuses.findIndex((s) => s !== "completed") + 1} of ${execution.steps.length}`}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
