import { authHeaders, loadAuthConfig, loadProfile, signIn, signOut } from "/auth.js";

const state = {
  projects: [],
  folders: [],
  organization: { clients: [], campaigns: [], staff: [] },
  mediaItems: [],
  productionJobs: [],
  supabase: { configured: false, connected: false, schemaReady: false },
  supabaseAnalytics: null,
  auth: { config: null, user: null, required: false },
  activeFolder: "",
  activeView: "dashboard",
  selectedProjectType: "ai-generator",
  selectedHighlights: new Set(),
  selectedReactionIds: new Set(),
  reactionSelectionTouched: false,
  activeProject: null,
  data: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const MB = 1024 * 1024;
const UPLOAD_LIMITS = {
  reference: { bytes: 200 * MB, label: "Reference video" },
  product: { bytes: 25 * MB, label: "Product image" },
  character: { bytes: 25 * MB, label: "Character reference" },
  "clipper/reaction": { bytes: 100 * MB, label: "Reaction character" }
};

const setHTML = (selector, html) => {
  const target = $(selector);
  if (target) target.innerHTML = html;
};
const setText = (selector, text) => {
  const target = $(selector);
  if (target) target.textContent = text;
};
const on = (selector, event, handler) => {
  const target = $(selector);
  if (target) target.addEventListener(event, handler);
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown size";
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
}

function isLimitError(text) {
  return /413|maximum content size|content size limit|too large|file size|over.*limit|exceed/i.test(String(text || ""));
}

function friendlyLimitMessage(text) {
  if (/transcription|timestamp/i.test(String(text || ""))) {
    return "The video audio is too large for transcription. Use a shorter source clip, or compress/trim the video before analyzing highlights.";
  }
  return "The attached file is too large for this workflow. Please use a shorter, smaller, or compressed file and try again.";
}

function showLimitModal(message) {
  const modal = $("#limit-modal");
  if (!modal) {
    window.alert(message);
    return;
  }
  setText("#limit-modal-message", message);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeLimitModal() {
  const modal = $("#limit-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function setStatus(text) {
  setText("#status", text);
  if (isLimitError(text)) showLimitModal(friendlyLimitMessage(text));
}

async function withBusyButton(selector, busyText, task) {
  const button = $(selector);
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = busyText;
    button.classList.add("is-busy");
  }

  try {
    return await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
      button.classList.remove("is-busy");
    }
  }
}

function scrollToSection(selector) {
  const target = $(selector);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (response.status === 401) showAuthGate("Login required.");
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function isAdminUser() {
  return !state.auth.required || state.auth.user?.role === "admin";
}

function isClientUser() {
  return state.auth.user?.role === "manager-client";
}

function showAuthGate(message = "") {
  const gate = $("#auth-gate");
  if (gate) gate.hidden = false;
  if (message) setText("#auth-message", message);
}

function hideAuthGate() {
  const gate = $("#auth-gate");
  if (gate) gate.hidden = true;
}

async function initializeAuth() {
  state.auth.config = await loadAuthConfig().catch(() => ({ enabled: false, required: false }));
  const profile = await loadProfile().catch(() => ({ user: null, required: state.auth.config?.required }));
  state.auth.user = profile.user;
  state.auth.required = Boolean(profile.required || state.auth.config?.required);
  if (state.auth.required && !state.auth.user) showAuthGate("Login with your Supabase demo account.");
  else hideAuthGate();
}

function pretty(data) {
  return data ? JSON.stringify(data, null, 2) : "";
}

function setEditor(key, value) {
  const editor = $(`#${key}-editor`);
  if (editor) editor.value = pretty(value);
}

function folderName(folderId) {
  return state.folders.find((folder) => folder.id === folderId)?.name || "No folder";
}

function clientName(clientId) {
  return state.organization.clients.find((client) => client.id === clientId)?.name || "No client";
}

function campaignName(campaignId) {
  return state.organization.campaigns.find((campaign) => campaign.id === campaignId)?.name || "No campaign";
}

function staffName(staffId) {
  return state.organization.staff.find((staff) => staff.id === staffId)?.name || "Unassigned";
}

function typeLabel(type) {
  return type === "auto-clipper" ? "Auto Clipper" : "AI Generator";
}

function setSectionVisible(selector, visible) {
  const node = $(selector);
  if (node) node.hidden = !visible;
}

function activeProjectType() {
  return state.data?.summary?.type || state.projects.find((project) => project.name === state.activeProject)?.type || "ai-generator";
}

function projectViewForType(type) {
  return type === "auto-clipper" ? "auto-clipper-project" : "ai-generator-project";
}

function setCreateType(type) {
  state.selectedProjectType = type === "auto-clipper" ? "auto-clipper" : "ai-generator";
  for (const option of $$("#project-type-choice [data-project-type]")) {
    option.classList.toggle("active", option.dataset.projectType === state.selectedProjectType);
  }
}

function showView(viewName = "dashboard") {
  if (isClientUser() && ["ai-generator-project", "auto-clipper-project"].includes(viewName)) {
    viewName = "media-library";
  }
  state.activeView = viewName;
  const isProjectView = ["ai-generator-project", "auto-clipper-project"].includes(viewName);
  const isOverviewView = ["dashboard", "media-library", "analytics"].includes(viewName);

  setSectionVisible("#studio-overview", isOverviewView);
  setSectionVisible("#workflow-steps", isProjectView && Boolean(state.data));
  setSectionVisible("#production-jobs-panel", isProjectView && Boolean(state.data));
  for (const node of $$(".ai-workflow")) node.hidden = viewName !== "ai-generator-project";
  setSectionVisible("#clipper-generator", viewName === "auto-clipper-project");

  for (const [selector, views] of [
    ["#studio-overview .overview-grid", ["dashboard"]],
    ["#client-campaigns", ["dashboard"]],
    ["#media-review", ["dashboard"]],
    ["#approval-queue", ["dashboard"]],
    ["#supabase-panel", ["dashboard"]],
    ["#media-library", ["media-library"]],
    ["#analytics-panel", ["analytics"]]
  ]) {
    setSectionVisible(selector, views.includes(viewName));
  }

  const subtitle = $(".hero-subtitle");
  if (subtitle) {
    if (viewName === "auto-clipper-project") {
      subtitle.textContent = "Staff editors can turn long-form source videos into short, review-ready social clips with subtitles and reaction overlays.";
    } else if (viewName === "ai-generator-project") {
      subtitle.textContent = "Staff editors can transform proven references into UGC-style campaign outputs with product assets, character control, and synced subtitles.";
    } else if (viewName === "media-library") {
      subtitle.textContent = "Review final outputs across clients, campaigns, approval states, and rendered media files.";
    } else if (viewName === "analytics") {
      subtitle.textContent = "Monitor production health, approval status, campaign workload, and team output.";
    } else {
      subtitle.textContent = "Run client campaigns from project assignment to AI-assisted output, review, and production analytics.";
    }
  }

  if (!isProjectView) {
    const titles = {
      dashboard: "Dashboard",
      "media-library": "Media Library",
      analytics: "Analytics"
    };
    setText("#active-title", titles[viewName] || "Dashboard");
    setText("#next-action-title", viewName === "dashboard" ? "Select or create a project" : "Return to dashboard");
    const nextButton = $("#next-action-button");
    if (nextButton) {
      nextButton.textContent = viewName === "dashboard" ? "Create" : "Dashboard";
      nextButton.onclick = () => {
        if (viewName === "dashboard") $("#project-name")?.focus();
        else showView("dashboard");
      };
    }
  }
}

function applyRoleVisibility() {
  const role = state.auth.user?.role || (state.auth.required ? "anonymous" : "admin");
  document.body.dataset.role = role;
  setText("#auth-user-label", state.auth.user ? `${state.auth.user.name} · ${state.auth.user.role}` : "Local demo");
  const adminOnly = ["#project-form", "#folder-form", "#client-campaigns", "#supabase-panel"];
  for (const selector of adminOnly) {
    const node = $(selector);
    if (node) node.hidden = !isAdminUser();
  }
  for (const node of $$("[data-project-shortcut]")) {
    node.hidden = isClientUser();
  }
  const folderMove = $("#active-project-folder");
  if (folderMove) folderMove.hidden = !isAdminUser();
  const hostedDemo = Boolean(state.auth.config?.hostedDemo);
  const heavyActions = [
    "#run-analysis",
    "#generate-ugc-video",
    "#transcribe-generated-video",
    "#render-final-video",
    "#download-clipper-source",
    "#analyze-clipper-source",
    "#render-clipper-video",
    "#render-selected-clips",
    "#render-character-variations",
    "#generate-content",
    "#run-pipeline",
    "#generate-images",
    "#generate-test-video",
    "#generate-all-videos",
    "#generate-voiceover"
  ];
  for (const selector of heavyActions) {
    const node = $(selector);
    if (node) {
      if (hostedDemo) {
        node.title = "Hosted mode queues this job for the local production worker.";
      } else if (node.title === "Hosted mode queues this job for the local production worker.") {
        node.removeAttribute("title");
      }
    }
  }
  if (isClientUser() && !["media-library", "analytics", "dashboard"].includes(state.activeView)) {
    showView("media-library");
  }
}

on("#auth-logout", "click", async () => {
  signOut();
  state.auth.user = null;
  state.activeProject = null;
  state.data = null;
  if (state.auth.required) showAuthGate("Logged out.");
  await initializeAuth();
  if (!state.auth.required) await refreshProjects();
  renderData();
});

function renderStudioMetrics() {
  const db = state.supabaseAnalytics;
  const aiCount = db ? Number(db.ai_projects || 0) : state.projects.filter((project) => project.type !== "auto-clipper").length;
  const clipperCount = db ? Number(db.clipper_projects || 0) : state.projects.filter((project) => project.type === "auto-clipper").length;
  const renderCount = db ? Number(db.renders || 0) : state.projects.reduce((total, project) => total + Number(project.renderCount || 0), 0);
  const reviewCount = state.projects.filter((project) => project.hasUgcVideo || project.hasClipperRender || project.renderCount > 0).length;

  setText("#metric-active-projects", String(db ? Number(db.projects || 0) : state.projects.length));
  setText("#metric-renders", String(renderCount));
  setText("#metric-review", String(reviewCount));
  setText("#metric-split", `${aiCount} / ${clipperCount}`);
}

function renderAnalytics() {
  const db = state.supabaseAnalytics;
  const approvalCounts = db?.approval_breakdown
    ? Object.entries(db.approval_breakdown).map(([status, count]) => ({ status, count }))
    : ["draft", "in-review", "approved", "changes-requested"].map((status) => ({
      status,
      count: state.projects.filter((project) => (project.approvalStatus || "draft") === status).length
    }));
  const staffRows = db?.staff_workload || state.organization.staff.map((staff) => ({
    name: staff.name,
    count: state.projects.filter((project) => project.assignedStaffId === staff.id).length
  }));
  const campaignRows = db?.campaign_projects || state.organization.campaigns.map((campaign) => ({
    name: campaign.name,
    count: state.projects.filter((project) => project.campaignId === campaign.id).length
  }));
  const assetRows = db?.asset_breakdown || [];
  const monthlyRows = db?.monthly_renders || [];

  setHTML("#analytics-breakdown", `
    <article>
      <strong>Approval Status ${db ? "(Supabase)" : "(Local)"}</strong>
      ${approvalCounts.map((item) => `<span>${item.status}: ${item.count}</span>`).join("")}
    </article>
    <article>
      <strong>Staff Workload ${db ? "(Supabase)" : "(Local)"}</strong>
      ${staffRows.map((item) => `<span>${item.name}: ${item.count}</span>`).join("")}
    </article>
    <article>
      <strong>Campaign Projects ${db ? "(Supabase)" : "(Local)"}</strong>
      ${campaignRows.map((item) => `<span>${item.name}: ${item.count}</span>`).join("")}
    </article>
    <article>
      <strong>Asset Uploads ${db ? "(Supabase)" : "(Local)"}</strong>
      ${assetRows.length ? assetRows.map((item) => `<span>${item.name}: ${item.count}</span>`).join("") : "<span>Run Supabase sync to populate asset rows</span>"}
    </article>
    <article>
      <strong>Clip Candidates</strong>
      <span>${db ? Number(db.clip_candidates || 0) : 0} generated highlights</span>
    </article>
    <article>
      <strong>Monthly Renders ${db ? "(Supabase)" : "(Local)"}</strong>
      ${monthlyRows.length ? monthlyRows.map((item) => `<span>${item.month}: ${item.count}</span>`).join("") : "<span>No monthly render data yet</span>"}
    </article>
  `);
}

function renderSupabasePanel() {
  const status = state.supabase || {};
  const ready = status.connected && status.schemaReady;
  const stateNode = $("#supabase-state");
  if (stateNode) {
    stateNode.textContent = ready ? "Ready" : status.connected ? "Connected" : status.configured ? "Needs setup" : "Missing env";
    stateNode.className = `mini-state ${ready ? "ready" : ""}`;
  }
  setHTML("#supabase-breakdown", `
    <article>
      <strong>Configuration</strong>
      <span>${status.configured ? "Environment keys found" : "Missing Supabase env keys"}</span>
      <span>${status.projectRef ? `Project: ${status.projectRef}` : "Project ref unavailable"}</span>
    </article>
    <article>
      <strong>Connection</strong>
      <span>${status.connected ? "Database connected" : "Not connected"}</span>
      <span>${status.schemaReady ? "Schema ready" : "Schema not initialized"}</span>
    </article>
    <article>
      <strong>Last Action</strong>
      <span>${status.lastAction || "No sync yet"}</span>
      <span>${status.error ? status.error : "No error reported"}</span>
    </article>
  `);
}

function renderApprovalQueue() {
  const reviewProjects = state.projects.filter((project) => ["in-review", "changes-requested", "approved"].includes(project.approvalStatus));
  const pendingCount = state.projects.filter((project) => project.approvalStatus === "in-review").length;
  setText("#approval-count", `${pendingCount} pending`);
  setHTML("#approval-list", reviewProjects.length
    ? reviewProjects.map((project) => `
        <article class="approval-item">
          <div>
            <p class="eyebrow">${clientName(project.clientId)} · ${campaignName(project.campaignId)}</p>
            <h3>${project.name}</h3>
            <p class="project-meta">${typeLabel(project.type)} · ${staffName(project.assignedStaffId)} · ${project.approvalFeedback || "No feedback yet"}</p>
          </div>
          <span class="approval-badge ${project.approvalStatus}">${project.approvalStatus}</span>
        </article>
      `).join("")
    : `<p class="project-meta">Submit a rendered project for review and it will appear here.</p>`);
}

function renderMediaLibrary() {
  setText("#media-count", `${state.mediaItems.length} files`);
  setHTML("#media-library-grid", state.mediaItems.length
    ? state.mediaItems.map((item) => `
        <article class="media-card">
          <video src="${item.url}" controls></video>
          <div>
            <strong>${item.name}</strong>
            <span>${item.project} · ${typeLabel(item.projectType)}</span>
            <span>${clientName(item.clientId)} · ${campaignName(item.campaignId)}</span>
            <span class="approval-badge ${item.approvalStatus || "draft"}">${item.approvalStatus || "draft"}</span>
          </div>
        </article>
      `).join("")
    : `<p class="project-meta">Rendered videos and clips appear here after Remotion output is ready.</p>`);
}

function renderProductionJobs() {
  const jobs = state.productionJobs || [];
  setHTML("#production-jobs-list", jobs.length
    ? jobs.map((job) => `
        <article>
          <strong>${job.jobType || "production-job"}</strong>
          <span class="approval-badge ${job.status || "queued"}">${job.status || "queued"}</span>
          <span>${job.createdAt ? `Created ${new Date(job.createdAt).toLocaleString()}` : "Created locally"}</span>
          ${job.startedAt ? `<span>Started ${new Date(job.startedAt).toLocaleString()}</span>` : ""}
          ${job.completedAt ? `<span>Completed ${new Date(job.completedAt).toLocaleString()}</span>` : ""}
          ${job.outputUrl ? `<a href="${job.outputUrl}" target="_blank" rel="noreferrer">Open output</a>` : "<span>Output pending</span>"}
          ${job.error ? `<span>${job.error}</span>` : ""}
        </article>
      `).join("")
    : `<article><strong>No queued jobs yet</strong><span>Hosted generation and render requests will appear here for the local worker.</span></article>`);
}

function renderFolders() {
  const rows = [
    { id: "", name: "All Projects", count: state.projects.length },
    ...state.folders.map((folder) => ({
      ...folder,
      count: state.projects.filter((project) => project.folderId === folder.id).length
    }))
  ];

  setHTML("#folder-list", rows.map((folder) => `
    <button type="button" class="folder-button ${state.activeFolder === folder.id ? "active" : ""}" data-folder-filter="${folder.id}">
      <span>${folder.name}</span>
      <span>${folder.count}</span>
    </button>
  `).join(""));

  const options = [
    `<option value="">No folder</option>`,
    ...state.folders.map((folder) => `<option value="${folder.id}">${folder.name}</option>`)
  ].join("");

  const createSelect = $("#project-folder-select");
  if (createSelect) createSelect.innerHTML = options;

  const activeSelect = $("#active-project-folder");
  if (activeSelect) {
    activeSelect.innerHTML = options;
    activeSelect.value = state.data?.summary?.folderId || "";
    activeSelect.style.display = ["ai-generator-project", "auto-clipper-project"].includes(state.activeView) ? "block" : "none";
  }
}

function renderOrganizationControls() {
  const clientOptions = [
    `<option value="">Select client</option>`,
    ...state.organization.clients.map((client) => `<option value="${client.id}">${client.name}</option>`)
  ].join("");
  const campaignOptions = [
    `<option value="">Select campaign</option>`,
    ...state.organization.campaigns.map((campaign) => `<option value="${campaign.id}">${campaign.name}</option>`)
  ].join("");
  const staffOptions = [
    `<option value="">Assign staff/editor</option>`,
    ...state.organization.staff
      .filter((person) => person.role !== "manager-client")
      .map((person) => `<option value="${person.id}">${person.name} · ${person.role}</option>`)
  ].join("");
  const reviewerOptions = [
    `<option value="">Select reviewer/client</option>`,
    ...state.organization.staff
      .filter((person) => person.role !== "staff-editor")
      .map((person) => `<option value="${person.id}">${person.name} · ${person.role}</option>`)
  ].join("");

  for (const [selector, html] of [
    ["#project-client-select", clientOptions],
    ["#campaign-client-select", clientOptions],
    ["#project-campaign-select", campaignOptions],
    ["#project-staff-select", staffOptions],
    ["#project-reviewer-select", reviewerOptions]
  ]) {
    const node = $(selector);
    if (node) node.innerHTML = html;
  }
}

function renderProjects() {
  const list = $("#project-list");
  list.innerHTML = "";

  const visibleProjects = state.activeFolder
    ? state.projects.filter((project) => (project.folderId || "") === state.activeFolder)
    : state.projects;

  if (!visibleProjects.length) {
    list.innerHTML = `<p class="project-meta">No projects yet. Create one to start.</p>`;
    return;
  }

  for (const project of visibleProjects) {
    const card = document.createElement("article");
    card.className = `project-card ${project.name === state.activeProject ? "active" : ""}`;
    const workflowMeta = project.type === "auto-clipper"
      ? [
          project.hasClipperSource ? "Source ready" : "Needs source",
          project.hasClipperHighlights ? "Highlights ready" : "No highlights",
          project.hasClipperReaction ? "Reaction ready" : "Needs reaction",
          project.hasClipperRender ? "Clip ready" : "No clip"
        ]
      : [
          project.hasReference ? "Reference ready" : "Needs reference",
          project.hasProduct ? "Product ready" : "Needs product",
          project.hasCharacter ? "Character ready" : "Needs character",
          project.hasUgcVideo ? "UGC ready" : "No UGC"
        ];
    const projectMeta = [...workflowMeta, `${project.renderCount} renders`, project.approvalStatus || "draft"].join(" · ");
    card.innerHTML = `
      <button type="button" class="project-open" data-open-project="${project.name}">
        <span class="project-topline">
          <strong>${project.name}</strong>
          <span class="type-badge">${typeLabel(project.type)}</span>
        </span>
        <span class="project-meta">${projectMeta}</span>
        <span class="project-meta">${clientName(project.clientId)} · ${campaignName(project.campaignId)}</span>
        <span class="project-meta">${staffName(project.assignedStaffId)} · ${folderName(project.folderId)}</span>
      </button>
      <button type="button" class="project-delete" data-delete-project="${project.name}" aria-label="Delete ${project.name}">Delete</button>
    `;
    list.appendChild(card);
  }
}

function renderVideoItems(selector, videos, emptyText, labelPrefix = "") {
  setHTML(selector, videos.length
    ? videos.map((video) => `
        <div class="video-item">
          <video src="${video.url}" controls></video>
          <span>${labelPrefix}${video.name}</span>
        </div>
      `).join("")
    : `<p class="project-meta">${emptyText}</p>`);
}

function renderAssetGrid(selector, items, emptyText) {
  setHTML(selector, items?.length
    ? items.map((item) => `
        <div class="asset">
          <img src="${item.url}" alt="${item.name}">
          <span>${item.name}</span>
        </div>
      `).join("")
    : `<p class="project-meta">${emptyText}</p>`);
}

function renderReactionAssets(selector, items, emptyText) {
  setHTML(selector, items?.length
    ? items.map((item) => `
        <label class="asset reaction-asset ${state.selectedReactionIds.has(item.id) ? "selected" : ""}">
          <input type="checkbox" data-reaction-check="${item.id}" ${state.selectedReactionIds.has(item.id) ? "checked" : ""}>
          ${item.type === "video"
            ? `<video src="${item.url}" controls></video>`
            : `<img src="${item.url}" alt="${item.name}">`}
          <span>${item.name}</span>
        </label>
      `).join("")
    : `<p class="project-meta">${emptyText}</p>`);
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(value / 60);
  const rest = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function renderWorkspaceMode(type) {
  if (["dashboard", "media-library", "analytics"].includes(state.activeView)) {
    showView(state.activeView);
    return;
  }
  showView(state.activeProject ? projectViewForType(type) : "dashboard");
}

function renderClipperHighlights(data) {
  const manifest = data?.files?.clipperHighlights;
  const selected = data?.files?.clipperSelection;
  const candidates = manifest?.candidates || [];
  if (!candidates.length) {
    setHTML("#clipper-highlights", `<p class="project-meta">Highlight candidates appear here after analysis.</p>`);
    return;
  }

  setHTML("#clipper-highlights", candidates.map((candidate) => {
    const active = selected?.id === candidate.id;
    const checked = active || state.selectedHighlights.has(candidate.id);
    return `
      <article class="highlight-card ${active ? "active" : ""}">
        <label class="highlight-main">
          <input type="checkbox" data-highlight-check="${candidate.id}" ${checked ? "checked" : ""}>
          <span>
            <p class="eyebrow">${formatTime(candidate.start)} - ${formatTime(candidate.end)} · ${Math.round(candidate.durationSeconds || candidate.end - candidate.start)}s</p>
            <h3>${candidate.title}</h3>
            <p class="project-meta">${candidate.reason || "Strong candidate moment."}</p>
          </span>
        </label>
        <div class="highlight-side">
          <strong>${Math.round(candidate.score || 0)}</strong>
          <button type="button" data-select-highlight="${candidate.id}">${active ? "Active" : "Make Active"}</button>
        </div>
      </article>
    `;
  }).join(""));
}

function renderClipper(data) {
  const summary = data?.summary || {};
  const sourceVideo = $("#clipper-source-preview");
  if (sourceVideo) {
    if (data?.clipper?.sourceUrl) {
      sourceVideo.src = data.clipper.sourceUrl;
      sourceVideo.style.display = "block";
    } else {
      sourceVideo.removeAttribute("src");
      sourceVideo.style.display = "none";
    }
  }

  for (const [selector, ready] of [
    ["#clipper-source-state", summary.hasClipperSource],
    ["#clipper-reaction-state", summary.hasClipperReaction]
  ]) {
    const node = $(selector);
    if (!node) continue;
    node.textContent = ready ? "Ready" : "Waiting";
    node.className = `mini-state ${ready ? "ready" : ""}`;
  }

  renderReactionAssets("#clipper-reaction-preview", data?.clipper?.reactions, "Reaction character appears here after upload.");
  if (!state.reactionSelectionTouched && data?.clipper?.reactions?.length) {
    state.selectedReactionIds = new Set(data.clipper.reactions.map((reaction) => reaction.id));
    renderReactionAssets("#clipper-reaction-preview", data.clipper.reactions, "Reaction character appears here after upload.");
  }
  renderClipperHighlights(data);

  const activeRenders = (data?.renders || []).filter((render) => render.name === "final-clip.mp4");
  const bulkRenders = (data?.renders || []).filter((render) => render.name.startsWith("clips/"));
  renderVideoItems("#clipper-renders", activeRenders, "Active clip appears here after Remotion rendering.", "Active Clip · ");
  renderVideoItems("#clipper-bulk-renders", bulkRenders, "Bulk rendered clips appear here.", "Bulk · ");
  setText("#clipper-manifest-view", pretty(data?.files?.clipperVariationRenderManifest || data?.files?.clipperBulkRenderManifest || data?.files?.clipperRenderManifest || data?.files?.clipperSubtitlePlan || data?.files?.clipperTranscript || data?.files?.clipperSource) || "Clipper technical details appear here.");
}

function renderData() {
  const data = state.data;
  setText("#active-title", state.activeProject || "Select or create a project");

  if (!data) {
    setHTML("#frames", "");
    setText("#transcript-view", "");
    for (const key of ["styleAnalysis", "contentIdeas", "scriptPlan", "imagePrompts", "videoPrompts", "editPlan"]) {
      setEditor(key, null);
    }
    renderWorkflow(null);
    renderClipper(null);
    renderProductionJobs();
    renderWorkspaceMode(null);
    renderFolders();
    return;
  }

  renderWorkspaceMode(data.summary?.type || "ai-generator");
  renderFolders();

  const video = $("#reference-preview");
  if (data.referenceUrl) {
    video.src = data.referenceUrl;
    video.style.display = "block";
  } else {
    video.removeAttribute("src");
    video.style.display = "none";
  }

  setHTML("#frames", data.frames.length
    ? data.frames.map((frame) => `<img class="frame" src="${frame.url}" alt="${frame.name}">`).join("")
    : `<p class="project-meta">Frames appear here after analysis.</p>`);

  renderAssetGrid("#product-preview", data.products, "Product image appears here after upload.");
  renderAssetGrid("#character-preview", data.characters, "Character reference appears here after upload.");
  renderAssetGrid("#generated-images", data.images, "Generated images appear here after you run image generation.");

  const primaryUgcVideos = data.videos.filter((videoItem) => videoItem.name === "ugc-output.mp4");
  const candidateUgcVideos = data.videos.filter((videoItem) => videoItem.name.startsWith("ugc-candidate-"));
  const allUgcVideos = data.videos.filter((videoItem) => videoItem.name.startsWith("ugc-"));
  const legacyVideos = data.videos.filter((videoItem) => !videoItem.name.startsWith("ugc-"));
  const finalUgcRenders = data.renders.filter((render) => render.name !== "final-clip.mp4" && !render.name.startsWith("clips/"));

  renderVideoItems("#primary-ugc-video", primaryUgcVideos, "Primary output appears here as ugc-output.mp4.", "Primary Output · ");
  renderVideoItems("#candidate-ugc-videos", candidateUgcVideos, "Alternative LibTV candidates appear here.", "Candidate · ");
  renderVideoItems("#ugc-video-preview", allUgcVideos, "Full UGC video appears here after LibTV generation.");
  renderVideoItems("#generated-videos", legacyVideos, "Legacy scene videos appear here after optional scene generation.");
  renderVideoItems("#final-renders", finalUgcRenders, "Final MP4 appears here after Remotion rendering.");

  setHTML("#voiceover-audio", data.audio.length
    ? data.audio.map((audio) => `
        <div class="video-item">
          <audio src="${audio.url}" controls></audio>
          <span>${audio.name}</span>
        </div>
      `).join("")
    : `<p class="project-meta">Voiceover appears here after ElevenLabs generation.</p>`);

  setText("#libtv-manifest-view", pretty(data.files.libtvUgcVideo || data.files.libtvVideoAssets) || "LibTV session details appear here after video generation.");
  setText("#voiceover-manifest-view", pretty(data.files.voiceoverManifest) || "Voiceover details appear here after audio generation.");
  setText("#render-manifest-view", pretty(data.files.renderManifest) || "Render details appear here after final render.");
  setText("#transcript-view", pretty(data.files.generatedTranscript || data.files.transcript) || "Transcript appears here after analysis.");

  renderAnalysisQuality(data.files.styleAnalysis);
  renderWorkflow(data);
  renderClipper(data);
  renderProductionJobs();

  for (const [key, value] of Object.entries(data.files)) {
    setEditor(key, value);
  }
}

function renderAnalysisQuality(styleAnalysis) {
  const target = $("#analysis-quality");
  if (!target) return;
  if (!styleAnalysis) {
    target.innerHTML = `<p class="project-meta">Run analysis to see reference understanding quality.</p>`;
    return;
  }

  const items = [
    ["Confidence", styleAnalysis.confidence ?? "fallback/basic"],
    ["Content Type", styleAnalysis.contentType || styleAnalysis.format || "Unknown"],
    ["Persona", styleAnalysis.identity?.persona || "Not identified"],
    ["Hook Pattern", styleAnalysis.scriptStyle?.hookPattern || styleAnalysis.hookStyle || "Not identified"],
    ["Caption Style", styleAnalysis.captionStyle?.placement || styleAnalysis.captionStyle?.position || "Not identified"],
    ["Edit Speed", styleAnalysis.editingStyle?.cutSpeed || styleAnalysis.editingPace || "Not identified"],
    ["Scene Beats", Array.isArray(styleAnalysis.sceneRhythm) ? `${styleAnalysis.sceneRhythm.length} beats` : "Not mapped"]
  ];

  target.innerHTML = items.map(([label, value]) => `
    <div class="quality-card">
      <strong>${label}</strong>
      <span>${value}</span>
    </div>
  `).join("");
}

function renderWorkflow(data) {
  const target = $("#workflow-steps");
  const nextTitle = $("#next-action-title");
  const nextButton = $("#next-action-button");
  const referenceState = $("#reference-state");

  if (!target || !nextTitle || !nextButton) return;

  if (!data) {
    target.innerHTML = "";
    nextTitle.textContent = "Select project";
    nextButton.textContent = "Open";
    nextButton.onclick = () => {};
    if (referenceState) {
      referenceState.textContent = "Waiting";
      referenceState.className = "mini-state";
    }
    return;
  }

  const summary = data.summary;
  if (summary.type === "auto-clipper") {
    renderClipperWorkflow(data);
    return;
  }

  const hasBlueprint = Boolean(summary.hasReferenceBlueprint || summary.hasStyleAnalysis);
  const steps = [
    ["Reference", summary.hasReference, summary.hasReference ? "uploaded" : "needed"],
    ["Product", summary.hasProduct, summary.hasProduct ? "uploaded" : "needed"],
    ["Character", summary.hasCharacter, summary.hasCharacter ? "uploaded" : "needed"],
    ["Analyze", hasBlueprint, hasBlueprint ? `${summary.frameCount} frames` : "pending"],
    ["Generate", summary.hasUgcVideo, summary.hasUgcVideo ? "ready" : "pending"],
    ["Subtitles", summary.hasSubtitlePlan, summary.hasSubtitlePlan ? "ready" : "pending"],
    ["Finalize", summary.renderCount > 0, `${summary.renderCount} file`]
  ];

  target.innerHTML = steps.map(([label, done, detail]) => `
    <div class="step-card ${done ? "done" : "pending"}">
      <strong>${label}</strong>
      <span>${detail}</span>
    </div>
  `).join("");

  const states = [
    ["#reference-state", summary.hasReference],
    ["#product-state", summary.hasProduct],
    ["#character-state", summary.hasCharacter]
  ];
  for (const [selector, ready] of states) {
    const node = $(selector);
    if (!node) continue;
    node.textContent = ready ? "Ready" : "Waiting";
    node.className = `mini-state ${ready ? "ready" : ""}`;
  }

  let next = { title: "Review final render", label: "Render", action: () => scrollToSection("#generate-finish") };
  if (!summary.hasReference) next = { title: "Upload reference video", label: "Reference", action: () => scrollToSection("#source-assets") };
  else if (!summary.hasProduct) next = { title: "Upload product image", label: "Product", action: () => scrollToSection("#source-assets") };
  else if (!summary.hasCharacter) next = { title: "Upload character reference", label: "Character", action: () => scrollToSection("#source-assets") };
  else if (!hasBlueprint) next = { title: "Analyze reference brain", label: "Analyze", action: () => $("#run-analysis").click() };
  else if (!summary.hasUgcVideo) next = { title: "Generate clean UGC video", label: "Generate", action: () => scrollToSection("#generate-finish") };
  else if (!summary.hasSubtitlePlan) next = { title: "Transcribe generated output", label: "Subtitles", action: () => $("#transcribe-generated-video").click() };
  else if (summary.renderCount === 0) next = { title: "Render final MP4", label: "Render", action: () => $("#render-final-video").click() };

  nextTitle.textContent = next.title;
  nextButton.textContent = next.label;
  nextButton.onclick = next.action;
}

function renderClipperWorkflow(data) {
  const target = $("#workflow-steps");
  const nextTitle = $("#next-action-title");
  const nextButton = $("#next-action-button");
  if (!target || !nextTitle || !nextButton) return;

  const summary = data.summary;
  const steps = [
    ["Source", summary.hasClipperSource, summary.hasClipperSource ? "ready" : "needed"],
    ["Reaction", summary.hasClipperReaction, summary.hasClipperReaction ? "ready" : "optional"],
    ["Transcript", summary.hasClipperTranscript, summary.hasClipperTranscript ? "ready" : "pending"],
    ["Highlights", summary.hasClipperHighlights, summary.hasClipperHighlights ? "ready" : "pending"],
    ["Active", summary.hasClipperSelection, summary.hasClipperSelection ? "selected" : "pending"],
    ["Render", summary.hasClipperRender, summary.hasClipperRender ? `${summary.renderCount} files` : "pending"]
  ];

  target.innerHTML = steps.map(([label, done, detail]) => `
    <div class="step-card ${done ? "done" : "pending"}">
      <strong>${label}</strong>
      <span>${detail}</span>
    </div>
  `).join("");

  let next = { title: "Review rendered clips", label: "Render", action: () => scrollToSection("#clipper-generator") };
  if (!summary.hasClipperSource) next = { title: "Paste source link", label: "Source", action: () => scrollToSection("#clipper-generator") };
  else if (!summary.hasClipperHighlights) next = { title: "Analyze best moments", label: "Analyze", action: () => $("#analyze-clipper-source").click() };
  else if (!summary.hasClipperSelection) next = { title: "Choose active moment", label: "Select", action: () => scrollToSection("#clipper-highlights") };
  else if (!summary.hasClipperRender) next = { title: "Render selected clips", label: "Render", action: () => $("#render-selected-clips").click() };

  nextTitle.textContent = next.title;
  nextButton.textContent = next.label;
  nextButton.onclick = next.action;
}

async function refreshProjects() {
  const [projectData, organization, media, supabase, supabaseAnalytics] = await Promise.all([
    api("/api/projects"),
    api("/api/organization"),
    api("/api/media-library"),
    api("/api/supabase/status"),
    api("/api/supabase/analytics").catch(() => ({ analytics: null }))
  ]);
  state.projects = projectData.projects;
  state.folders = projectData.folders || [];
  state.organization = organization;
  state.mediaItems = media.items || [];
  state.supabase = { ...state.supabase, ...supabase };
  state.supabaseAnalytics = supabase.schemaReady ? supabaseAnalytics.analytics : null;
  renderStudioMetrics();
  renderAnalytics();
  renderSupabasePanel();
  renderApprovalQueue();
  renderMediaLibrary();
  renderOrganizationControls();
  renderFolders();
  renderProjects();
  applyRoleVisibility();
}

async function loadProductionJobs(project = state.activeProject) {
  if (!project) {
    state.productionJobs = [];
    renderProductionJobs();
    return [];
  }
  const result = await api(`/api/projects/${encodeURIComponent(project)}/jobs`);
  state.productionJobs = result.jobs || [];
  renderProductionJobs();
  return state.productionJobs;
}

async function handleActionResult(result, readyText, queuedText = "Production job queued") {
  state.data = result.data || state.data;
  if (result.queued) {
    if (result.job) {
      state.productionJobs = [
        result.job,
        ...state.productionJobs.filter((job) => job.id !== result.job.id)
      ];
    }
    await loadProductionJobs().catch(() => {});
    await refreshProjects();
    renderData();
    setStatus(`${queuedText}${result.job?.jobType ? `: ${result.job.jobType}` : ""}`);
    return true;
  }
  await refreshProjects();
  renderData();
  setStatus(typeof readyText === "function" ? readyText(result) : readyText);
  return false;
}

async function selectProject(name) {
  state.activeProject = name;
  state.selectedHighlights = new Set();
  state.selectedReactionIds = new Set();
  state.reactionSelectionTouched = false;
  setStatus("Loading project");
  state.data = await api(`/api/projects/${encodeURIComponent(name)}`);
  state.activeView = projectViewForType(state.data?.summary?.type);
  await loadProductionJobs(name).catch(() => {
    state.productionJobs = [];
  });
  const selectedId = state.data?.files?.clipperSelection?.id;
  if (selectedId) state.selectedHighlights.add(selectedId);
  await refreshProjects();
  renderData();
  setStatus("Ready");
}

function requireProject() {
  if (!state.activeProject) throw new Error("Select a project first.");
  return state.activeProject;
}

async function uploadBinary({ inputSelector, endpoint, missingMessage, uploadingStatus, doneStatus }) {
  const project = requireProject();
  const input = $(inputSelector);
  const files = Array.from(input?.files || []);
  if (!files.length) throw new Error(missingMessage);

  setStatus(uploadingStatus);
  for (const file of files) {
    const limit = UPLOAD_LIMITS[endpoint];
    if (limit && file.size > limit.bytes) {
      const message = `${limit.label} is ${formatBytes(file.size)}. Current limit is ${formatBytes(limit.bytes)}. Please compress or trim it, then upload again.`;
      showLimitModal(message);
      throw new Error(message);
    }

    await fetch(`/api/projects/${encodeURIComponent(project)}/${endpoint}`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/octet-stream",
        "X-File-Name": file.name
      },
      body: file
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
    });
  }

  await selectProject(project);
  setStatus(files.length > 1 ? `${files.length} files uploaded` : doneStatus);
}

on("#project-form", "submit", async (event) => {
  event.preventDefault();
  const input = $("#project-name");
  const name = input.value.trim();
  if (!name) return;

  try {
    setStatus("Creating project");
    const result = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        type: state.selectedProjectType,
        clientId: $("#project-client-select")?.value || "",
        campaignId: $("#project-campaign-select")?.value || "",
        assignedStaffId: $("#project-staff-select")?.value || "",
        reviewerId: $("#project-reviewer-select")?.value || "",
        priority: $("#project-priority-select")?.value || "normal",
        folderId: $("#project-folder-select")?.value || ""
      })
    });
    input.value = "";
    await refreshProjects();
    await selectProject(result.project.name);
  } catch (error) {
    setStatus(error.message);
  }
});

