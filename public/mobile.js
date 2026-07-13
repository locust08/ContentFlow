import { authHeaders, loadAuthConfig, loadProfile, signIn, signOut } from "/auth.js";

const state = {
  projects: [],
  organization: { clients: [], campaigns: [], staff: [] },
  selectedStaffId: localStorage.getItem("contentflow.mobile.staffId") || "",
  activeProject: "",
  activeData: null,
  activeView: "projects",
  auth: { config: null, user: null, required: false }
};

const $ = (selector) => document.querySelector(selector);

function setStatus(text) {
  const node = $("#mobile-status");
  if (node) {
    node.textContent = text;
    node.hidden = text === "Ready";
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...authHeaders(),
      ...(options.body && !(options.body instanceof Blob) ? { "Content-Type": "application/json" } : {})
    },
    ...options
  });
  const data = await response.json();
  if (response.status === 401) showAuth("Login required.");
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showAuth(message = "") {
  $("#mobile-auth").hidden = false;
  if (message) $("#mobile-auth-message").textContent = message;
}

function hideAuth() {
  $("#mobile-auth").hidden = true;
}

async function initializeAuth() {
  state.auth.config = await loadAuthConfig().catch(() => ({ enabled: false, required: false }));
  const profile = await loadProfile().catch(() => ({ user: null, required: state.auth.config?.required }));
  state.auth.user = profile.user;
  state.auth.required = Boolean(profile.required || state.auth.config?.required);
  if (state.auth.required && !state.auth.user) showAuth("Login with your Supabase demo account.");
  else hideAuth();
  if (state.auth.user) state.selectedStaffId = state.auth.user.id;
  $("#mobile-identity-panel").hidden = Boolean(state.auth.user);
}

function typeLabel(type) {
  return type === "auto-clipper" ? "Auto Clipper" : "AI Generator";
}

function clientName(clientId) {
  return state.organization.clients.find((client) => client.id === clientId)?.name || "No client";
}

function campaignName(campaignId) {
  return state.organization.campaigns.find((campaign) => campaign.id === campaignId)?.name || "No campaign";
}

function assignedProjects() {
  return state.auth.user ? state.projects : state.projects.filter((project) => !state.selectedStaffId || project.assignedStaffId === state.selectedStaffId);
}

function showView(view) {
  state.activeView = view;
  const title = view.charAt(0).toUpperCase() + view.slice(1);
  $("#mobile-view-title").textContent = title;
  document.querySelectorAll("[data-mobile-view]").forEach((node) => {
    node.hidden = node.dataset.mobileView !== view;
  });
  document.querySelectorAll(".mobile-nav [data-view]").forEach((node) => {
    const active = node.dataset.view === view;
    node.toggleAttribute("aria-current", active);
  });
}

function renderStaffSelect() {
  const staff = state.organization.staff || [];
  if (!state.selectedStaffId && staff[0]) state.selectedStaffId = staff[0].id;
  $("#staff-select").innerHTML = staff.map((member) => `
    <option value="${member.id}" ${member.id === state.selectedStaffId ? "selected" : ""}>${member.name} - ${member.role || "staff"}</option>
  `).join("");
}

function renderProfile() {
  const user = state.auth.user;
  $("#mobile-profile-name").textContent = user?.email || "Demo staff member";
  $("#mobile-profile-role").textContent = user?.role || (user ? "Authorized project access" : "Choose a demo staff identity");
}

function renderProjectContexts() {
  const summary = state.activeData?.summary;
  const hasProject = Boolean(summary);
  $("#upload-project-name").textContent = summary?.name || "Select a project from Projects";
  $("#upload-project-meta").textContent = summary ? `${typeLabel(summary.type)} files attach to this project.` : "Files are attached to the active project.";
  $("#review-project-name").textContent = summary?.name || "Select a project from Projects";
  $("#review-project-meta").textContent = summary ? `Current status: ${summary.approvalStatus || "draft"}.` : "Set the status and leave clear feedback.";
  document.querySelectorAll("[data-project-required]").forEach((node) => {
    node.disabled = !hasProject;
  });
}

function renderMetrics() {
  const assigned = assignedProjects();
  $("#metric-assigned").textContent = String(assigned.length);
  $("#metric-review").textContent = String(assigned.filter((project) => project.approvalStatus === "in-review").length);
  $("#metric-renders").textContent = String(assigned.reduce((total, project) => total + Number(project.renderCount || 0), 0));
}

function renderProjects() {
  const projects = assignedProjects();
  $("#mobile-projects").innerHTML = projects.length
    ? projects.map((project) => `
        <article class="project-card ${project.name === state.activeProject ? "active" : ""}" data-project="${project.name}">
          <h3>${project.name}</h3>
          <p>${typeLabel(project.type)} · ${clientName(project.clientId)} · ${campaignName(project.campaignId)}</p>
          <p>${project.approvalStatus || "draft"} · ${project.renderCount || 0} renders</p>
        </article>
      `).join("")
    : `<p class="empty">No projects are assigned to this staff account yet.</p>`;
}

function mediaItems(data) {
  const renders = data?.renders || [];
  const reference = data?.referenceUrl ? [{ name: "Reference video", url: data.referenceUrl }] : [];
  const source = data?.clipper?.sourceUrl ? [{ name: "Clipper source", url: data.clipper.sourceUrl }] : [];
  return [...renders, ...reference, ...source];
}

