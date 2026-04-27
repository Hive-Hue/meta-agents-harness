import { useState } from "react";
import { Icon } from "../../components/ui/Icon";

type SettingsSectionProps = {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function SettingsSection({ title, badge, defaultOpen = true, children }: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="settings-section">
      <button
        className="settings-section__header"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="settings-section__title">{title}</span>
        {badge && <span className="settings-section__badge">{badge}</span>}
        <Icon name={open ? "expand_less" : "expand_more"} size={20} />
      </button>
      {open && <div className="settings-section__body">{children}</div>}
    </div>
  );
}
