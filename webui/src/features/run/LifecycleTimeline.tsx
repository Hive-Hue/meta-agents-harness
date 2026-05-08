import { Icon } from "../../components/ui/Icon";

export interface LifecycleEvent {
  time: string;
  state: "queued" | "routed" | "running" | "completed" | "failed";
  label: string;
  desc: string;
  active?: boolean;
}

type LifecycleTimelineProps = {
  events: LifecycleEvent[];
};

export function LifecycleTimeline({ events }: LifecycleTimelineProps) {
  return (
    <ol className="lifecycle-timeline">
      {events.map((event, i) => (
        <li
          className={
            "lifecycle-event lifecycle-event--" + event.state +
            (event.active ? " lifecycle-event--active" : "")
          }
          key={i}
        >
          <span className="lifecycle-event__time">{event.time}</span>
          <span className="lifecycle-event__marker">
            <span className="lifecycle-event__dot" />
            {i < events.length - 1 && <span className="lifecycle-event__line" />}
          </span>
          <span className="lifecycle-event__content">
            <span className="lifecycle-event__label">{event.label}</span>
            <span className="lifecycle-event__desc">{event.desc}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
