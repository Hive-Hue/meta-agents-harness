import { Icon } from "./Icon";

type StatusTone = "running" | "completed" | "failed";

type StatusBadgeProps = {
  tone: StatusTone;
  label: string;
};

const statusIconByTone: Record<StatusTone, string> = {
  running: "radio_button_checked",
  completed: "check_circle",
  failed: "error",
};

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <Icon name={statusIconByTone[tone]} size={14} />
      {label}
    </span>
  );
}
