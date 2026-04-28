import { Routes, Route } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { OverviewDashboard } from "./features/overview/OverviewDashboard";
import { SessionsOverview } from "./features/sessions/SessionsOverview";
import { BootstrapWizard } from "./features/bootstrap/BootstrapWizard";
import { ConfigEditor } from "./features/config/ConfigEditor";
import { RunConsole } from "./features/run/RunConsole";
import { CrewsTopology } from "./features/crews/CrewsTopology";
import { SettingsPage } from "./features/settings/SettingsPage";
import { ExpertiseGovernance } from "./features/expertise/ExpertiseGovernance";
import { ContextManager } from "./features/context/ContextManager";
import { SkillsManagement } from "./features/skills/SkillsManagement";

export function App() {
  return (
    <WorkspaceProvider>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewDashboard />} />
        <Route path="sessions" element={<SessionsOverview />} />
        <Route path="bootstrap" element={<BootstrapWizard />} />
        <Route path="config" element={<ConfigEditor />} />
        <Route path="run" element={<RunConsole />} />
        <Route path="crews" element={<CrewsTopology />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="expertise" element={<ExpertiseGovernance />} />
        <Route path="context" element={<ContextManager />} />
        <Route path="skills" element={<SkillsManagement />} />
      </Route>
    </Routes>
    </WorkspaceProvider>
  );
}
