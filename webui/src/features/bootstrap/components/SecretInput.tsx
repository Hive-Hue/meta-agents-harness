import { useState } from "react";
import { Icon } from "../../../components/ui/Icon";

type SecretInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SecretInput({ label, value, onChange, placeholder }: SecretInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <div className="secret-input-wrapper">
        <input
          className="form-input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          className="secret-input__toggle"
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide" : "Show"}
        >
          <Icon name={visible ? "visibility_off" : "visibility"} size={18} />
        </button>
      </div>
    </div>
  );
}
