import { Outlet, useLocation } from "react-router";
import { HeaderBar } from "./HeaderBar";
import { Sidebar } from "./Sidebar";

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

  return (
    <div className="app-shell">
      <HeaderBar />
      <div className="app-shell__body">
        <Sidebar activeItem={activeItem} />
        <Outlet />
      </div>
    </div>
  );
}
