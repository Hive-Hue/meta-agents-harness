import { Icon } from "../../components/ui/Icon";

type WizardStepperProps = {
  steps: string[];
  currentStep: number;
};

export function WizardStepper({ steps, currentStep }: WizardStepperProps) {
  return (
    <div className="wizard-stepper" role="navigation" aria-label="Wizard steps">
      {steps.map((label, index) => {
        const stepNum = index + 1;
        const isCompleted = stepNum < currentStep;
        const isActive = stepNum === currentStep;

        return (
          <div
            className={`wizard-stepper__step${
              isActive ? " wizard-stepper__step--active" : ""
            }${isCompleted ? " wizard-stepper__step--completed" : ""}`}
            key={label}
          >
            <span className="wizard-stepper__indicator">
              {isCompleted ? (
                <Icon name="check_circle" size={20} />
              ) : (
                <span className="wizard-stepper__number">{stepNum}</span>
              )}
            </span>
            <span className="wizard-stepper__label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
