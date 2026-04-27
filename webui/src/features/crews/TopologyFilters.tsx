type TopologyFiltersProps = {
  role: string;
  onRoleChange: (val: string) => void;
  capability: string;
  onCapabilityChange: (val: string) => void;
  model: string;
  onModelChange: (val: string) => void;
  domain: string;
  onDomainChange: (val: string) => void;
  modelRefs: string[];
  domainProfiles: string[];
};

export function TopologyFilters({
  role,
  onRoleChange,
  capability,
  onCapabilityChange,
  model,
  onModelChange,
  domain,
  onDomainChange,
  modelRefs,
  domainProfiles,
}: TopologyFiltersProps) {
  return (
    <div className="crews-filters">
      <select className="crews-filter" value={role} onChange={(e) => onRoleChange(e.target.value)}>
        <option value="">All Roles</option>
        <option value="orchestrator">Orchestrator</option>
        <option value="lead">Lead</option>
        <option value="worker">Worker</option>
      </select>
      <input
        className="crews-filter"
        type="text"
        placeholder="Filter by capability..."
        value={capability}
        onChange={(e) => onCapabilityChange(e.target.value)}
      />
      <select className="crews-filter" value={model} onChange={(e) => onModelChange(e.target.value)}>
        <option value="">All Models</option>
        {modelRefs.map((ref) => (
          <option key={ref} value={ref}>{ref}</option>
        ))}
      </select>
      <select className="crews-filter" value={domain} onChange={(e) => onDomainChange(e.target.value)}>
        <option value="">All Domains</option>
        {domainProfiles.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>
  );
}
