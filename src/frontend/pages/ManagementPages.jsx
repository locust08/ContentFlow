import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, ChevronDown, CirclePlus, Database, Folder, FolderPlus, MoreHorizontal,
  Pencil, Search, ShieldCheck, Trash2, UploadCloud, X
} from "lucide-react";
import { Badge } from "../components/Badge.jsx";
import { Button } from "../components/Button.jsx";
import { Card } from "../components/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { MetricCard } from "../components/MetricCard.jsx";
import { VideoCard } from "../components/VideoCard.jsx";
import { getProjectPath } from "../routing/routes.js";

const typeLabel = (type) => type === "auto-clipper" ? "Auto Clipper" : "AI Generator";
const byId = (items, id, fallback) => items.find((item) => item.id === id)?.name || fallback;

function PageHeading({ eyebrow, title, copy, action }) {
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{action}</header>;
}

function SearchField({ value, onChange, placeholder = "Search" }) {
  return <label className="search-field"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function ConfirmDialog({ title, body, confirmLabel = "Delete", onCancel, onConfirm }) {
  return <div className="modal-backdrop"><section className="modal confirm-modal" role="alertdialog" aria-modal="true"><header className="modal__header"><div><p className="eyebrow">Confirm action</p><h2>{title}</h2></div><button className="icon-button" onClick={onCancel} aria-label="Close"><X size={18} /></button></header><p>{body}</p><footer className="modal__footer"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="danger" onClick={onConfirm}><Trash2 size={16} /> {confirmLabel}</Button></footer></section></div>;
}

export function ProjectsPage({ app }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [deleteTarget, setDeleteTarget] = useState("");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState(null);
  const [editingFolder, setEditingFolder] = useState(null);
  const [editingName, setEditingName] = useState("");
  const projects = useMemo(() => app.projects.filter((project) => (!folderId || project.folderId === folderId) && (!query || project.name.toLowerCase().includes(query.toLowerCase()))), [app.projects, folderId, query]);

  async function addFolder(event) {
    event.preventDefault();
    if (!newFolder.trim()) return;
    await app.createFolder(newFolder.trim());
    setNewFolder("");
  }

  return <div className="page-stack">
    <PageHeading eyebrow="Workspace" title="Projects" copy="Organize every production workspace, owner, campaign, and output." action={app.isAdmin && <Button onClick={() => app.openCreateProject()}><CirclePlus size={17} /> New project</Button>} />
    <section className="project-browser">
      <aside className="folder-panel">
        <div className="folder-panel__head"><span><Folder size={17} /> Folders</span></div>
        <button className={!folderId ? "active" : ""} onClick={() => setFolderId("")}>All projects <small>{app.projects.length}</small></button>
        {app.folders.map((folder) => editingFolder === folder.id ? <form key={folder.id} className="folder-edit-form" onSubmit={async (event) => { event.preventDefault(); if (!editingName.trim()) return; await app.renameFolder(folder.id, editingName.trim()); setEditingFolder(null); }}><input aria-label={`Rename ${folder.name}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} /><button aria-label="Save folder name"><Check size={14} /></button><button type="button" aria-label="Cancel rename" onClick={() => setEditingFolder(null)}><X size={14} /></button></form> : <div className="folder-row" key={folder.id}><button className={folderId === folder.id ? "active" : ""} onClick={() => setFolderId(folder.id)}><span>{folder.name}</span><small>{app.projects.filter((project) => project.folderId === folder.id).length}</small></button><span className="folder-row__actions"><button aria-label={`Rename ${folder.name}`} title="Rename folder" onClick={() => { setEditingFolder(folder.id); setEditingName(folder.name); }}><Pencil size={13} /></button><button aria-label={`Delete folder ${folder.name}`} title="Delete folder" onClick={() => setDeleteFolderTarget(folder)}><Trash2 size={13} /></button></span></div>)}
        {app.isAdmin && <form className="new-folder-form" onSubmit={addFolder}><input aria-label="Folder name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="New folder" /><button aria-label="Create folder" disabled={!newFolder.trim()}><FolderPlus size={16} /></button></form>}
      </aside>
      <Card className="project-table-panel" action={<SearchField value={query} onChange={setQuery} placeholder="Search projects" />}>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Project</th><th>Client / campaign</th><th>Owner</th><th>Status</th><th>Folder</th><th aria-label="Actions" /></tr></thead><tbody>
          {projects.map((project) => <tr key={project.name}>
            <td><button className="project-name-button" onClick={() => navigate(getProjectPath(project))}><span className={`type-dot type-dot--${project.type === "auto-clipper" ? "clipper" : "ai"}`} /><span><strong>{project.name}</strong><small>{typeLabel(project.type)}</small></span></button></td>
            <td><strong>{byId(app.organization.clients, project.clientId, "No client")}</strong><small>{byId(app.organization.campaigns, project.campaignId, "No campaign")}</small></td>
            <td>{byId(app.organization.staff, project.assignedStaffId, "Unassigned")}</td>
            <td><Badge tone={project.approvalStatus || "queued"}>{project.approvalStatus || "draft"}</Badge></td>
            <td>{app.isAdmin ? <select aria-label={`Move ${project.name} to folder`} value={project.folderId || ""} onChange={(event) => app.updateProjectMeta(project.name, { folderId: event.target.value })}><option value="">All projects</option>{app.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select> : byId(app.folders, project.folderId, "Unfiled")}</td>
            <td>{app.isAdmin && <button className="icon-button icon-button--danger" onClick={() => setDeleteTarget(project.name)} aria-label={`Delete ${project.name}`} title="Delete project"><Trash2 size={16} /></button>}</td>
          </tr>)}
        </tbody></table>{!projects.length && <EmptyState>No projects match this view.</EmptyState>}</div>
      </Card>
    </section>
    {deleteTarget && <ConfirmDialog title={`Delete ${deleteTarget}?`} body="The project folder and its local production records will be removed. This cannot be undone." onCancel={() => setDeleteTarget("")} onConfirm={async () => { await app.deleteProject(deleteTarget); setDeleteTarget(""); }} />}
    {deleteFolderTarget && <ConfirmDialog title={`Delete folder ${deleteFolderTarget.name}?`} body="Projects inside it will remain available under All projects." onCancel={() => setDeleteFolderTarget(null)} onConfirm={async () => { await app.deleteFolder(deleteFolderTarget.id); if (folderId === deleteFolderTarget.id) setFolderId(""); setDeleteFolderTarget(null); }} />}
  </div>;
}

function CreateClientForm({ app, onDone }) {
  const [name, setName] = useState(""); const [industry, setIndustry] = useState("");
  return <form className="drawer-form" onSubmit={async (event) => { event.preventDefault(); if (!name.trim()) return; await app.createClient({ name: name.trim(), industry: industry.trim() }); onDone(); }}><label>Client name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label><label>Industry<input value={industry} onChange={(e) => setIndustry(e.target.value)} /></label><footer><Button variant="secondary" type="button" onClick={onDone}>Cancel</Button><Button>Add client</Button></footer></form>;
}

function CreateCampaignForm({ app, onDone }) {
  const [clientId, setClientId] = useState(""); const [name, setName] = useState(""); const [objective, setObjective] = useState("");
  return <form className="drawer-form" onSubmit={async (event) => { event.preventDefault(); if (!clientId || !name.trim()) return; await app.createCampaign({ clientId, name: name.trim(), objective: objective.trim() }); onDone(); }}><label>Client<select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Select client</option>{app.organization.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label>Campaign name<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>Objective<textarea value={objective} onChange={(e) => setObjective(e.target.value)} /></label><footer><Button variant="secondary" type="button" onClick={onDone}>Cancel</Button><Button>Add campaign</Button></footer></form>;
}

function SideDrawer({ title, onClose, children }) { return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="side-drawer" role="dialog" aria-modal="true"><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>{children}</aside></div>; }

export function ClientsPage({ app }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const clients = app.organization.clients.filter((client) => !query || client.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="page-stack"><PageHeading eyebrow="Manage" title="Clients" copy="Client accounts and their connected production work." action={<Button onClick={() => setOpen(true)}><CirclePlus size={17} /> Add client</Button>} /><Card action={<SearchField value={query} onChange={setQuery} placeholder="Search clients" />}><div className="data-list">{clients.map((client) => <article key={client.id} className="data-row"><div><p className="eyebrow">{client.industry || "Client"}</p><h3>{client.name}</h3><span>{app.projects.filter((project) => project.clientId === client.id).length} projects · {app.organization.campaigns.filter((campaign) => campaign.clientId === client.id).length} campaigns</span></div><Badge tone="approved">active</Badge></article>)}</div></Card>{open && <SideDrawer title="Add client" onClose={() => setOpen(false)}><CreateClientForm app={app} onDone={() => setOpen(false)} /></SideDrawer>}</div>;
}

export function CampaignsPage({ app }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const campaigns = app.organization.campaigns.filter((item) => !query || item.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="page-stack"><PageHeading eyebrow="Manage" title="Campaigns" copy="Connect client objectives to active production projects." action={<Button onClick={() => setOpen(true)}><CirclePlus size={17} /> Add campaign</Button>} /><Card action={<SearchField value={query} onChange={setQuery} placeholder="Search campaigns" />}><div className="data-list">{campaigns.map((campaign) => <article key={campaign.id} className="data-row"><div><p className="eyebrow">{byId(app.organization.clients, campaign.clientId, "No client")}</p><h3>{campaign.name}</h3><span>{campaign.objective || "No objective"} · {app.projects.filter((project) => project.campaignId === campaign.id).length} projects</span></div><Badge tone="queued">campaign</Badge></article>)}</div></Card>{open && <SideDrawer title="Add campaign" onClose={() => setOpen(false)}><CreateCampaignForm app={app} onDone={() => setOpen(false)} /></SideDrawer>}</div>;
}

export function TeamPage({ app }) { return <div className="page-stack"><PageHeading eyebrow="Manage" title="Team" copy="Staff, editors, administrators, and client reviewers." /><Card><div className="data-list">{app.organization.staff.map((person) => <article key={person.id} className="data-row"><div><p className="eyebrow">{person.role}</p><h3>{person.name}</h3><span>{person.email || "No email"}</span></div><Badge tone={person.role === "manager-client" ? "queued" : "approved"}>{person.role === "manager-client" ? "reviewer" : "internal"}</Badge></article>)}</div></Card></div>; }

export function MediaPage({ app }) {
  const [query, setQuery] = useState(""); const [project, setProject] = useState("");
  const items = app.mediaItems.filter((item) => (!project || item.project === project) && (!query || `${item.name} ${item.project}`.toLowerCase().includes(query.toLowerCase())));
  return <div className="page-stack"><PageHeading eyebrow="Library" title="Media" copy="Final campaign outputs ready for playback, review, and approval." /><div className="filter-bar"><SearchField value={query} onChange={setQuery} placeholder="Search media" /><select value={project} onChange={(event) => setProject(event.target.value)}><option value="">All projects</option>{app.projects.map((item) => <option key={item.name}>{item.name}</option>)}</select></div><div className="media-grid media-grid--library">{items.length ? items.map((item) => <VideoCard key={`${item.project}-${item.name}-${item.url}`} item={item} />) : <EmptyState>Rendered media will appear here.</EmptyState>}</div></div>;
}

export function ApprovalsPage({ app }) {
  const [feedback, setFeedback] = useState({});
  async function review(project, approvalStatus) { await app.updateProjectMeta(project.name, { approvalStatus, approvalFeedback: feedback[project.name] || project.approvalFeedback || "", reviewedAt: new Date().toISOString() }); }
  return <div className="page-stack"><PageHeading eyebrow="Review" title="Approvals" copy="Keep client decisions and revision notes attached to each project." /><div className="approval-grid">{app.reviewItems.length ? app.reviewItems.map((project) => <Card key={project.name} eyebrow={byId(app.organization.clients, project.clientId, "No client")} title={project.name} action={<Badge tone={project.approvalStatus}>{project.approvalStatus}</Badge>}><textarea aria-label={`Feedback for ${project.name}`} value={feedback[project.name] ?? project.approvalFeedback ?? ""} onChange={(event) => setFeedback((current) => ({ ...current, [project.name]: event.target.value }))} placeholder="Review feedback" /><div className="inline-actions"><Button variant="secondary" onClick={() => review(project, "changes-requested")}>Request changes</Button><Button onClick={() => review(project, "approved")}><Check size={16} /> Approve</Button></div></Card>) : <EmptyState>No project has been submitted for review yet.</EmptyState>}</div></div>;
}

export function AnalyticsPage({ app }) {
  const approval = app.analytics?.approval_breakdown || {};
  const typeStats = app.analytics?.projects_by_type || { "ai-generator": app.aiProjects.length, "auto-clipper": app.clipperProjects.length };
  return <div className="page-stack"><PageHeading eyebrow="Reporting" title="Analytics" copy="Production performance and campaign delivery from Supabase records." /><section className="metric-grid"><MetricCard label="Total projects" value={app.projects.length} caption="Managed workspaces" /><MetricCard label="Final media" value={app.mediaItems.length} caption="Delivered outputs" /><MetricCard label="Clip candidates" value={app.analytics?.clip_candidates || 0} caption="Detected moments" /><MetricCard label="Approved" value={approval.approved || 0} caption="Client-approved projects" /></section><section className="analytics-dashboard"><Card eyebrow="Production mix" title="Projects by workflow"><div className="horizontal-chart"><span><i style={{ width: `${Math.max(8, Number(typeStats["ai-generator"] || 0) * 12)}%` }} />AI Generator <strong>{typeStats["ai-generator"] || 0}</strong></span><span><i className="purple" style={{ width: `${Math.max(8, Number(typeStats["auto-clipper"] || 0) * 12)}%` }} />Auto Clipper <strong>{typeStats["auto-clipper"] || 0}</strong></span></div></Card><Card eyebrow="Approval health" title="Review status"><div className="donut-summary"><div className="donut" /><ul><li><i className="approved" /> Approved <strong>{approval.approved || 0}</strong></li><li><i className="review" /> In review <strong>{approval["in-review"] || 0}</strong></li><li><i className="changes" /> Changes <strong>{approval["changes-requested"] || 0}</strong></li></ul></div></Card></section></div>;
}

export function JobsPage({ app }) { return <div className="page-stack"><PageHeading eyebrow="Production engine" title="Job queue" copy="Hosted requests waiting for the local production worker." /><Card><div className="data-list">{app.productionJobs.length ? app.productionJobs.map((job) => <article key={job.id || `${job.jobType}-${job.createdAt}`} className="data-row"><div><p className="eyebrow">{job.status || "queued"}</p><h3>{job.jobType || "production-job"}</h3><span>{job.projectName || "Project"} · {job.createdAt ? new Date(job.createdAt).toLocaleString() : "Created locally"}</span></div><Badge tone={job.status || "queued"}>{job.status || "queued"}</Badge></article>) : <EmptyState>No hosted production jobs are waiting.</EmptyState>}</div></Card></div>; }

export function SettingsPage({ app }) {
  const status = app.supabase || {};
  return <div className="page-stack"><PageHeading eyebrow="System" title="Settings" copy="Database connectivity, local synchronization, and production health." /><section className="settings-grid"><article className={status.configured ? "ready" : ""}><Database size={20} /><strong>Configuration</strong><span>{status.configured ? "Environment keys found" : "Missing Supabase keys"}</span></article><article className={status.connected ? "ready" : ""}><UploadCloud size={20} /><strong>Connection</strong><span>{status.connected ? "Database connected" : "Not connected"}</span></article><article className={status.schemaReady ? "ready" : ""}><ShieldCheck size={20} /><strong>Schema</strong><span>{status.schemaReady ? "Schema ready" : "Needs initialization"}</span></article></section><Card eyebrow="Database tools" title="Supabase synchronization"><div className="inline-actions"><Button variant="secondary" disabled={!status.configured} onClick={app.initializeSupabase}>Initialize schema</Button><Button disabled={!status.connected} onClick={app.syncSupabase}>Sync local records</Button></div></Card></div>;
}
