const contextDocs = [
  { name: "operational/delegation-patterns.md", size: "1.2KB", relevance: 0.92 },
  { name: "operational/runtime-contracts.md", size: "0.8KB", relevance: 0.87 },
  { name: "operational/domain-guardrails.md", size: "0.4KB", relevance: 0.81 },
];

const artifacts = [
  { path: "webui/src/features/run/RunConsole.tsx", action: "created" as const, size: "3.2KB" },
  { path: "webui/src/features/run/run.css", action: "created" as const, size: "1.8KB" },
  { path: "webui/src/App.tsx", action: "modified" as const, size: "+4 lines" },
];

export function ArtifactsPanel() {
  return (
    <div className="artifacts-panel">
      <div className="artifacts-section">
        <h4>Context Loaded</h4>
        <table className="artifact-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Size</th>
              <th>Relevance</th>
            </tr>
          </thead>
          <tbody>
            {contextDocs.map((doc) => (
              <tr key={doc.name}>
                <td className="artifact-table__path">{doc.name}</td>
                <td>{doc.size}</td>
                <td>{doc.relevance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="artifacts-section">
        <h4>Artifacts</h4>
        <table className="artifact-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Action</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((a) => (
              <tr key={a.path}>
                <td className="artifact-table__path">{a.path}</td>
                <td className={"artifact-table__action artifact-table__action--" + a.action}>{a.action}</td>
                <td>{a.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
