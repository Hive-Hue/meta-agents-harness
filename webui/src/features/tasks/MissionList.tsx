import { Icon } from "../../components/ui/Icon";
import { useMissionData, type MissionInfo } from "./useMissionData";
import type { TaskRecord } from "./useTasksData";

interface MissionListProps {
  tasks: TaskRecord[];
  onSelectMission: (missionId: string) => void;
}

export function MissionList({ tasks, onSelectMission }: MissionListProps) {
  const missions = useMissionData(tasks);

  return (
    <div className="mission-list">
      {missions.map(mission => (
        <button
          key={mission.id}
          type="button"
          className="mission-card"
          onClick={() => onSelectMission(mission.id)}
        >
          <div className="mission-card__header">
            <span className="mission-card__id">{mission.id}</span>
            <span className="mission-card__count">{mission.task_count} tasks</span>
          </div>
          <div className="mission-card__name">{mission.name}</div>
          <div className="mission-card__progress">
            <div className="mission-card__progress-bar">
              <div
                className="mission-card__progress-fill"
                style={{ width: `${mission.progress_pct}%` }}
              />
            </div>
            <span className="mission-card__progress-label">{mission.progress_pct}%</span>
          </div>
          <div className="mission-card__stats">
            <span className="mission-card__stat mission-card__stat--done">
              <Icon name="check_circle" size={12} />
              {mission.done_count} done
            </span>
            {mission.in_progress_count > 0 && (
              <span className="mission-card__stat mission-card__stat--wip">
                <Icon name="play_arrow" size={12} />
                {mission.in_progress_count} in progress
              </span>
            )}
            {mission.blocked_count > 0 && (
              <span className="mission-card__stat mission-card__stat--blocked">
                <Icon name="block" size={12} />
                {mission.blocked_count} blocked
              </span>
            )}
          </div>
        </button>
      ))}
      {missions.length === 0 && (
        <div className="empty-state" style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
          No missions found. Add tasks with mission IDs to see mission cards.
        </div>
      )}
    </div>
  );
}