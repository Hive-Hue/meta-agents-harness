type ToggleSwitchProps = {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  disabled?: boolean;
};

export function ToggleSwitch({ checked, onChange, label, disabled }: ToggleSwitchProps) {
  return (
    <label className="toggle-switch">
      <input
        className="toggle-switch__input"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className={"toggle-switch__track" + (checked ? " toggle-switch__track--checked" : "")}>
        <span className="toggle-switch__thumb" />
      </span>
      <span className="toggle-switch__label">{label}</span>
    </label>
  );
}
