import { useState, useCallback, type KeyboardEvent } from "react";
import { Icon } from "../../components/ui/Icon";
import { useConfig } from "./useConfigStore";

type Rule = { path: string; read?: boolean; edit?: boolean; bash?: boolean };

export function DomainProfileEditor() {
  const { config, serverConfig, updateConfig } = useConfig();
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editPathValue, setEditPathValue] = useState("");

  const profiles = config?.domain_profiles ?? {};
  const serverProfiles = serverConfig?.domain_profiles ?? {};

  const commitUpdate = useCallback(
    (next: Record<string, Rule[]>) => {
      updateConfig({ domain_profiles: next });
    },
    [updateConfig],
  );

  const handleCheckbox = useCallback(
    (profileName: string, ruleIdx: number, key: "read" | "edit" | "bash", val: boolean) => {
      const rules = [...(profiles[profileName] ?? [])];
      rules[ruleIdx] = { ...rules[ruleIdx], [key]: val };
      commitUpdate({ ...profiles, [profileName]: rules });
    },
    [profiles, commitUpdate],
  );

  const handlePathEdit = useCallback(
    (profileName: string, ruleIdx: number, newPath: string) => {
      const rules = [...(profiles[profileName] ?? [])];
      rules[ruleIdx] = { ...rules[ruleIdx], path: newPath };
      commitUpdate({ ...profiles, [profileName]: rules });
      setEditingPath(null);
    },
    [profiles, commitUpdate],
  );

  const startEditPath = useCallback((profileName: string, ruleIdx: number) => {
    const key = `${profileName}:${ruleIdx}`;
    const rules = profiles[profileName];
    if (rules) {
      setEditPathValue(rules[ruleIdx]?.path ?? "");
    }
    setEditingPath(key);
  }, [profiles]);

  const cancelEditPath = useCallback(() => {
    setEditingPath(null);
    setEditPathValue("");
  }, []);

  const deleteRule = useCallback(
    (profileName: string, ruleIdx: number) => {
      const rules = (profiles[profileName] ?? []).filter((_, i) => i !== ruleIdx);
      commitUpdate({ ...profiles, [profileName]: rules });
    },
    [profiles, commitUpdate],
  );

  const addRule = useCallback(
    (profileName: string) => {
      const rules = [...(profiles[profileName] ?? []), { path: "", read: true, edit: false, bash: false }];
      commitUpdate({ ...profiles, [profileName]: rules });
    },
    [profiles, commitUpdate],
  );

  const deleteProfile = useCallback(
    (profileName: string) => {
      const next = { ...profiles };
      delete next[profileName];
      commitUpdate(next);
      if (expandedProfile === profileName) setExpandedProfile(null);
    },
    [profiles, commitUpdate, expandedProfile],
  );

  const confirmAddProfile = useCallback(() => {
    const name = newProfileName.trim();
    if (!name || profiles[name]) return;
    const next = { ...profiles, [name]: [{ path: "", read: true, edit: false, bash: false }] };
    commitUpdate(next);
    setAddingProfile(false);
    setNewProfileName("");
    setExpandedProfile(name);
  }, [newProfileName, profiles, commitUpdate]);

  const onPathKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, profileName: string, ruleIdx: number) => {
      if (e.key === "Enter") handlePathEdit(profileName, ruleIdx, editPathValue);
      if (e.key === "Escape") cancelEditPath();
    },
    [handlePathEdit, editPathValue, cancelEditPath],
  );

  if (!config) {
    return <div className="config-loading">Loading profiles…</div>;
  }

  return (
    <div className="domain-rules">
      {Object.entries(profiles).map(([name, rules]) => {
        const isDirty =
          JSON.stringify(rules) !== JSON.stringify(serverProfiles[name] ?? null);

        return (
          <div className="domain-profile" key={name}>
            <button
              className="domain-profile__header"
              type="button"
              onClick={() => setExpandedProfile(expandedProfile === name ? null : name)}
            >
              <Icon name={expandedProfile === name ? "expand_less" : "expand_more"} size={18} />
              <span className="domain-profile__name">{name}</span>
              {isDirty && <span className="domain-profile__dirty-dot" />}
              <span className="config-section__badge">{rules.length} rules</span>
              <button
                className="domain-profile__delete-btn"
                type="button"
                onClick={(e) => { e.stopPropagation(); deleteProfile(name); }}
                aria-label={`Delete profile ${name}`}
              >
                <Icon name="delete" size={14} />
              </button>
            </button>
            {expandedProfile === name && (
              <div className="domain-profile__rules">
                <table className="domain-rules-table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Read</th>
                      <th>Edit</th>
                      <th>Bash</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule, idx) => {
                      const editKey = `${name}:${idx}`;
                      return (
                        <tr key={idx}>
                          <td className="domain-rules-table__path">
                            {editingPath === editKey ? (
                              <input
                                className="domain-rules-table__path-input"
                                type="text"
                                value={editPathValue}
                                onChange={(e) => setEditPathValue(e.target.value)}
                                onBlur={() => handlePathEdit(name, idx, editPathValue)}
                                onKeyDown={(e) => onPathKeyDown(e, name, idx)}
                                autoFocus
                              />
                            ) : (
                              <span
                                style={{ cursor: "pointer" }}
                                onClick={() => startEditPath(name, idx)}
                              >
                                {rule.path || "—"}
                              </span>
                            )}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!rule.read}
                              onChange={(e) => handleCheckbox(name, idx, "read", e.target.checked)}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!rule.edit}
                              onChange={(e) => handleCheckbox(name, idx, "edit", e.target.checked)}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!rule.bash}
                              onChange={(e) => handleCheckbox(name, idx, "bash", e.target.checked)}
                            />
                          </td>
                          <td className="domain-rules-table__delete-cell">
                            <button
                              className="domain-rules-table__delete-btn"
                              type="button"
                              onClick={() => deleteRule(name, idx)}
                              aria-label="Delete rule"
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button className="config-table__add-btn" type="button" onClick={() => addRule(name)}>
                  <Icon name="add" size={16} />
                  Add Rule
                </button>
              </div>
            )}
          </div>
        );
      })}

      {addingProfile ? (
        <div className="domain-profile__add-form">
          <div className="domain-profile__add-form-row">
            <input
              type="text"
              placeholder="Profile name"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") confirmAddProfile(); if (e.key === "Escape") setAddingProfile(false); }}
            />
          </div>
          <div className="domain-profile__add-form-actions">
            <button className="domain-profile__add-confirm" type="button" onClick={confirmAddProfile}>
              Confirm
            </button>
            <button className="domain-profile__add-cancel" type="button" onClick={() => setAddingProfile(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="config-table__add-btn" type="button" onClick={() => setAddingProfile(true)}>
          <Icon name="add" size={16} />
          Add Profile
        </button>
      )}
    </div>
  );
}
