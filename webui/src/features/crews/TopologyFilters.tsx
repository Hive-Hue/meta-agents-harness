type TopologyFiltersProps = {
  role: string;
  onRoleChange: (val: string) => void;
  capability: string;
  onCapabilityChange: (val: string) => void;
  model: string;
  onModelChange: (val: string) => void;
  domain: string;
  onDomainChange: (val: string) => void;
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
        <option value="orchestrator_default">orchestrator_default</option>
        <option value="lead_default">lead_default</option>
        <option value="worker_default">worker_default</option>
        <option value="qa_default">qa_default</option>
      </select>
      <select className="crews-filter" value={domain} onChange={(e) => onDomainChange(e.target.value)}>
        <option value="">All Domains</option>
        <option value="read_only_repo">read_only_repo</option>
        <option value="planning_delivery">planning_delivery</option>
        <option value="cli_operator_surface">cli_operator_surface</option>
        <option value="runtime_impl">runtime_impl</option>
        <option value="validation_runtime">validation_runtime</option>
      </select>
    </div>
  );
}
