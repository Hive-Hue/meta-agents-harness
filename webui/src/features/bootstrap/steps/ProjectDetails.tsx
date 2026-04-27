import type { WizardData } from "../BootstrapWizard";

type ProjectDetailsProps = {
  data: WizardData;
  onChange: (partial: Partial<WizardData>) => void;
};

const runtimes = [".pi/", ".claude/", ".opencode/", ".hermes/"];

export function ProjectDetails({ data, onChange }: ProjectDetailsProps) {
  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Project Details</h3>
      <p className="wizard-step__desc">
        Define your project identity and configuration.
      </p>
      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="project-name">Project Name</label>
          <input
            id="project-name"
            className="form-input"
            type="text"
            placeholder="my-mah-project"
            value={data.projectName ?? ""}
            onChange={(e) => onChange({ projectName: e.target.value })}
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="crew-id">Crew ID</label>
          <input
            id="crew-id"
            className="form-input"
            type="text"
            placeholder="dev"
            value={data.crewId ?? ""}
            onChange={(e) => onChange({ crewId: e.target.value })}
          />
        </div>
        <div className="form-field form-field--full">
          <label className="form-label" htmlFor="mission">Mission Statement</label>
          <textarea
            id="mission"
            className="form-textarea"
            placeholder="Describe the mission for your agent crew..."
            rows={4}
            value={data.missionStatement ?? ""}
            onChange={(e) => onChange({ missionStatement: e.target.value })}
          />
        </div>
        <div className="form-field form-field--full">
          <label className="form-label" htmlFor="description">Brief Description</label>
          <input
            id="description"
            className="form-input"
            type="text"
            placeholder="A short description of your project"
            value={data.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
        <div className="form-field form-field--full">
          <label className="form-label">Runtime</label>
          <div className="radio-group">
            {runtimes.map((rt) => (
              <label className="radio-option" key={rt}>
                <input
                  type="radio"
                  name="runtime"
                  value={rt}
                  checked={data.runtime === rt}
                  onChange={() => onChange({ runtime: rt })}
                />
                <span className="radio-option__label">{rt}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
