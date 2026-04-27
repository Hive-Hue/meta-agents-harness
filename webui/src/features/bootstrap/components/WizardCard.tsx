import { Icon } from "../../../components/ui/Icon";

type WizardCardProps = {
  title: string;
  description: string;
  icon?: string;
  selected: boolean;
  onClick: () => void;
  features?: string[];
};

export function WizardCard({ title, description, icon, selected, onClick, features }: WizardCardProps) {
  return (
    <button
      className={"wizard-card" + (selected ? " wizard-card--selected" : "")}
      type="button"
      onClick={onClick}
    >
      <div className="wizard-card__header">
        {icon && <span className="material-symbols-outlined">{icon}</span>}
        <h4 className="wizard-card__title">{title}</h4>
      </div>
      <p className="wizard-card__desc">{description}</p>
      {features && features.length > 0 && (
        <ul className="wizard-card__features">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </button>
  );
}