on("#client-form", "submit", async (event) => {
  event.preventDefault();
  const name = $("#client-name").value.trim();
  if (!name) return;
  try {
    setStatus("Creating client");
    const result = await api("/api/clients", {
      method: "POST",
      body: JSON.stringify({
        name,
        industry: $("#client-industry").value.trim()
      })
    });
    state.organization = result.organization;
    state.projects = result.projects || state.projects;
    state.folders = result.folders || state.folders;
    $("#client-name").value = "";
    $("#client-industry").value = "";
    renderOrganizationControls();
    renderProjects();
    setStatus("Client created");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#campaign-form", "submit", async (event) => {
  event.preventDefault();
  const clientId = $("#campaign-client-select").value;
  const name = $("#campaign-name").value.trim();
  if (!clientId || !name) return;
  try {
    setStatus("Creating campaign");
    const result = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        name,
        objective: $("#campaign-objective").value.trim()
      })
    });
    state.organization = result.organization;
    state.projects = result.projects || state.projects;
    state.folders = result.folders || state.folders;
    $("#campaign-name").value = "";
    $("#campaign-objective").value = "";
    renderOrganizationControls();
    renderProjects();
    setStatus("Campaign created");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#init-supabase", "click", async () => {
  await withBusyButton("#init-supabase", "Initializing...", async () => {
    try {
      setStatus("Initializing Supabase schema");
      const result = await api("/api/supabase/init", { method: "POST", body: JSON.stringify({}) });
      state.supabase = { ...state.supabase, ...result.status, lastAction: "Schema initialized" };
      if (result.status?.schemaReady) {
        const analytics = await api("/api/supabase/analytics").catch(() => ({ analytics: null }));
        state.supabaseAnalytics = analytics.analytics;
      }
      renderStudioMetrics();
      renderAnalytics();
      renderSupabasePanel();
      setStatus("Supabase schema ready");
    } catch (error) {
      state.supabase = { ...state.supabase, error: error.message, lastAction: "Schema init failed" };
      renderSupabasePanel();
      setStatus(error.message);
    }
  });
});

