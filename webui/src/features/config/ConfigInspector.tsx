import { CommandPreview } from "../../components/ui/CommandPreview";
import { Icon } from "../../components/ui/Icon";

const validationChecks = [
  { label: "Schema valid", status: "pass" as const },
  { label: "All model refs resolved", status: "pass" as const },
  { label: "Domain profiles exist", status: "pass" as const },
  { label: "No circular agent refs", status: "pass" as const },
];

const warnings = [
  "Broad write access in runtime_impl profile",
];

export function ConfigInspector() {
  return (
    <>
      <section className="inspector__header">
        <h3>Config Inspector</h3>
      </section>
      <section className="inspector__body">
        <div className="config-inspector__command">
          <CommandPreview context="config" command="mah config validate" />
        </div>

        <div className="config-inspector__summary">
          <h4 className="config-inspector__section-title">Config Summary</h4>
          <dl className="config-inspector__fields">
            <div className="config-inspector__field">
              <dt>File</dt>
              <dd>meta-agents.yaml</dd>
            </div>
            <div className="config-inspector__field">
              <dt>Modified</dt>
              <dd>2 min ago</dd>
            </div>
            <div className="config-inspector__field">
              <dt>Lines</dt>
              <dd>847</dd>
            </div>
          </dl>
        </div>

        <div className="config-inspector__validation">
          <h4 className="config-inspector__section-title">Validation</h4>
          <ul className="config-inspector__checks">
            {validationChecks.map((check) => (
              <li className="config-inspector__check config-inspector__check--pass" key={check.label}>
                <Icon name="check_circle" size={14} />
                <span>{check.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {warnings.length > 0 && (
          <div className="config-inspector__warnings">
            <h4 className="config-inspector__section-title">Warnings</h4>
            <ul className="config-inspector__warning-list">
              {warnings.map((w) => (
                <li className="config-inspector__warning-item" key={w}>
                  <Icon name="warning" size={14} />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="config-inspector__actions">
          <button className="config-inspector__action-btn config-inspector__action-btn--primary" type="button">
            <Icon name="save" size={14} />
            Save Config
          </button>
          <button className="config-inspector__action-btn" type="button">
            <Icon name="undo" size={14} />
            Discard Changes
          </button>
          <button className="config-inspector__action-btn" type="button">
            <Icon name="play_arrow" size={14} />
            Dry-Run Sync
          </button>
        </div>
      </section>
    </>
  );
}
