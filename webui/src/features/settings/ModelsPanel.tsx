import { useState, useCallback, useEffect, useMemo } from "react";
import { Icon } from "../../components/ui/Icon";
import { useConfig } from "../config/useConfigStore";
import { SettingsSection } from "./SettingsSection";

interface AvailModel {
  provider: string;
  model_id: string;
  display_name?: string;
}

export function ModelsPanel() {
  const { config, updateConfig } = useConfig();
  const [adding, setAdding] = useState(false);
  const [addProvider, setAddProvider] = useState("");
  const [addModelId, setAddModelId] = useState("");
  const [addDisplayName, setAddDisplayName] = useState("");
  const [expandedFallbacks, setExpandedFallbacks] = useState<Set<string>>(new Set());
  const [addingFallback, setAddingFallback] = useState<string | null>(null);
  const [newFallback, setNewFallback] = useState("");
  const modelsStorageKey = useMemo(() => {
    const workspacePath = localStorage.getItem("mah_workspace_path") || "default";
    return `mah_settings_available_models:${workspacePath}`;
  }, []);
  const fallbacksStorageKey = useMemo(() => {
    const workspacePath = localStorage.getItem("mah_workspace_path") || "default";
    return `mah_settings_model_fallbacks:${workspacePath}`;
  }, []);

  const available = config?.catalog?.available_models ?? [];
  const fallbacks = config?.catalog?.model_fallbacks ?? {};

  useEffect(() => {
    const raw = localStorage.getItem(modelsStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const restored = parsed.filter((item) =>
        item &&
        typeof item === "object" &&
        typeof item.provider === "string" &&
        typeof item.model_id === "string"
      );
      if (!restored.length) return;
      if (JSON.stringify(restored) === JSON.stringify(available)) return;
      updateConfig({ catalog: { ...config?.catalog, available_models: restored } });
    } catch {
      // ignore malformed persisted state
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsStorageKey]);

  useEffect(() => {
    localStorage.setItem(modelsStorageKey, JSON.stringify(available));
  }, [available, modelsStorageKey]);

  useEffect(() => {
    const raw = localStorage.getItem(fallbacksStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const restored = Object.fromEntries(
        Object.entries(parsed).map(([role, values]) => [
          role,
          Array.isArray(values) ? values.filter((item) => typeof item === "string") : [],
        ])
      );
      if (JSON.stringify(restored) === JSON.stringify(fallbacks)) return;
      updateConfig({ catalog: { ...config?.catalog, model_fallbacks: restored } });
    } catch {
      // ignore malformed persisted state
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbacksStorageKey]);

  useEffect(() => {
    localStorage.setItem(fallbacksStorageKey, JSON.stringify(fallbacks));
  }, [fallbacks, fallbacksStorageKey]);

  // All unique model strings for fallback dropdown
  const allModelStrings = [...new Set(
    available.map((m) => `${m.provider}/${m.model_id}`)
      .concat(Object.values(config?.catalog?.models ?? {}))
      .concat(Object.values(fallbacks).flat())
  )];

  // Seed logic
  const handleSeed = useCallback(() => {
    const models = new Set<string>();
    const src = config?.catalog?.models ?? {};
    const fb = config?.catalog?.model_fallbacks ?? {};
    const overrides = config?.runtimes ?? {};
    Object.values(src).forEach((m) => models.add(m));
    Object.values(fb).forEach((arr) => arr.forEach((m) => models.add(m)));
    Object.values(overrides).forEach((rt) => {
      if (rt?.model_overrides) Object.values(rt.model_overrides).forEach((m) => models.add(m));
    });
    const seeded: AvailModel[] = [];
    const seen = new Set<string>();
    models.forEach((m) => {
      const idx = m.indexOf("/");
      const provider = idx >= 0 ? m.slice(0, idx) : "openai";
      const model_id = idx >= 0 ? m.slice(idx + 1) : m;
      const key = `${provider}/${model_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        seeded.push({ provider, model_id });
      }
    });
    updateConfig({ catalog: { ...config?.catalog, available_models: seeded } });
  }, [config, updateConfig]);

  const commitAvailable = useCallback(
    (next: AvailModel[]) => updateConfig({ catalog: { ...config?.catalog, available_models: next } }),
    [config, updateConfig],
  );

  const updateDisplayName = useCallback(
    (idx: number, val: string) => {
      const next = [...available];
      next[idx] = { ...next[idx], display_name: val || undefined };
      commitAvailable(next);
    },
    [available, commitAvailable],
  );

  const deleteModel = useCallback(
    (idx: number) => commitAvailable(available.filter((_, i) => i !== idx)),
    [available, commitAvailable],
  );

  const confirmAdd = useCallback(() => {
    const provider = addProvider.trim();
    const modelId = addModelId.trim();
    if (!provider || !modelId) return;
    commitAvailable([...available, { provider, model_id: modelId, display_name: addDisplayName.trim() || undefined }]);
    setAdding(false);
    setAddProvider("");
    setAddModelId("");
    setAddDisplayName("");
  }, [addProvider, addModelId, addDisplayName, available, commitAvailable]);

  const commitFallbacks = useCallback(
    (next: Record<string, string[]>) => updateConfig({ catalog: { ...config?.catalog, model_fallbacks: next } }),
    [config, updateConfig],
  );

  const removeFallback = useCallback(
    (role: string, idx: number) => {
      const arr = [...(fallbacks[role] ?? [])];
      arr.splice(idx, 1);
      commitFallbacks({ ...fallbacks, [role]: arr });
    },
    [fallbacks, commitFallbacks],
  );

  const moveFallback = useCallback(
    (role: string, idx: number, dir: -1 | 1) => {
      const arr = [...(fallbacks[role] ?? [])];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      commitFallbacks({ ...fallbacks, [role]: arr });
    },
    [fallbacks, commitFallbacks],
  );

  const confirmAddFallback = useCallback(
    (role: string) => {
      if (!newFallback.trim()) return;
      const arr = [...(fallbacks[role] ?? []), newFallback.trim()];
      commitFallbacks({ ...fallbacks, [role]: arr });
      setAddingFallback(null);
      setNewFallback("");
    },
    [newFallback, fallbacks, commitFallbacks],
  );

  // Group available models by provider
  const grouped = new Map<string, AvailModel[]>();
  available.forEach((m) => {
    const arr = grouped.get(m.provider) ?? [];
    arr.push(m);
    grouped.set(m.provider, arr);
  });

  return (
    <>
      <SettingsSection title="Providers & Models" badge={String(available.length)}>
        {available.length === 0 ? (
          <div className="models-panel__empty">
            <p>No models registered yet.</p>
            <button className="models-panel__seed-btn" type="button" onClick={handleSeed}>
              <Icon name="auto_fix_high" size={14} />
              Seed from current config
            </button>
          </div>
        ) : (
          <>
            {Array.from(grouped.entries()).map(([provider, models]) => (
              <div className="models-panel__provider-group" key={provider}>
                <div className="models-panel__provider-header">
                  {provider}
                  <span className="models-panel__provider-badge">{models.length}</span>
                </div>
                {models.map((m) => {
                  const idx = available.indexOf(m);
                  return (
                    <div className="models-panel__model-row" key={`${m.provider}/${m.model_id}`}>
                      <span className="models-panel__model-provider">{m.provider}</span>
                      <span className="models-panel__model-id">{m.model_id}</span>
                      <input
                        className="models-panel__display-name-input"
                        type="text"
                        placeholder={m.model_id}
                        value={m.display_name ?? ""}
                        onChange={(e) => updateDisplayName(idx, e.target.value)}
                      />
                      <button className="models-panel__delete-btn" type="button" onClick={() => deleteModel(idx)} aria-label="Delete model">
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
        {adding ? (
          <div className="models-panel__add-form">
            <input
              type="text"
              placeholder="Provider"
              value={addProvider}
              onChange={(e) => setAddProvider(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              placeholder="Model ID"
              value={addModelId}
              onChange={(e) => setAddModelId(e.target.value)}
            />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={addDisplayName}
              onChange={(e) => setAddDisplayName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") setAdding(false); }}
            />
            <div className="models-panel__add-form-actions">
              <button className="models-panel__add-confirm" type="button" onClick={confirmAdd}>Add</button>
              <button className="models-panel__add-cancel" type="button" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="settings-btn" type="button" onClick={() => setAdding(true)} style={{ marginTop: 8 }}>
            <Icon name="add" size={14} />
            Add Model
          </button>
        )}
      </SettingsSection>

      <SettingsSection title="Model Fallbacks" badge={String(Object.keys(fallbacks).length)}>
        {Object.entries(fallbacks).map(([role, models]) => (
          <div className="models-panel__fallback-role" key={role}>
            <button
              className="models-panel__fallback-header"
              type="button"
              onClick={() => setExpandedFallbacks((prev) => {
                const next = new Set(prev);
                if (next.has(role)) next.delete(role); else next.add(role);
                return next;
              })}
            >
              <Icon name={expandedFallbacks.has(role) ? "expand_less" : "expand_more"} size={16} />
              <span style={{ fontFamily: "var(--font-mono)", flex: 1 }}>{role}</span>
              <span className="models-panel__provider-badge">{models.length}</span>
            </button>
            {expandedFallbacks.has(role) && (
              <div className="models-panel__fallback-body">
                {models.map((m, i) => (
                  <div className="models-panel__fallback-item" key={i}>
                    <span className="models-panel__fallback-model">{m}</span>
                    <button className="models-panel__fallback-move" type="button" onClick={() => moveFallback(role, i, -1)} disabled={i === 0}>↑</button>
                    <button className="models-panel__fallback-move" type="button" onClick={() => moveFallback(role, i, 1)} disabled={i === models.length - 1}>↓</button>
                    <button className="models-panel__delete-btn" type="button" onClick={() => removeFallback(role, i)} aria-label="Remove fallback">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
                {addingFallback === role ? (
                  <div className="models-panel__fallback-add">
                    <select value={newFallback} onChange={(e) => setNewFallback(e.target.value)}>
                      <option value="">Select model…</option>
                      {allModelStrings.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button className="models-panel__add-confirm" type="button" onClick={() => confirmAddFallback(role)} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 2, cursor: "pointer", border: "1px solid #00BCD4" }}>Add</button>
                    <button className="models-panel__add-cancel" type="button" onClick={() => { setAddingFallback(null); setNewFallback(""); }} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 2, cursor: "pointer", border: "1px solid #E0E0E0", background: "#fff" }}>Cancel</button>
                  </div>
                ) : (
                  <button className="settings-btn" type="button" onClick={() => { setAddingFallback(role); setNewFallback(""); }} style={{ marginTop: 4 }}>
                    <Icon name="add" size={14} />
                    Add Fallback
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {Object.keys(fallbacks).length === 0 && (
          <p style={{ color: "#94a3b8", fontSize: 13 }}>No fallbacks configured.</p>
        )}
      </SettingsSection>
    </>
  );
}
