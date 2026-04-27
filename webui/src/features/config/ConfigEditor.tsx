import { useState, useCallback } from "react";
import { Icon } from "../../components/ui/Icon";
import { ConfigProvider, useConfig } from "./useConfigStore";
import { ConfigInspector } from "./ConfigInspector";
import { StructuredView } from "./StructuredView";
import { YamlView } from "./YamlView";
import { DiffView } from "./DiffView";
import "./config.css";

type ViewMode = "structured" | "yaml" | "diff";

const tabs: { id: ViewMode; label: string }[] = [
  { id: "structured", label: "Structured" },
  { id: "yaml", label: "YAML" },
  { id: "diff", label: "Diff" },
];

function ConfigEditorInner() {
  const { isDirty, error, saveConfig, reloadConfig, loading } = useConfig();
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewMode>("structured");

  const displayError = localError ?? error;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setLocalError(null);
    try {
      await saveConfig();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [saveConfig]);

  const handleDiscard = useCallback(async () => {
    try {
      await reloadConfig();
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }, [reloadConfig]);

  const renderView = () => {
    switch (activeView) {
      case "structured":
        return <StructuredView />;
      case "yaml":
        return <YamlView />;
      case "diff":
        return <DiffView />;
    }
  };

  return (
    <>
      <main className="config-main">
        <section className="config-header">
          <div className="config-header__top">
            <div>
              <h2>Config Editor{isDirty ? " *" : ""}</h2>
              <p className="config-header__subtitle">
                Edit meta-agents.yaml — source of truth for crews, agents, skills, and domains
              </p>
            </div>
            <div className="config-header__actions">
              <button
                className="config-action-btn config-action-btn--primary"
                type="button"
                disabled={saving || !isDirty}
                onClick={handleSave}
              >
                <Icon name={saving ? "hourglass_empty" : "save"} size={14} />
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                className="config-action-btn"
                type="button"
                disabled={!isDirty}
                onClick={handleDiscard}
              >
                <Icon name="undo" size={14} />
                Discard
              </button>
            </div>
          </div>
          {displayError && (
            <div className="config-error-banner">
              <span>{displayError}</span>
              <button
                className="config-error-banner__dismiss"
                type="button"
                onClick={() => setLocalError(null)}
              >
                ×
              </button>
            </div>
          )}
          <div className="config-tabs">
            {tabs.map((tab) => (
              <button
                className={"config-tab" + (activeView === tab.id ? " config-tab--active" : "")}
                key={tab.id}
                type="button"
                onClick={() => setActiveView(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>
        <div className="config-body">
          <section className="config-content">
            {loading ? (
              <div className="config-loading">
                <span className="config-loading__spinner" />
                Loading config…
              </div>
            ) : (
              renderView()
            )}
          </section>
        </div>
      </main>
      <aside className="inspector config-inspector" aria-label="Config inspector">
        <ConfigInspector />
      </aside>
    </>
  );
}

export function ConfigEditor() {
  return (
    <ConfigProvider>
      <ConfigEditorInner />
    </ConfigProvider>
  );
}
