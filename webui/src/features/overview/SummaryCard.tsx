import { Icon } from "../../components/ui/Icon";
import { StatusBadge } from "../../components/ui/StatusBadge";

type SummaryCardProps = {
  icon: string;
  title: string;
  status?: { tone: "running" | "completed" | "failed"; label: string };
  stats: { label: string; value: string }[];
  actionLabel: string;
};

export function SummaryCard({ icon, title, status, stats, actionLabel }: SummaryCardProps) {
  return (
    <div className="overview-card">
      <div className="overview-card__header">
        <Icon name={icon} size={20} />
        <h4 className="overview-card__title">{title}</h4>
        {status && <StatusBadge tone={status.tone} label={status.label} />}
      </div>
      <div className="overview-card__body">
        {stats.map((stat) => (
          <div className="overview-card__stat" key={stat.label}>
            <span className="overview-card__stat-label">{stat.label}</span>
            <span className="overview-card__stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
      <div className="overview-card__action">
        <span className="overview-card__action-link">{actionLabel}</span>
        <Icon name="arrow_forward" size={14} />
      </div>
    </div>
  );
}
