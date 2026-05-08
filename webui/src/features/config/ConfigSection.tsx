import { useState } from "react";
import { Icon } from "../../components/ui/Icon";

type ConfigSectionProps = {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function ConfigSection({ title, badge, defaultOpen = true, children }: ConfigSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="config-section">
      <button
        className="config-section__header"
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="config-section__title">{title}</span>
        {badge && <span className="config-section__badge">{badge}</span>}
        <Icon name={open ? "expand_less" : "expand_more"} size={20} />
      </button>
      {open && <div className="config-section__body">{children}</div>}
    </div>
  );
}
