import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, loadAuthConfig, loadProfile, signIn, signOut } from "../api/client.js";

const emptyOrganization = { clients: [], campaigns: [], staff: [] };

export function useContentFlow() {
  const intelligenceRequest = useRef(0);
  const [state, setState] = useState({
    loading: true,
    error: "",
    status: "Ready",
    activeView: "dashboard",
    activeProject: "",
    activeProjectData: null,
    projects: [],
    folders: [],
    organization: emptyOrganization,
    mediaItems: [],
    productionJobs: [],
    supabase: {},
    analytics: null,
    activityItems: [],
    intelligence: { campaigns: [], active: null },
    auth: { config: null, user: null, required: false }
  });

  const role = state.auth.user?.role || (state.auth.required ? "anonymous" : "admin");
  const isAdmin = role === "admin";
  const isClient = role === "manager-client";
  const isStaff = role === "staff-editor";

  const setStatus = useCallback((status) => {
    setState((current) => ({ ...current, status }));
  }, []);

  const loadCore = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const [config, profile] = await Promise.all([
        loadAuthConfig(),
        loadProfile()
      ]);

      if (profile.required && !profile.user) {
        setState((current) => ({
          ...current,
          loading: false,
          auth: { config, user: null, required: true },
          activeView: "login",
          status: "Login required"
        }));
        return;
      }

      const [projectData, organization, media, supabase, analytics, activity] = await Promise.all([
        api("/api/projects"),
        api("/api/organization"),
        api("/api/media-library"),
        api("/api/supabase/status").catch(() => ({})),
        api("/api/supabase/analytics").catch(() => ({ analytics: null })),
        api("/api/activity?limit=20").catch(() => ({ items: [] }))
      ]);

      setState((current) => ({
        ...current,
        loading: false,
        auth: { config, user: profile.user, required: profile.required },
        projects: projectData.projects || [],
        folders: projectData.folders || [],
        organization: organization || emptyOrganization,
        mediaItems: media.items || [],
        supabase,
        analytics: analytics.analytics || null,
        activityItems: activity.items || [],
        activeView: current.activeView === "login" ? "dashboard" : current.activeView,
        status: "Ready"
      }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message, status: error.message }));
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  const login = useCallback(async (email, password) => {
    setStatus("Signing in");
    await signIn(email, password);
    await loadCore();
  }, [loadCore, setStatus]);

  const logout = useCallback(async () => {
    signOut();
    setState((current) => ({
      ...current,
      activeView: current.auth.required ? "login" : "dashboard",
      activeProject: "",
      activeProjectData: null,
      auth: { ...current.auth, user: null },
      status: current.auth.required ? "Login required" : "Logged out"
    }));
  }, []);

  const showView = useCallback((view) => {
    const clientBlocked = ["projects", "clients", "campaigns", "team", "jobs", "settings", "ai", "clipper"];
    setState((current) => ({
      ...current,
      activeView: isClient && clientBlocked.includes(view) ? "media" : view
    }));
  }, [isClient]);

  const selectProject = useCallback(async (name) => {
    setStatus("Loading project");
    const data = await api(`/api/projects/${encodeURIComponent(name)}`);
    const view = data.summary?.type === "auto-clipper" ? "clipper" : "ai";
    const jobs = await api(`/api/projects/${encodeURIComponent(name)}/jobs`).catch(() => ({ jobs: [] }));
    setState((current) => ({
      ...current,
      activeProject: name,
      activeProjectData: data,
      productionJobs: jobs.jobs || [],
      activeView: isClient ? "media" : view,
      status: "Project loaded"
    }));
  }, [isClient, setStatus]);

  const createProject = useCallback(async (payload) => {
    setStatus("Creating project");
    const result = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadCore();
    await selectProject(result.project.name);
    return result.project;
  }, [loadCore, selectProject, setStatus]);

  const createClient = useCallback(async (payload) => {
    setStatus("Creating client");
    await api("/api/clients", { method: "POST", body: JSON.stringify(payload) });
    await loadCore();
    setStatus("Client created");
  }, [loadCore, setStatus]);

  const createCampaign = useCallback(async (payload) => {
    setStatus("Creating campaign");
    await api("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
    await loadCore();
    setStatus("Campaign created");
  }, [loadCore, setStatus]);

  const createFolder = useCallback(async (name) => {
    setStatus("Creating folder");
    await api("/api/folders", { method: "POST", body: JSON.stringify({ name }) });
    await loadCore();
    setStatus("Folder created");
  }, [loadCore, setStatus]);

  const renameFolder = useCallback(async (folderId, name) => {
    setStatus("Renaming folder");
    await api(`/api/folders/${encodeURIComponent(folderId)}`, { method: "PUT", body: JSON.stringify({ name }) });
    await loadCore();
    setStatus("Folder renamed");
  }, [loadCore, setStatus]);

  const deleteFolder = useCallback(async (folderId) => {
    setStatus("Deleting folder");
    await api(`/api/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
    await loadCore();
    setStatus("Folder deleted");
  }, [loadCore, setStatus]);

  const deleteProject = useCallback(async (project) => {
    setStatus("Deleting project");
    await api(`/api/projects/${encodeURIComponent(project)}`, { method: "DELETE" });
    setState((current) => ({ ...current, activeProject: current.activeProject === project ? "" : current.activeProject, activeProjectData: current.activeProject === project ? null : current.activeProjectData }));
    await loadCore();
    setStatus("Project deleted");
  }, [loadCore, setStatus]);

  const initializeSupabase = useCallback(async () => {
    setStatus("Initializing Supabase");
    await api("/api/supabase/init", { method: "POST" });
    await loadCore();
    setStatus("Supabase initialized");
  }, [loadCore, setStatus]);

  const syncSupabase = useCallback(async () => {
    setStatus("Synchronizing local records");
    await api("/api/supabase/sync-local", { method: "POST" });
    await loadCore();
    setStatus("Supabase synchronized");
  }, [loadCore, setStatus]);

  const updateProjectMeta = useCallback(async (project, payload) => {
    setStatus("Updating project");
    await api(`/api/projects/${encodeURIComponent(project)}/meta`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    await loadCore();
    if (state.activeProject === project) await selectProject(project);
    setStatus("Project updated");
  }, [loadCore, selectProject, setStatus, state.activeProject]);

  const runProjectAction = useCallback(async (path, options = {}) => {
    if (!state.activeProject) throw new Error("Select a project first.");
    setStatus(options.status || "Working");
    const result = await api(`/api/projects/${encodeURIComponent(state.activeProject)}${path}`, {
      method: options.method || "POST",
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: options.headers
    });
    if (result.data) {
      setState((current) => ({
        ...current,
        activeProjectData: result.data,
        status: result.queued ? "Production job queued" : options.done || "Ready"
      }));
    }
    await loadCore();
    if (state.activeProject) await selectProject(state.activeProject);
    return result;
  }, [loadCore, selectProject, state.activeProject, setStatus]);

  const uploadProjectFile = useCallback(async (path, file, status) => {
    if (!state.activeProject) throw new Error("Select a project first.");
    setStatus(status || "Uploading");
    await api(`/api/projects/${encodeURIComponent(state.activeProject)}${path}`, {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: { "Content-Type": file.type || "application/octet-stream", "x-file-name": file.name }
    });
    await loadCore();
    await selectProject(state.activeProject);
    setStatus("Upload complete");
  }, [loadCore, selectProject, setStatus, state.activeProject]);

  const loadIntelligence = useCallback(async () => {
    setStatus("Loading market intelligence");
    const result = await api("/api/intelligence");
    const payload = result.data || result.intelligence || result;
    setState((current) => ({
      ...current,
      intelligence: { ...current.intelligence, campaigns: payload.campaigns || payload.items || [] },
      status: "Intelligence ready"
    }));
    return payload;
  }, [setStatus]);

  const loadCampaignIntelligence = useCallback(async (campaignId) => {
    const requestId = intelligenceRequest.current + 1;
    intelligenceRequest.current = requestId;
    setStatus("Loading campaign research");
    setState((current) => ({
      ...current,
      intelligence: { ...current.intelligence, active: null, activeCampaignId: campaignId }
    }));
    const result = await api(`/api/campaigns/${encodeURIComponent(campaignId)}/intelligence`);
    const payload = result.data || result.intelligence || result;
    setState((current) => ({
      ...current,
      ...(requestId === intelligenceRequest.current ? {
        intelligence: { ...current.intelligence, active: payload, activeCampaignId: campaignId },
        status: "Campaign intelligence ready"
      } : {})
    }));
    return payload;
  }, [setStatus]);

  const updateCampaignBrief = useCallback(async (campaignId, brief) => {
    setStatus("Saving campaign brief");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/brief`, { method: "PUT", body: JSON.stringify(brief) });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Campaign brief saved");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const addResearchText = useCallback(async (campaignId, source) => {
    setStatus("Adding research source");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/research-sources/text`, { method: "POST", body: JSON.stringify(source) });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Research source added");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const uploadResearchSource = useCallback(async (campaignId, file) => {
    setStatus("Uploading research source");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/research-sources/file`, {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: { "Content-Type": file.type || "application/octet-stream", "x-file-name": file.name }
    });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Research source uploaded");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const deleteResearchSource = useCallback(async (campaignId, sourceId) => {
    setStatus("Removing research source");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/research-sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Research source removed");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const generateMarketReport = useCallback(async (campaignId, sourceIds) => {
    setStatus("Generating market report");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/market-reports/generate`, { method: "POST", body: JSON.stringify({ sourceIds }) });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Market report generated");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const updateMarketReport = useCallback(async (campaignId, reportId, report) => {
    setStatus("Saving market report");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/market-reports/${encodeURIComponent(reportId)}`, { method: "PUT", body: JSON.stringify(report) });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Market report saved");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const approveMarketReport = useCallback(async (campaignId, reportId) => {
    setStatus("Approving market report");
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/market-reports/${encodeURIComponent(reportId)}/approve`, { method: "POST" });
    const payload = await loadCampaignIntelligence(campaignId);
    setStatus("Market report approved");
    return payload;
  }, [loadCampaignIntelligence, setStatus]);

  const analyzeUgcScript = useCallback((mode, manualTranscript) => runProjectAction("/ugc-script/analyze", {
    body: { mode, ...(manualTranscript ? { manualTranscript } : {}) },
    status: "Analyzing script inspiration",
    done: "Script analysis ready"
  }), [runProjectAction]);

  const generateUgcScript = useCallback((marketReportId, overrideReason = "") => runProjectAction("/ugc-script/generate", {
    body: { ...(marketReportId ? { marketReportId } : {}), ...(overrideReason ? { overrideReason } : {}) },
    status: "Generating UGC script",
    done: "UGC script ready"
  }), [runProjectAction]);

  const updateUgcScript = useCallback((script) => runProjectAction("/ugc-script", {
    method: "PUT",
    body: script,
    status: "Saving script version",
    done: "Script version saved"
  }), [runProjectAction]);

  const reviewUgcScript = useCallback((status, feedback) => runProjectAction("/ugc-script/review", {
    body: { status, ...(feedback ? { feedback } : {}) },
    status: "Recording script review",
    done: status === "approved" ? "Script approved" : "Script changes requested"
  }), [runProjectAction]);

  const reviewProjectScript = useCallback(async (projectName, status, feedback) => {
    setStatus("Recording script review");
    const result = await api(`/api/projects/${encodeURIComponent(projectName)}/ugc-script/review`, {
      method: "POST",
      body: JSON.stringify({ status, ...(feedback ? { feedback } : {}) })
    });
    await loadCore();
    setStatus(status === "approved" ? "Script approved" : "Script review updated");
    return result;
  }, [loadCore, setStatus]);

  const derived = useMemo(() => ({
    role,
    isAdmin,
    isStaff,
    isClient,
    aiProjects: state.projects.filter((project) => project.type !== "auto-clipper"),
    clipperProjects: state.projects.filter((project) => project.type === "auto-clipper"),
    reviewItems: state.projects.filter((project) => ["in-review", "changes-requested", "approved"].includes(project.approvalStatus) || ["internal-review", "client-review", "changes-requested", "approved"].includes(project.scriptStatus)),
    activeProjectSummary: state.projects.find((project) => project.name === state.activeProject)
  }), [isAdmin, isClient, isStaff, role, state.activeProject, state.projects]);

  return {
    ...state,
    ...derived,
    setStatus,
    showView,
    selectProject,
    createProject,
    createClient,
    createCampaign,
    createFolder,
    renameFolder,
    deleteFolder,
    deleteProject,
    initializeSupabase,
    syncSupabase,
    updateProjectMeta,
    runProjectAction,
    uploadProjectFile,
    loadIntelligence,
    loadCampaignIntelligence,
    updateCampaignBrief,
    addResearchText,
    uploadResearchSource,
    deleteResearchSource,
    generateMarketReport,
    updateMarketReport,
    approveMarketReport,
    analyzeUgcScript,
    generateUgcScript,
    updateUgcScript,
    reviewUgcScript,
    reviewProjectScript,
    refresh: loadCore,
    login,
    logout
  };
}
