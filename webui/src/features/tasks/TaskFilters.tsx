import { useState, useCallback } from "react";
import { Icon } from "../../components/ui/Icon";

export interface TaskFiltersValue {
  states: string[];
  mission: string;
  owner: string;
  search: string;
}

interface TaskFiltersProps {
  filters: TaskFiltersValue;
  onChange: (filters: TaskFiltersValue) => void;
  missions: string[];
  owners: string[];
}

const ALL_STATES = ["backlog", "ready", "in_progress", "done", "blocked", "review"] as const;

const STATE_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  done: "Done",
  blocked: "Blocked",
  review: "Review",
};

export function TaskFilters({ filters, onChange, missions, owners }: TaskFiltersProps) {
  const [searchValue, setSearchValue] = useState(filters.search);

  const toggleState = useCallback((state: string) => {
    const states = filters.states.includes(state)
      ? filters.states.filter(s => s !== state)
      : [...filters.states, state];
    onChange({ ...filters, states });
  }, [filters, onChange]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
    // Debounce: update parent after 300ms
    setTimeout(() => {
      onChange({ ...filters, search: value });
    }, 300);
  }, [filters, onChange]);

  const clearSearch = () => {
    setSearchValue("");
    onChange({ ...filters, search: "" });
  };

  const activeChips: Array<{ label: string; onRemove: () => void }> = [];

  if (filters.mission) {
    activeChips.push({
      label: filters.mission,
      onRemove: () => onChange({ ...filters, mission: "" }),
    });
  }
  if (filters.owner) {
    activeChips.push({
      label: filters.owner,
      onRemove: () => onChange({ ...filters, owner: "" }),
    });
  }

  return (
    <div className="task-filters">
      {/* State checkboxes */}
      <div className="task-filters__states">
        {ALL_STATES.map(state => (
          <label key={state} className="task-filters__state-check">
            <input
              type="checkbox"
              checked={filters.states.includes(state)}
              onChange={() => toggleState(state)}
            />
            <span className={`task-filters__state-dot task-filters__state-dot--${state}`} />
            {STATE_LABELS[state]}
          </label>
        ))}
      </div>

      {/* Mission dropdown */}
      <div className="task-filters__select-wrap">
        <select
          value={filters.mission}
          onChange={e => onChange({ ...filters, mission: e.target.value })}
          className="task-filters__select"
        >
          <option value="">All Missions</option>
          {missions.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <Icon name="arrow_drop_down" size={14} className="task-filters__select-icon" />
      </div>

      {/* Owner dropdown */}
      <div className="task-filters__select-wrap">
        <select
          value={filters.owner}
          onChange={e => onChange({ ...filters, owner: e.target.value })}
          className="task-filters__select"
        >
          <option value="">All Owners</option>
          {owners.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <Icon name="arrow_drop_down" size={14} className="task-filters__select-icon" />
      </div>

      {/* Search */}
      <div className="task-filters__search">
        <Icon name="search" size={14} className="task-filters__search-icon" />
        <input
          type="text"
          value={searchValue}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="task-filters__search-input"
        />
        {searchValue && (
          <button type="button" onClick={clearSearch} className="task-filters__search-clear" aria-label="Clear search">
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="task-filters__chips">
          {activeChips.map((chip, i) => (
            <span key={i} className="task-filters__chip">
              {chip.label}
              <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label} filter`}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}