import { Icon } from "../../components/ui/Icon";

type RoutingPreviewProps = {
  crew: string;
  runtime: string;
  routingScope: "active_crew" | "full_crews";
  taskText: string;
  onClose: () => void;
  onRefresh: () => void;
};

export function RoutingPreview({ crew, runtime, routingScope, taskText, onClose, onRefresh }: RoutingPreviewProps) {
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
      <div className="routing-preview__agent">
        <Icon name="smart_toy" size={20} />
        <span className="routing-preview__agent-name">engineering-lead</span>
        <span className="routing-preview__confidence">confidence: 0.87</span>
      </div>
      <div className="routing-preview__caps">
        <span className="routing-preview__cap">delegation</span>
        <span className="routing-preview__cap">architecture</span>
        <span className="routing-preview__cap">code-review</span>
      </div>
      <div className="routing-preview__fallbacks">
        Fallback candidates: <strong>backend-dev</strong> (0.72), <strong>frontend-dev</strong> (0.65)
      </div>
      <div className="routing-preview__fallbacks">
        Context docs: 3 documents (2.4KB total)
      </div>
      <div className="routing-preview__fallbacks">
        Domain: <strong>runtime_impl</strong> — can edit scripts, types, tests
      </div>
      <div className="routing-preview__fallbacks">
        Scope: <strong>{routingScope === "full_crews" ? "full_crews" : "active_crew"}</strong>
      </div>
      <div className="routing-preview__command">
        $ mah --runtime {runtime || "<runtime>"} --headless run --crew {crew || "<crew>"} {routingScope === "full_crews" ? "--full-crews " : ""}--task "{taskText.slice(0, 40)}{taskText.length > 40 ? "..." : ""}"
      </div>
    </div>
  );
}
