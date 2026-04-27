import { Icon } from "../../components/ui/Icon";

export function RoutingPreview() {
  return (
    <div className="routing-preview">
      <h4 className="routing-preview__title">Routing Preview</h4>
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
      <div className="routing-preview__command">
        $ mah run --task "..." --crew dev --runtime .pi/
      </div>
    </div>
  );
}
