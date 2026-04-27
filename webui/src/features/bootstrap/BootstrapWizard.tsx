import { useState } from "react";
import { WizardStepper } from "./WizardStepper";
import { WizardInspector } from "./WizardInspector";
import { DetectWorkspace } from "./steps/DetectWorkspace";
import { SetupMode } from "./steps/SetupMode";
import { ProviderModel } from "./steps/ProviderModel";
import { ProjectDetails } from "./steps/ProjectDetails";
import { TopologyPreview } from "./steps/TopologyPreview";
import { ReviewWrite } from "./steps/ReviewWrite";
import { Icon } from "../../components/ui/Icon";
import "./bootstrap.css";

export type WizardData = {
  setupMode?: "logical" | "ai-assisted";
  provider?: string;
  apiKey?: string;
  model?: string;
  projectName?: string;
  crewId?: string;
  missionStatement?: string;
  description?: string;
  runtime?: string;
  confirmed?: boolean;
};

const STEPS = [
  "Detect Workspace",
  "Setup Mode",
  "Provider & Model",
  "Project Details",
  "Topology Preview",
  "Review & Write",
];

export function BootstrapWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({});

  const handleChange = (partial: Partial<WizardData>) => {
    setWizardData((prev) => ({ ...prev, ...partial }));
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <DetectWorkspace />;
      case 2:
        return <SetupMode data={wizardData} onChange={handleChange} />;
      case 3:
        return <ProviderModel data={wizardData} onChange={handleChange} />;
      case 4:
        return <ProjectDetails data={wizardData} onChange={handleChange} />;
      case 5:
        return <TopologyPreview data={wizardData} />;
      case 6:
        return <ReviewWrite data={wizardData} onChange={handleChange} />;
      default:
        return null;
    }
  };

  return (
    <>
      <main className="wizard-main">
        <section className="screen-header">
          <div>
            <h2>Bootstrap Wizard</h2>
            <p className="wizard-subtitle">
              Configure and generate your MAH project configuration
            </p>
          </div>
        </section>
        <WizardStepper steps={STEPS} currentStep={currentStep} />
        <section className="wizard-main__content">{renderStep()}</section>
        <footer className="wizard-nav">
          <button
            className="wizard-nav__btn wizard-nav__btn--back"
            type="button"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((s) => s - 1)}
          >
            <Icon name="arrow_back" size={16} />
            Back
          </button>
          <button
            className="wizard-nav__btn wizard-nav__btn--next"
            type="button"
            disabled={currentStep === 6}
            onClick={() => setCurrentStep((s) => s + 1)}
          >
            {currentStep === 6 ? "Finish" : "Next"}
            <Icon name="arrow_forward" size={16} />
          </button>
        </footer>
      </main>
      <aside className="inspector wizard-inspector" aria-label="Bootstrap inspector">
        <WizardInspector step={currentStep} data={wizardData} />
      </aside>
    </>
  );
}
