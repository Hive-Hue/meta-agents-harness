import { useEffect, useState } from "react";
import { Icon } from "../../../components/ui/Icon";
import { useWorkspace } from "../../../contexts/WorkspaceContext";

interface DetectionItem {
  label: string;
  status: "found" | "warning" | "missing";
  detail: string;
}

type DetectResponse = {
  ok: boolean;
  detections?: DetectionItem[];
  error?: string;
};

export function DetectWorkspace() {
  const { workspacePath } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch("/api/mah/bootstrap/detect", {
          method: "GET",
          headers: { "x-mah-workspace-path": workspacePath },
          signal: controller.signal,
        });
        const payload = (await resp.json()) as DetectResponse;
        if (!resp.ok || payload.ok === false) {
          throw new Error(payload.error || `Detection failed (${resp.status})`);
        }
        setDetections(Array.isArray(payload.detections) ? payload.detections : []);
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setDetections([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [workspacePath]);

  return (
    <div className="wizard-step">
      <h3 className="wizard-step__title">Workspace Detection</h3>
      <p className="wizard-step__desc">
        Scanning your project directory for existing MAH configuration and runtime markers.
      </p>

      {loading ? <div className="loading-state">Scanning workspace…</div> : null}
      {error ? <div className="wizard-warning-box"><Icon name="warning" size={16} /><p>{error}</p></div> : null}

      {!loading ? (
        <ul className="detection-list">
          {detections.map((item) => (
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
      ) : null}

      <div className="wizard-info-box">
        <Icon name="info" size={16} />
        <p>
          Detection runs against the current Workspace Path and updates when the path changes in Settings.
        </p>
      </div>
    </div>
  );
}
