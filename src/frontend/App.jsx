import { AppShell } from "./layout/AppShell.jsx";
import { useContentFlow } from "./state/useContentFlow.js";
import { LoginPage } from "./pages/LoginPage.jsx";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import {
  AnalyticsPage,
  ApprovalsPage,
  CampaignsPage,
  ClientsPage,
  JobsPage,
  MediaPage,
  ProjectsPage,
  SettingsPage,
  TeamPage
} from "./pages/ManagementPages.jsx";
import { AiGeneratorPage, AutoClipperPage } from "./pages/ProjectWorkspaces.jsx";

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="loading-card">
        <span className="brand-mark">CF</span>
        <strong>Loading ContentFlow AI</strong>
      </div>
    </main>
  );
}

function ActivePage({ app }) {
  switch (app.activeView) {
    case "projects":
      return <ProjectsPage app={app} />;
    case "clients":
      return <ClientsPage app={app} />;
    case "campaigns":
      return <CampaignsPage app={app} />;
    case "team":
      return <TeamPage app={app} />;
    case "media":
      return <MediaPage app={app} />;
    case "approvals":
      return <ApprovalsPage app={app} />;
    case "analytics":
      return <AnalyticsPage app={app} />;
    case "jobs":
      return <JobsPage app={app} />;
    case "settings":
      return <SettingsPage app={app} />;
    case "ai":
      return <AiGeneratorPage app={app} />;
    case "clipper":
      return <AutoClipperPage app={app} />;
    case "dashboard":
    default:
      return <DashboardPage app={app} />;
  }
}

export default function App() {
  const app = useContentFlow();

  if (app.loading) return <LoadingScreen />;
  if (app.activeView === "login") return <LoginPage app={app} />;

  return (
    <AppShell app={app}>
      {app.error && <div className="app-alert">{app.error}</div>}
      <ActivePage app={app} />
    </AppShell>
  );
}
