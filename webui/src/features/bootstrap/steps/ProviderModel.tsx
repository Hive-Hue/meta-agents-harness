import type { WizardData } from "../BootstrapWizard";
import { Icon } from "../../../components/ui/Icon";
import { SecretInput } from "../components/SecretInput";

type ProviderModelProps = {
  data: WizardData;
  onChange: (partial: Partial<WizardData>) => void;
};

const providers = [
  { id: "zai", name: "Z.ai", description: "GLM series models", models: ["glm-5", "glm-4.7", "glm-4.1"] },
  { id: "openrouter", name: "OpenRouter", description: "Multi-provider gateway", models: ["claude-sonnet-4", "gpt-4o", "gemini-2.5-pro"] },
  { id: "codex", name: "Codex OAuth", description: "OpenAI native", models: ["codex-1", "o4-mini", "gpt-4.1"] },
  { id: "minimax", name: "MiniMax", description: "Cost-optimized models", models: ["MiniMax-M1", "abab-7"] },
];

export function ProviderModel({ data, onChange }: ProviderModelProps) {
  const selectedProvider = providers.find((p) => p.id === data.provider);

  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Provider &amp; Model</h3>
      <p className="wizard-step__desc">Select your AI provider and configure the model.</p>
      <div className="provider-grid">
        {providers.map((provider) => (
          <button
            className={"provider-card" + (data.provider === provider.id ? " provider-card--selected" : "")}
            type="button"
            key={provider.id}
            onClick={() => onChange({ provider: provider.id, model: provider.models[0] })}
          >
            <h4 className="provider-card__name">{provider.name}</h4>
            <p className="provider-card__desc">{provider.description}</p>
          </button>
        ))}
      </div>

      {selectedProvider && (
        <div className="provider-config">
          <SecretInput
            label="API Key"
            value={data.apiKey ?? ""}
            onChange={(val) => onChange({ apiKey: val })}
            placeholder="Enter your API key"
          />
          <div className="form-field">
            <label className="form-label" htmlFor="model-select">Model</label>
            <select
              id="model-select"
              className="form-select"
              value={data.model ?? ""}
              onChange={(e) => onChange({ model: e.target.value })}
            >
              {selectedProvider.models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="wizard-info-box">
        <Icon name="info" size={16} />
        <p>
          If no provider is selected, MAH defaults to Z.ai with GLM-4.7. You can change
          this later in your configuration file.
        </p>
      </div>
    </div>
  );
}