on("#sync-supabase", "click", async () => {
  await withBusyButton("#sync-supabase", "Syncing...", async () => {
    try {
      setStatus("Syncing local records to Supabase");
      const result = await api("/api/supabase/sync-local", { method: "POST", body: JSON.stringify({}) });
      state.supabase = {
        ...state.supabase,
        ...result.status,
        lastAction: `Synced ${result.result.projects} projects and ${result.result.renders} renders`
      };
      if (result.status?.schemaReady) {
        const analytics = await api("/api/supabase/analytics").catch(() => ({ analytics: null }));
        state.supabaseAnalytics = analytics.analytics;
      }
      renderStudioMetrics();
      renderAnalytics();
      renderSupabasePanel();
      setStatus("Supabase records synced");
    } catch (error) {
      state.supabase = { ...state.supabase, error: error.message, lastAction: "Sync failed" };
      renderSupabasePanel();
      setStatus(error.message);
    }
  });
});

on("#project-type-choice", "click", (event) => {
  const button = event.target.closest("[data-project-type]");
  if (!button) return;
  setCreateType(button.dataset.projectType);
});

on("#auth-form", "submit", async (event) => {
  event.preventDefault();
  try {
    setText("#auth-message", "Logging in...");
    await signIn($("#auth-email").value.trim(), $("#auth-password").value);
    await initializeAuth();
    await refreshProjects();
    renderData();
    setStatus(`Logged in as ${state.auth.user?.name || "user"}`);
  } catch (error) {
    setText("#auth-message", error.message);
  }
});