function renderDetail() {
  const data = state.activeData;
  const summary = data?.summary;
  if (!summary) {
    $("#project-detail").hidden = true;
    renderProjectContexts();
    return;
  }

  $("#project-detail").hidden = false;
  $("#detail-title").textContent = summary.name;
  $("#detail-type").textContent = typeLabel(summary.type);
  $("#detail-status").textContent = summary.approvalStatus || "draft";
  $("#ai-upload-block").hidden = summary.type === "auto-clipper";
  $("#clipper-upload-block").hidden = summary.type !== "auto-clipper";
  $("#mobile-approval-status").value = summary.approvalStatus || "draft";
  $("#mobile-approval-feedback").value = summary.approvalFeedback || "";

  $("#detail-meta").innerHTML = [
    ["Client", clientName(summary.clientId)],
    ["Campaign", campaignName(summary.campaignId)],
    ["Priority", summary.priority || "normal"],
    ["Renders", String(summary.renderCount || 0)]
  ].map(([label, value]) => `<article class="meta-chip"><span>${label}</span><strong>${value}</strong></article>`).join("");

  const items = mediaItems(data);
  $("#mobile-media").innerHTML = items.length
    ? items.map((item) => `
        <article class="media-card">
          <video controls playsinline src="${item.url}"></video>
          <p>${item.name}</p>
        </article>
      `).join("")
    : `<p class="empty">Rendered media and source previews appear here after the project has assets.</p>`;
  renderProjectContexts();
}

async function load() {
  if (state.auth.required && !state.auth.user) return;
  setStatus("Loading mobile workspace");
  const [projects, organization] = await Promise.all([
    api("/api/projects"),
    api("/api/organization")
  ]);
  state.projects = projects.projects || [];
  state.organization = organization;
  renderStaffSelect();
  renderMetrics();
  renderProjects();
  if (state.activeProject) await openProject(state.activeProject, false);
  setStatus("Ready");
}

async function openProject(name, announce = true) {
  state.activeProject = name;
  if (announce) setStatus("Opening project");
  state.activeData = await api(`/api/projects/${encodeURIComponent(name)}`);
  renderProjects();
  renderDetail();
  showView("projects");
  if (announce) setStatus("Project ready");
}

async function uploadFile(inputSelector, endpoint) {
  if (!state.activeProject) throw new Error("Open a project first.");
  const input = $(inputSelector);
  const files = Array.from(input?.files || []);
  if (!files.length) throw new Error("Choose a file first.");
  setStatus("Uploading");
  for (const file of files) {
    const response = await fetch(`/api/projects/${encodeURIComponent(state.activeProject)}/${endpoint}`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/octet-stream",
        "X-File-Name": file.name
      },
      body: file
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload failed");
  }
  input.value = "";
  await load();
  setStatus(files.length > 1 ? `${files.length} files uploaded` : "File uploaded");
}

async function saveReview() {
  if (!state.activeProject) throw new Error("Open a project first.");
  setStatus("Saving review status");
  const approvalStatus = $("#mobile-approval-status").value;
  const now = new Date().toISOString();
  const body = {
    approvalStatus,
    approvalFeedback: $("#mobile-approval-feedback").value.trim(),
    reviewSubmittedAt: approvalStatus === "in-review" ? now : state.activeData?.summary?.reviewSubmittedAt,
    reviewedAt: ["approved", "changes-requested"].includes(approvalStatus) ? now : state.activeData?.summary?.reviewedAt
  };
  await api(`/api/projects/${encodeURIComponent(state.activeProject)}/meta`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  await load();
  setStatus("Review status saved");
}

function bind(selector, event, handler) {
  const node = $(selector);
  if (!node) return;
  node.addEventListener(event, async (actionEvent) => {
    try {
      await handler(actionEvent);
    } catch (error) {
      setStatus(error.message);
    }
  });
}

bind("#staff-select", "change", async (event) => {
  state.selectedStaffId = event.target.value;
  localStorage.setItem("contentflow.mobile.staffId", state.selectedStaffId);
  state.activeProject = "";
  state.activeData = null;
  renderMetrics();
  renderProjects();
  renderDetail();
});

bind("#mobile-projects", "click", async (event) => {
  const card = event.target.closest("[data-project]");
  if (card) await openProject(card.dataset.project);
});

document.querySelectorAll(".mobile-nav [data-view]").forEach((node) => {
  node.addEventListener("click", () => showView(node.dataset.view));
});

bind("#refresh-mobile", "click", load);
bind("#mobile-auth-form", "submit", async (event) => {
  event.preventDefault();
  $("#mobile-auth-message").textContent = "Logging in...";
  await signIn($("#mobile-auth-email").value.trim(), $("#mobile-auth-password").value);
  await initializeAuth();
  await load();
});
bind("#mobile-logout", "click", async () => {
  signOut();
  state.auth.user = null;
  state.activeProject = "";
  state.activeData = null;
  await initializeAuth();
  renderDetail();
  renderProfile();
  if (!state.auth.required) await load();
});
bind("#mobile-upload-reference", "click", () => uploadFile("#mobile-reference-file", "reference"));
bind("#mobile-upload-product", "click", () => uploadFile("#mobile-product-file", "product"));
bind("#mobile-upload-character", "click", () => uploadFile("#mobile-character-file", "character"));
bind("#mobile-upload-reaction", "click", () => uploadFile("#mobile-reaction-file", "clipper/reaction"));
bind("#mobile-save-review", "click", saveReview);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

await initializeAuth();
renderProfile();
renderProjectContexts();
load().catch((error) => setStatus(error.message));
