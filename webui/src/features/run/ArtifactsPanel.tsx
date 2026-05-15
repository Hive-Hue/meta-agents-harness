type ContextDoc = { name: string; size: string; relevance: number };
type Artifact = { path: string; action: "created" | "modified"; size: string };

type ArtifactsPanelProps = {
  contextDocs: ContextDoc[];
  artifacts: Artifact[];
};

export function ArtifactsPanel({ contextDocs, artifacts }: ArtifactsPanelProps) {
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
            {contextDocs.length === 0 && (
              <tr>
                <td className="artifact-table__path" colSpan={3}>No context docs captured for this run.</td>
              </tr>
            )}
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
            {artifacts.length === 0 && (
              <tr>
                <td className="artifact-table__path" colSpan={3}>No runtime artifacts detected yet.</td>
              </tr>
            )}
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
