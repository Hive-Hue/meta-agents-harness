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
import { AuthProvider, useAuth } from "./features/auth/useAuth";
import { LoginPage } from "./features/auth/LoginPage";
import { TasksPage } from "./features/tasks/TasksPage";

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

function AppRouter() {
  const { loading, authenticated } = useAuth();
  if (loading) {
    return (
      <main style={{ display: "grid", minHeight: "100vh", placeItems: "center", color: "#475569", fontSize: 14 }}>
        Carregando autenticação...
      </main>
    );
  }
  if (!authenticated) {
    return <LoginPage />;
  }

  return (
    <WorkspaceProvider>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewDashboard />} />
        <Route path="sessions" element={<SessionsOverview />} />
        <Route path="bootstrap" element={<BootstrapWizard />} />
        <Route path="config" element={<ConfigEditor />} />
        <Route path="run" element={<RunConsole />} />
        <Route path="tasks" element={<TasksPage />} />
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