on(".sidebar-menu", "click", (event) => {
  const viewLink = event.target.closest("[data-nav-view]");
  if (viewLink) {
    event.preventDefault();
    showView(viewLink.dataset.navView);
    renderFolders();
    return;
  }

  const shortcut = event.target.closest("[data-project-shortcut]");
  if (!shortcut) return;
  event.preventDefault();
  const type = shortcut.dataset.projectShortcut;
  setCreateType(type);

  if (state.activeProject && activeProjectType() === type) {
    showView(projectViewForType(type));
    renderWorkflow(state.data);
    renderFolders();
    return;
  }

  showView("dashboard");
  setStatus(`Create or select an ${typeLabel(type)} project first.`);
  $("#project-name")?.focus();
});

on("#folder-form", "submit", async (event) => {
  event.preventDefault();
  const input = $("#folder-name");
  const name = input.value.trim();
  if (!name) return;

  try {
    setStatus("Creating folder");
    const result = await api("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    state.folders = result.folders || [];
    state.projects = result.projects || state.projects;
    input.value = "";
    renderFolders();
    renderProjects();
    setStatus("Folder ready");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#folder-list", "click", (event) => {
  const button = event.target.closest("[data-folder-filter]");
  if (!button) return;
  state.activeFolder = button.dataset.folderFilter;
  renderFolders();
  renderProjects();
});

on("#project-list", "click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-project]");
  if (deleteButton) {
    const projectName = deleteButton.dataset.deleteProject;
    const confirmed = window.confirm(`Delete project "${projectName}"? This removes its files from the local projects folder.`);
    if (!confirmed) return;
    try {
      setStatus("Deleting project");
      const result = await api(`/api/projects/${encodeURIComponent(projectName)}`, {
        method: "DELETE"
      });
      state.projects = result.projects || [];
      state.folders = result.folders || [];
      if (state.activeProject === projectName) {
        state.activeProject = null;
        state.data = null;
        const nextProject = state.projects.find((project) => !state.activeFolder || project.folderId === state.activeFolder) || state.projects[0];
        if (nextProject) await selectProject(nextProject.name);
        else renderData();
      } else {
        renderFolders();
        renderProjects();
      }
      setStatus("Project deleted");
    } catch (error) {
      setStatus(error.message);
    }
    return;
  }

  const openButton = event.target.closest("[data-open-project]");
  if (openButton) selectProject(openButton.dataset.openProject);
});

