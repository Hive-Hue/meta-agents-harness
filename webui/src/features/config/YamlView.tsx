import { useState, useEffect, useCallback } from "react";
import { Icon } from "../../components/ui/Icon";
import { useConfig, type MahConfig } from "./useConfigStore";
import yaml from "js-yaml";

export function YamlView() {
  const { config, updateConfig } = useConfig();
  const [content, setContent] = useState("");
  const [readOnly, setReadOnly] = useState(true);

  useEffect(() => {
    if (config && readOnly) {
      setContent(yaml.dump(config, { lineWidth: -1, quotingType: "'" }));
    }
  }, [config, readOnly]);

  const handleApply = useCallback(() => {
    try {
      const parsed = yaml.load(content) as Record<string, unknown>;
      updateConfig(parsed as Partial<MahConfig>);
      setReadOnly(true);
    } catch {
      // keep editing on parse error
    }
  }, [content, updateConfig]);

  const lines = content.split("\n");

  return (
    <div className="yaml-editor">
      <div className="yaml-editor__toolbar">
        <span className="yaml-editor__label">
          {readOnly ? "Read-only" : "Editing"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {!readOnly && (
            <button
              className="yaml-editor__toggle yaml-editor__toggle--active"
              type="button"
              onClick={handleApply}
            >
              <Icon name="check" size={14} />
              Apply
            </button>
          )}
          <button
            className={"yaml-editor__toggle" + (readOnly ? "" : " yaml-editor__toggle--active")}
            type="button"
            onClick={() => setReadOnly(!readOnly)}
          >
            <Icon name={readOnly ? "lock" : "edit"} size={14} />
            {readOnly ? "Edit" : "Lock"}
          </button>
        </div>
      </div>
      <div className="yaml-editor__body">
        <div className="yaml-editor__lines">
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        {readOnly ? (
          <pre className="yaml-editor__code">{content}</pre>
        ) : (
          <textarea
            className="yaml-editor__textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
