import { Icon } from "../../components/ui/Icon";

type RoutingPreviewProps = {
  crew: string;
  runtime: string;
  taskText: string;
  onClose: () => void;
  onRefresh: () => void;
};

export function RoutingPreview({ crew, runtime, taskText, onClose, onRefresh }: RoutingPreviewProps) {
  return (
    <div className="routing-preview">
      <div className="routing-preview__header">
        <h4 className="routing-preview__title">Routing Preview</h4>
        <div className="routing-preview__actions">
          <button type="button" onClick={onRefresh} title="Refresh routing">
            <Icon name="refresh" size={14} />
          </button>
          <button type="button" onClick={onClose} title="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
      <div className="routing-preview__command">
        $ mah --runtime {runtime || "<runtime>"} --headless run --crew {crew || "<crew>"} --task "{taskText.slice(0, 40)}{taskText.length > 40 ? "..." : ""}"
      </div>
    </div>
  );
}
