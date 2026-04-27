import { Icon } from "../../../components/ui/Icon";

interface DetectionItem {
  label: string;
  status: "found" | "warning" | "missing";
  detail: string;
}

const mockDetections: DetectionItem[] = [
  { label: "Workspace Root", status: "found", detail: "/home/user/my-project" },
  { label: "MAH Configuration", status: "warning", detail: "No meta-agents.yaml found" },
  { label: "Runtime Markers", status: "found", detail: ".pi/ directory detected" },
  { label: "Git Repository", status: "found", detail: "Clean working tree on main" },
  { label: "MAH Version", status: "found", detail: "v0.8.0 installed" },
  { label: "Expertise Registry", status: "warning", detail: "No expertise entries found" },
  { label: "Context Memory", status: "missing", detail: "No context memory corpus" },
];

export function DetectWorkspace() {
  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Workspace Detection</h3>
      <p className="wizard-step__desc">
        Scanning your project directory for existing MAH configuration and runtime markers.
      </p>
      <ul className="detection-list">
        {mockDetections.map((item) => (
          <li className={"detection-item detection-item--" + item.status} key={item.label}>
            <Icon
              name={
                item.status === "found"
                  ? "check_circle"
                  : item.status === "warning"
                    ? "warning"
                    : "cancel"
              }
              size={18}
            />
            <div className="detection-item__content">
              <span className="detection-item__label">{item.label}</span>
              <span className="detection-item__detail">{item.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="wizard-info-box">
        <Icon name="info" size={16} />
        <p>
          The wizard will use detected information to pre-fill configuration where possible.
          You can override any detected values in subsequent steps.
        </p>
      </div>
    </div>
  );
}