on("#active-project-folder", "change", async (event) => {
  try {
    const project = requireProject();
    setStatus("Moving project");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/meta`, {
      method: "PUT",
      body: JSON.stringify({ folderId: event.target.value })
    });
    state.data = result.data;
    await refreshProjects();
    renderData();
    setStatus("Project moved");
  } catch (error) {
    setStatus(error.message);
  }
});

async function updateActiveApproval({ approvalStatus, approvalFeedback = "" }) {
  const project = requireProject();
  const now = new Date().toISOString();
  const payload = {
    approvalStatus,
    approvalFeedback
  };
  if (approvalStatus === "in-review") payload.reviewSubmittedAt = now;
  if (approvalStatus === "approved" || approvalStatus === "changes-requested") payload.reviewedAt = now;
  const result = await api(`/api/projects/${encodeURIComponent(project)}/meta`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  state.data = result.data;
  await refreshProjects();
  renderData();
}

on("#submit-for-review", "click", async () => {
  try {
    setStatus("Submitting project for review");
    await updateActiveApproval({
      approvalStatus: "in-review",
      approvalFeedback: $("#approval-feedback")?.value.trim() || "Submitted for manager/client review."
    });
    setStatus("Project submitted for review");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#approve-project", "click", async () => {
  try {
    setStatus("Approving project");
    await updateActiveApproval({
      approvalStatus: "approved",
      approvalFeedback: $("#approval-feedback")?.value.trim() || "Approved."
    });
    setStatus("Project approved");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#request-changes", "click", async () => {
  try {
    setStatus("Requesting changes");
    await updateActiveApproval({
      approvalStatus: "changes-requested",
      approvalFeedback: $("#approval-feedback")?.value.trim() || "Changes requested."
    });
    setStatus("Changes requested");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#limit-modal", "click", (event) => {
  if (event.target.closest("[data-close-limit-modal]")) closeLimitModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLimitModal();
});

on("#upload-reference", "click", async () => {
  try {
    await uploadBinary({
      inputSelector: "#reference-file",
      endpoint: "reference",
      missingMessage: "Choose a video file first.",
      uploadingStatus: "Uploading reference",
      doneStatus: "Reference uploaded"
    });
  } catch (error) {
    setStatus(error.message);
  }
});

on("#upload-product", "click", async () => {
  try {
    await uploadBinary({
      inputSelector: "#product-file",
      endpoint: "product",
      missingMessage: "Choose a product image first.",
      uploadingStatus: "Uploading product",
      doneStatus: "Product uploaded"
    });
  } catch (error) {
    setStatus(error.message);
  }
});

on("#upload-character", "click", async () => {
  try {
    await uploadBinary({
      inputSelector: "#character-file",
      endpoint: "character",
      missingMessage: "Choose a character image first.",
      uploadingStatus: "Uploading character",
      doneStatus: "Character uploaded"
    });
  } catch (error) {
    setStatus(error.message);
  }
});

on("#run-analysis", "click", async () => {
  try {
    const project = requireProject();
    setStatus("Analyzing reference");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/analyze-reference`, {
      method: "POST",
      body: JSON.stringify({ frames: 10 })
    });
    await handleActionResult(result, "Analysis complete", "Reference analysis queued");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#generate-ugc-video", "click", async () => {
  try {
    const project = requireProject();
    setStatus("Generating UGC video");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/generate-ugc-video`, {
      method: "POST",
      body: JSON.stringify({ maxSeconds: 300 })
    });
    await handleActionResult(
      result,
      (response) => response.result?.status === "completed" ? "UGC video ready" : "Still processing in LibTV",
      "UGC video generation queued"
    );
  } catch (error) {
    setStatus(error.message);
  }
});

on("#transcribe-generated-video", "click", async () => {
  try {
    const project = requireProject();
    setStatus("Transcribing generated video");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/transcribe-generated-video`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await handleActionResult(result, "Subtitles ready", "Generated video transcription queued");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#render-final-video", "click", async () => {
  try {
    const project = requireProject();
    setStatus("Rendering final MP4");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/render`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await handleActionResult(result, "Final MP4 ready", "Final MP4 render queued");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#upload-clipper-reaction", "click", async () => {
  try {
    await uploadBinary({
      inputSelector: "#clipper-reaction-file",
      endpoint: "clipper/reaction",
      missingMessage: "Choose a reaction image or video first.",
      uploadingStatus: "Uploading reaction character",
      doneStatus: "Reaction character uploaded"
    });
  } catch (error) {
    setStatus(error.message);
  }
});

on("#clipper-reaction-preview", "click", (event) => {
  const checkbox = event.target.closest("[data-reaction-check]");
  if (!checkbox) return;
  state.reactionSelectionTouched = true;
  if (checkbox.checked) state.selectedReactionIds.add(checkbox.dataset.reactionCheck);
  else state.selectedReactionIds.delete(checkbox.dataset.reactionCheck);
  renderReactionAssets("#clipper-reaction-preview", state.data?.clipper?.reactions || [], "Reaction character appears here after upload.");
});

on("#analyze-clipper-source", "click", async () => {
  await withBusyButton("#analyze-clipper-source", "Analyzing...", async () => {
    try {
      const project = requireProject();
      setStatus("Analyzing source video. This can take a few minutes for longer clips.");
      const result = await api(`/api/projects/${encodeURIComponent(project)}/clipper/analyze`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await handleActionResult(result, "Highlight candidates ready", "Clipper highlight analysis queued");
    } catch (error) {
      setStatus(error.message);
    }
  });
});

on("#download-clipper-source", "click", async () => {
  await withBusyButton("#download-clipper-source", "Downloading...", async () => {
    try {
      const project = requireProject();
      const url = $("#clipper-source-url")?.value?.trim();
      if (!url) throw new Error("Paste a YouTube or TikTok link first.");
      setStatus("Downloading clipper source. Some platforms can take a little while.");
      const result = await api(`/api/projects/${encodeURIComponent(project)}/clipper/source-link`, {
        method: "POST",
        body: JSON.stringify({ url })
      });
      await handleActionResult(result, "Clipper source ready", "Source download queued");
    } catch (error) {
      setStatus(error.message);
    }
  });
});

on("#clipper-highlights", "click", async (event) => {
  const checkbox = event.target.closest("[data-highlight-check]");
  if (checkbox) {
    if (checkbox.checked) state.selectedHighlights.add(checkbox.dataset.highlightCheck);
    else state.selectedHighlights.delete(checkbox.dataset.highlightCheck);
    return;
  }

  const button = event.target.closest("[data-select-highlight]");
  if (!button) return;
  try {
    const project = requireProject();
    setStatus("Selecting highlight");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/clipper/select-highlight`, {
      method: "POST",
      body: JSON.stringify({ highlightId: button.dataset.selectHighlight })
    });
    state.data = result.data;
    state.selectedHighlights.add(button.dataset.selectHighlight);
    await refreshProjects();
    renderData();
    setStatus("Highlight selected");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#render-clipper-video", "click", async () => {
  const button = $("#render-clipper-video");
  try {
    const project = requireProject();
    if (!state.data?.summary?.hasClipperSelection) {
      throw new Error("Make one highlight active first.");
    }
    setStatus("Rendering active clip. This can take a few minutes.");
    if (button) {
      button.disabled = true;
      button.textContent = "Rendering...";
    }
    const result = await api(`/api/projects/${encodeURIComponent(project)}/clipper/render`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await handleActionResult(result, "Active clip ready", "Active clip render queued");
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Render Active Clip";
    }
  }
});

on("#render-selected-clips", "click", async () => {
  const button = $("#render-selected-clips");
  try {
    const project = requireProject();
    const highlightIds = Array.from(state.selectedHighlights);
    if (!highlightIds.length) throw new Error("Select one or more highlight candidates first.");
    setStatus(`Rendering ${highlightIds.length} clips. This can take a while.`);
    if (button) {
      button.disabled = true;
      button.textContent = "Rendering...";
    }
    const result = await api(`/api/projects/${encodeURIComponent(project)}/clipper/render-bulk`, {
      method: "POST",
      body: JSON.stringify({ highlightIds })
    });
    await handleActionResult(
      result,
      (response) => response.result?.failed ? `${response.result.completed} clips rendered, ${response.result.failed} failed` : "Selected clips rendered",
      "Selected clip renders queued"
    );
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Render Selected Clips";
    }
  }
});

