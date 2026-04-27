import { Icon } from "../../components/ui/Icon";

type FormFieldProps = {
  label: string;
  type?: "text" | "select" | "textarea" | "number";
  value: string;
  onChange?: (val: string) => void;
  disabled?: boolean;
  mono?: boolean;
  copyable?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  rows?: number;
  min?: number;
  max?: number;
  suffix?: string;
};

export function FormField({
  label,
  type = "text",
  value,
  onChange,
  disabled = false,
  mono = false,
  copyable = false,
  hint,
  options,
  placeholder,
  rows,
  min,
  max,
  suffix,
}: FormFieldProps) {
  const inputClass = "settings-field__input" + (mono ? " settings-field__input--mono" : "");

  const renderInput = () => {
    if (type === "select") {
      return (
        <select
          className={inputClass}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
        >
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }
    if (type === "textarea") {
      return (
        <textarea
          className="settings-field__textarea"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          rows={rows ?? 3}
        />
      );
    }
    return (
      <div className="settings-field__row">
        <input
          className={inputClass}
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          min={min}
          max={max}
          style={{ flex: 1 }}
        />
        {suffix && <span style={{ fontSize: 12, color: "#94a3b8" }}>{suffix}</span>}
        {copyable && (
          <button className="settings-field__copy-btn" type="button" aria-label="Copy">
            <Icon name="content_copy" size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="settings-field">
      <label className="settings-field__label">{label}</label>
      {renderInput()}
      {hint && <span className="settings-field__hint">{hint}</span>}
    </div>
  );
}
