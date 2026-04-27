import type { WizardData } from "../BootstrapWizard";

type SetupModeProps = {
  data: WizardData;
  onChange: (partial: Partial<WizardData>) => void;
};

const modes = [
  {
    id: "logical" as const,
    title: "Logical Mode",
    description: "Structured, deterministic configuration with explicit declarations.",
    icon: "account_tree",
    features: [
      "Explicit agent and team declarations",
      "Deterministic routing and capabilities",
      "Full control over topology",
      "Manual review required for all changes",
    ],
  },
  {
    id: "ai-assisted" as const,
    title: "AI-Assisted Mode",
    description: "Intelligent defaults with AI-powered suggestions and auto-configuration.",
    icon: "auto_awesome",
    features: [
      "AI-powered topology suggestions",
      "Automatic capability detection",
      "Smart default routing",
      "Context-aware configuration",
    ],
  },
];

export function SetupMode({ data, onChange }: SetupModeProps) {
  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Select Setup Mode</h3>
      <p className="wizard-step__desc">
        Choose how you want to configure your MAH project.
      </p>
      <div className="mode-cards">
        {modes.map((mode) => (
          <button
            className={"mode-card" + (data.setupMode === mode.id ? " mode-card--selected" : "")}
            type="button"
            key={mode.id}
            onClick={() => onChange({ setupMode: mode.id })}
          >
            <div className="mode-card__header">
              <span className="material-symbols-outlined mode-card__icon">{mode.icon}</span>
              <h4 className="mode-card__title">{mode.title}</h4>
            </div>
            <p className="mode-card__desc">{mode.description}</p>
            <ul className="mode-card__features">
              {mode.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </div>
  );
}
