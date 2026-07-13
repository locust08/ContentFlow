import { useState } from "react";
import { Badge } from "../components/Badge.jsx";
import { Button } from "../components/Button.jsx";
import { Card } from "../components/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { VideoCard } from "../components/VideoCard.jsx";

const typeLabel = (type) => type === "auto-clipper" ? "Auto Clipper" : "AI Generator";
const byId = (items, id, fallback) => items.find((item) => item.id === id)?.name || fallback;

function ProjectForm({ app }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("ai-generator");
  const [clientId, setClientId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [reviewerId, setReviewerId] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    await app.createProject({ name: name.trim(), type, clientId, campaignId, assignedStaffId, reviewerId, priority: "normal" });
    setName("");
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="new-project-name" />
      <select value={type} onChange={(event) => setType(event.target.value)}>
        <option value="ai-generator">AI Generator</option>
        <option value="auto-clipper">Auto Clipper</option>
      </select>
      <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
        <option value="">Select client</option>
        {app.organization.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
      <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
        <option value="">Select campaign</option>
        {app.organization.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
      </select>
      <select value={assignedStaffId} onChange={(event) => setAssignedStaffId(event.target.value)}>
        <option value="">Assign staff/editor</option>
        {app.organization.staff.filter((person) => person.role !== "manager-client").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
      <select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}>
        <option value="">Reviewer/client</option>
        {app.organization.staff.filter((person) => person.role !== "staff-editor").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
      <Button type="submit">Create Project</Button>
    </form>
  );
}

export function ProjectsPage({ app }) {
  return (
    <div className="page-stack">
      {app.isAdmin && <Card eyebrow="Create" title="New production workspace"><ProjectForm app={app} /></Card>}
      <Card eyebrow="Projects" title="All workspaces">
        <div className="data-list">
          {app.projects.length ? app.projects.map((project) => (
            <article key={project.name} className="data-row">
              <div>
                <p className="eyebrow">{typeLabel(project.type)} · {project.approvalStatus || "draft"}</p>
                <h3>{project.name}</h3>
                <span>{byId(app.organization.clients, project.clientId, "No client")} · {byId(app.organization.campaigns, project.campaignId, "No campaign")}</span>
              </div>
              <div className="row-actions">
                <Badge tone={project.hasUgcVideo || project.hasClipperRender ? "approved" : "queued"}>{project.renderCount || 0} renders</Badge>
                <Button variant="secondary" onClick={() => app.selectProject(project.name)}>Open</Button>
              </div>
            </article>
          )) : <EmptyState>Create a project to begin production.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}

export function ClientsPage({ app }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    await app.createClient({ name: name.trim(), industry: industry.trim() });
    setName("");
    setIndustry("");
  }
  return (
    <div className="page-stack">
      {app.isAdmin && (
        <Card eyebrow="Create" title="New client">
          <form className="form-grid form-grid--compact" onSubmit={submit}>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Client name" />
            <input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="Industry" />
            <Button type="submit">Add Client</Button>
          </form>
        </Card>
      )}
      <Card eyebrow="Clients" title="Client accounts">
        <div className="data-list">
          {app.organization.clients.map((client) => (
            <article key={client.id} className="data-row">
              <div><p className="eyebrow">{client.industry || "Client"}</p><h3>{client.name}</h3><span>{app.projects.filter((project) => project.clientId === client.id).length} projects</span></div>
              <Badge tone="approved">active</Badge>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function CampaignsPage({ app }) {
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!clientId || !name.trim()) return;
    await app.createCampaign({ clientId, name: name.trim(), objective: objective.trim() });
    setName("");
    setObjective("");
  }
  return (
    <div className="page-stack">
      {app.isAdmin && (
        <Card eyebrow="Create" title="New campaign">
          <form className="form-grid form-grid--compact" onSubmit={submit}>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">Select client</option>
              {app.organization.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Campaign name" />
            <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Objective" />
            <Button type="submit">Add Campaign</Button>
          </form>
        </Card>
      )}
      <Card eyebrow="Campaigns" title="Campaign management">
        <div className="data-list">
          {app.organization.campaigns.map((campaign) => (
            <article key={campaign.id} className="data-row">
              <div><p className="eyebrow">{byId(app.organization.clients, campaign.clientId, "No client")}</p><h3>{campaign.name}</h3><span>{campaign.objective || "No objective"} · {app.projects.filter((project) => project.campaignId === campaign.id).length} projects</span></div>
              <Badge tone="queued">campaign</Badge>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function TeamPage({ app }) {
  return (
    <Card eyebrow="Team" title="Staff and reviewer directory">
      <div className="data-list">
        {app.organization.staff.map((person) => (
          <article key={person.id} className="data-row">
            <div><p className="eyebrow">{person.role}</p><h3>{person.name}</h3><span>{person.email || "No email"}</span></div>
            <Badge tone={person.role === "manager-client" ? "queued" : "approved"}>{person.role === "manager-client" ? "reviewer" : "internal"}</Badge>
          </article>
        ))}
      </div>
    </Card>
  );
}

export function MediaPage({ app }) {
  return (
    <Card eyebrow="Media Library" title="Final outputs">
      <div className="media-grid">
        {app.mediaItems.length ? app.mediaItems.map((item) => <VideoCard key={`${item.project}-${item.name}-${item.url}`} item={item} />) : <EmptyState>Rendered media will appear here.</EmptyState>}
      </div>
    </Card>
  );
}

export function ApprovalsPage({ app }) {
  return (
    <Card eyebrow="Approvals" title="Review queue">
      <div className="data-list">
        {app.reviewItems.length ? app.reviewItems.map((project) => (
          <article key={project.name} className="data-row">
            <div><p className="eyebrow">{byId(app.organization.clients, project.clientId, "No client")}</p><h3>{project.name}</h3><span>{project.approvalFeedback || "No feedback yet"}</span></div>
            <Badge tone={project.approvalStatus}>{project.approvalStatus}</Badge>
          </article>
        )) : <EmptyState>No project has been submitted for review yet.</EmptyState>}
      </div>
    </Card>
  );
}

export function AnalyticsPage({ app }) {
  const approval = app.analytics?.approval_breakdown || {};
  return (
    <div className="analytics-layout">
      <MetricCard label="Clip Candidates" value={app.analytics?.clip_candidates || 0} caption="Detected highlight moments" />
      <MetricCard label="Approved" value={approval.approved || 0} caption="Approved projects" />
      <MetricCard label="In Review" value={approval["in-review"] || 0} caption="Waiting reviewer action" />
      <Card eyebrow="Analytics" title="Production breakdown">
        <div className="chart-bars">
          {[35, 58, 44, 72, 50, 86, 64].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
        </div>
      </Card>
    </div>
  );
}

export function JobsPage({ app }) {
  return (
    <Card eyebrow="Production Engine" title="Worker queue">
      <div className="data-list">
        {app.productionJobs.length ? app.productionJobs.map((job) => (
          <article key={job.id || `${job.jobType}-${job.createdAt}`} className="data-row">
            <div><p className="eyebrow">{job.status || "queued"}</p><h3>{job.jobType || "production-job"}</h3><span>{job.createdAt ? new Date(job.createdAt).toLocaleString() : "Created locally"}</span></div>
            <Badge tone={job.status || "queued"}>{job.status || "queued"}</Badge>
          </article>
        )) : <EmptyState>Hosted generation and render jobs will appear here.</EmptyState>}
      </div>
    </Card>
  );
}

export function SettingsPage({ app }) {
  const status = app.supabase || {};
  return (
    <Card eyebrow="Settings" title="Supabase backend">
      <div className="settings-grid">
        <article><strong>Configuration</strong><span>{status.configured ? "Environment keys found" : "Missing Supabase env keys"}</span></article>
        <article><strong>Connection</strong><span>{status.connected ? "Database connected" : "Not connected"}</span></article>
        <article><strong>Schema</strong><span>{status.schemaReady ? "Schema ready" : "Schema not initialized"}</span></article>
      </div>
    </Card>
  );
}
