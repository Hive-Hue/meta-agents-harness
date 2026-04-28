import { Outlet, useLocation } from "react-router";
import { HeaderBar } from "./HeaderBar";
import { Sidebar } from "./Sidebar";
import { Icon } from "../ui/Icon";
import { useWorkspace } from "../../contexts/WorkspaceContext";

const routeToNavItem: Record<string, string> = {
  "/": "Overview",
  "/bootstrap": "Bootstrap",
  "/sessions": "Sessions",
  "/config": "Config",
  "/run": "Run",
  "/crews": "Crews",
  "/settings": "Settings",
  "/expertise": "Expertise",
  "/skills": "Skills",
  "/context": "Context",
  "/sync": "Sync",
};

export function AppShell() {
  const location = useLocation();
  const activeItem = routeToNavItem[location.pathname] ?? "Overview";
  const { workspace, loading } = useWorkspace();
  const allowWithoutConfig = location.pathname === "/settings" || location.pathname === "/bootstrap";
  const showEmptyWorkspace = !loading && !allowWithoutConfig && workspace?.configExists === false;

  return (
    <div className="app-shell">
      <HeaderBar />
      <div className="app-shell__body">
        <Sidebar activeItem={activeItem} />
        {showEmptyWorkspace ? (
          <main className="overview-main">
            <div className="overview-proposals__empty" style={{ margin: 24, minHeight: 220 }}>
              <Icon name="folder_open" size={18} />
              Workspace sem `meta-agents.yaml`. Configure o caminho em Settings ou execute Bootstrap.
            </div>
          </main>
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}