on("#render-character-variations", "click", async () => {
  const button = $("#render-character-variations");
  try {
    const project = requireProject();
    if (!state.data?.summary?.hasClipperSelection) throw new Error("Make one highlight active first.");
    const reactionIds = Array.from(state.selectedReactionIds);
    if (!reactionIds.length) throw new Error("Select one or more reaction characters first.");
    setStatus(`Rendering ${reactionIds.length} character variations. This can take a while.`);
    if (button) {
      button.disabled = true;
      button.textContent = "Rendering...";
    }
    const result = await api(`/api/projects/${encodeURIComponent(project)}/clipper/render-variations`, {
      method: "POST",
      body: JSON.stringify({ reactionIds })
    });
    await handleActionResult(
      result,
      (response) => response.result?.failed ? `${response.result.completed} variations rendered, ${response.result.failed} failed` : "Character variations ready",
      "Character variation renders queued"
    );
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Render Character Variations";
    }
  }
});

on("#generate-content", "click", async () => {
  try {
    const project = requireProject();
    const topic = $("#topic-input").value.trim();
    if (!topic) throw new Error("Add a topic first.");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/generate`, {
      method: "POST",
      body: JSON.stringify({ topic })
    });
    await handleActionResult(result, "Content plan ready", "Content planning queued");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#generate-images", "click", async () => {
  try {
    const project = requireProject();
    const result = await api(`/api/projects/${encodeURIComponent(project)}/images`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await handleActionResult(result, "Images ready", "Image generation queued");
  } catch (error) {
    setStatus(error.message);
  }
});

async function generateVideos(limit, label) {
  const project = requireProject();
  setStatus(label);
  const result = await api(`/api/projects/${encodeURIComponent(project)}/videos`, {
    method: "POST",
    body: JSON.stringify({ limit, maxSeconds: 180 })
  });
  await handleActionResult(
    result,
    (response) => response.result?.status === "completed" ? "Videos ready" : "Still processing in LibTV",
    "Scene video generation queued"
  );
}

on("#generate-test-video", "click", async () => {
  try {
    await generateVideos(1, "Generating test video");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#generate-all-videos", "click", async () => {
  try {
    await generateVideos(0, "Generating all videos");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#generate-voiceover", "click", async () => {
  try {
    const project = requireProject();
    const result = await api(`/api/projects/${encodeURIComponent(project)}/voiceover`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await handleActionResult(result, "Voiceover ready", "Voiceover generation queued");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#run-pipeline", "click", async () => {
  try {
    const project = requireProject();
    const topic = $("#topic-input").value.trim();
    if (!topic) throw new Error("Add a topic first.");
    const result = await api(`/api/projects/${encodeURIComponent(project)}/pipeline`, {
      method: "POST",
      body: JSON.stringify({ topic, frames: 10 })
    });
    await handleActionResult(result, "Pipeline complete", "Full pipeline queued");
  } catch (error) {
    setStatus(error.message);
  }
});

on("#refresh-production-jobs", "click", async () => {
  try {
    await loadProductionJobs();
    setStatus("Production jobs refreshed");
  } catch (error) {
    setStatus(error.message);
  }
});

for (const button of $$("[data-save-json]")) {
  button.addEventListener("click", async () => {
    try {
      const project = requireProject();
      const key = button.dataset.saveJson;
      const editor = $(`#${key}-editor`);
      const data = JSON.parse(editor.value);
      setStatus(`Saving ${key}`);
      const result = await api(`/api/projects/${encodeURIComponent(project)}/json`, {
        method: "PUT",
        body: JSON.stringify({ key, data })
      });
      state.data = result.data;
      renderData();
      setStatus("Saved");
    } catch (error) {
      setStatus(error.message);
    }
  });
}

await initializeAuth();
if (!state.auth.required || state.auth.user) await refreshProjects();
renderData();
