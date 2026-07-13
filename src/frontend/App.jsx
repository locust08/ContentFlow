import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "./layout/AppShell.jsx";
import { useContentFlow } from "./state/useContentFlow.js";
import { LoginPage } from "./pages/LoginPage.jsx";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { StudioPage } from "./pages/StudioPage.jsx";
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
import { CreateProjectModal } from "./components/CreateProjectModal.jsx";
import { canAccessPath, getLandingPath, getProjectPath } from "./routing/routes.js";

function LoadingScreen() {
  return <main className="loading-screen"><div className="loading-card"><img className="brand-symbol" src="/assets/brand/contentflow-bee.png" alt="" /><div><strong>Loading ContentFlow AI</strong><small>Preparing your workspace</small></div></div></main>;
}

function Protected({ app, children }) {
  const location = useLocation();
  return canAccessPath(app.role, location.pathname) ? children : <Navigate to={getLandingPath(app.role)} replace />;
}

export function ProjectWorkspaceRoute({ app, type }) {
  const { project = "" } = useParams();
  const name = project;
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadError("");
    if (name && app.activeProject !== name) {
      app.selectProject(name).catch((error) => {
        if (active) setLoadError(error.message || "Project could not be loaded");
      });
    }
    return () => { active = false; };
  }, [app.activeProject, app.selectProject, name]);

  if (loadError) return <section className="workspace-loading workspace-load-error"><strong>{loadError}</strong><p>This project may have been removed or is not available to your account.</p><Link className="btn btn--secondary" to="/projects">Back to projects</Link></section>;
  if (!app.activeProjectData || app.activeProject !== name) {
    return <section className="workspace-loading"><span className="spinner" /><strong>Loading {name}</strong></section>;
  }
  const actualType = app.activeProjectData.summary?.type === "auto-clipper" ? "auto-clipper" : "ai-generator";
  if (actualType !== type) return <Navigate to={getProjectPath({ name, type: actualType })} replace />;
  return type === "auto-clipper" ? <AutoClipperPage app={app} /> : <AiGeneratorPage app={app} />;
}

function AppRoutes({ app }) {
  const protectedPage = (page) => <Protected app={app}>{page}</Protected>;
  return (
    <Routes>
      <Route path="/" element={<Navigate to={getLandingPath(app.role)} replace />} />
      <Route path="/dashboard" element={protectedPage(<DashboardPage app={app} />)} />
      <Route path="/studio" element={protectedPage(<StudioPage app={app} />)} />
      <Route path="/projects" element={protectedPage(<ProjectsPage app={app} />)} />
      <Route path="/projects/:project/ai-generator" element={protectedPage(<ProjectWorkspaceRoute app={app} type="ai-generator" />)} />
      <Route path="/projects/:project/auto-clipper" element={protectedPage(<ProjectWorkspaceRoute app={app} type="auto-clipper" />)} />
      <Route path="/media" element={protectedPage(<MediaPage app={app} />)} />
      <Route path="/approvals" element={protectedPage(<ApprovalsPage app={app} />)} />
      <Route path="/analytics" element={protectedPage(<AnalyticsPage app={app} />)} />
      <Route path="/manage/clients" element={protectedPage(<ClientsPage app={app} />)} />
      <Route path="/manage/campaigns" element={protectedPage(<CampaignsPage app={app} />)} />
      <Route path="/manage/team" element={protectedPage(<TeamPage app={app} />)} />
      <Route path="/manage/jobs" element={protectedPage(<JobsPage app={app} />)} />
      <Route path="/manage/settings" element={protectedPage(<SettingsPage app={app} />)} />
      <Route path="*" element={<Navigate to={getLandingPath(app.role)} replace />} />
    </Routes>
  );
}

export default function App() {
  const coreApp = useContentFlow();
  const navigate = useNavigate();
  const [createDialog, setCreateDialog] = useState({ open: false, type: "ai-generator" });

  const app = useMemo(() => ({
    ...coreApp,
    openCreateProject: (type = "ai-generator") => setCreateDialog({ open: true, type }),
    closeCreateProject: () => setCreateDialog((current) => ({ ...current, open: false }))
  }), [coreApp]);

  async function createProject(payload) {
    const project = await app.createProject(payload);
    navigate(getProjectPath(project));
    return project;
  }

  if (app.loading) return <LoadingScreen />;
  if (app.auth.required && !app.auth.user) return <LoginPage app={app} />;

  return (
    <AppShell app={app}>
      {app.error && <div className="app-alert">{app.error}</div>}
      <AppRoutes app={app} />
      <CreateProjectModal open={createDialog.open} initialType={createDialog.type} app={app} onClose={app.closeCreateProject} onCreate={createProject} />
    </AppShell>
  );
}
