import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";
import type { WizardData } from "./BootstrapWizard";

type WizardInspectorProps = {
  step: number;
  data: WizardData;
};

const stepTips: Record<number, { title: string; tip: string }> = {
  1: {
    title: "Workspace Detection",
    tip: "The wizard scans your project directory for existing MAH configuration, runtime markers, and git status.",
  },
  2: {
    title: "Setup Mode",
    tip: "Logical mode provides structured configuration. AI-Assisted mode enables intelligent defaults and suggestions.",
  },
  3: {
    title: "Provider & Model",
    tip: "Select your AI provider and model. The API key is stored locally and never sent to external services.",
  },
  4: {
    title: "Project Details",
    tip: "Define your project identity and mission. This information is used to generate the crew configuration.",
  },
  5: {
    title: "Topology Preview",
    tip: "Customize teams and agent density. The wizard updates topology and YAML in real time.",
  },
  6: {
    title: "Review & Write",
    tip: "Final review of the generated configuration. Verify all settings before writing to disk.",
  },
};

function getCommand(step: number, data: WizardData): string {
  const normalizeRuntime = (value?: string) => {
    const raw = `${value || ""}`.trim();
    if (!raw) return "";
    if (raw === ".pi/") return "pi";
    if (raw === ".claude/") return "claude";
    if (raw === ".opencode/") return "opencode";
    if (raw === ".openclaude/") return "openclaude";
    if (raw === ".hermes/") return "hermes";
    if (raw === ".kilo/") return "kilo";
    if (raw === ".codex/") return "codex";
    return raw.replace(/^\.|\/$/g, "");
  };

  const parts = ["mah init"];
  if (data.setupMode === "ai-assisted") parts.push("--ai");
  if (data.requireSprintMode) parts.push("--require-sprint-mode");
  if (data.provider) parts.push("--provider " + data.provider);
  const runtime = normalizeRuntime(data.runtime);
  if (runtime) parts.push("--runtime " + runtime);
  if (data.projectName) parts.push('--name "' + data.projectName + '"');
  return parts.join(" ");
}

export function WizardInspector({ step, data }: WizardInspectorProps) {
  const info = stepTips[step];

  return (
    <>
      <section className="inspector__header">
        <h3>{info?.title ?? "Bootstrap Inspector"}</h3>
      </section>
      <section className="inspector__body">
        <div className="wizard-inspector__command">
          <CommandPreview
            context="bootstrap"
            command={getCommand(step, data)}
          />
        </div>
        <div className="wizard-inspector__tip">
          <Icon name="lightbulb" size={16} />
          <p>{info?.tip ?? ""}</p>
        </div>
        <div className="wizard-inspector__status">
          <h4>Configuration Status</h4>
          <ul className="wizard-inspector__checklist">
            <li className={data.setupMode ? "valid" : "pending"}>
              <Icon name={data.setupMode ? "check_circle" : "radio_button_unchecked"} size={14} />
              Setup mode
            </li>
            <li className={data.provider ? "valid" : "pending"}>
              <Icon name={data.provider ? "check_circle" : "radio_button_unchecked"} size={14} />
              Provider selected
            </li>
            <li className={data.apiKey ? "valid" : "pending"}>
              <Icon name={data.apiKey ? "check_circle" : "radio_button_unchecked"} size={14} />
              API key
            </li>
            <li className={data.projectName ? "valid" : "pending"}>
              <Icon name={data.projectName ? "check_circle" : "radio_button_unchecked"} size={14} />
              Project name
            </li>
            <li className={data.runtime ? "valid" : "pending"}>
              <Icon name={data.runtime ? "check_circle" : "radio_button_unchecked"} size={14} />
              Runtime
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
