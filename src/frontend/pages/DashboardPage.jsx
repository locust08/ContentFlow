import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock3, FolderKanban, PlaySquare } from "lucide-react";
import { Card } from "../components/Card.jsx";
import { MetricCard } from "../components/MetricCard.jsx";
import { ActivityFeed } from "../components/ActivityFeed.jsx";

const workflow = ["Create client", "Create campaign", "Assign project", "Produce content", "Review output"];

export function DashboardPage({ app }) {
  const projects = app.projects || [];
  const readyForReview = projects.filter((project) => project.approvalStatus === "in-review").length;
  const pendingApprovals = projects.filter((project) => ["in-review", "changes-requested"].includes(project.approvalStatus)).length;

  return (
    <div className="page-stack dashboard-page">
      <header className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">Digital Bee production OS</p>
          <h1>Production overview</h1>
          <p>Welcome back, {app.auth?.user?.name || "Admin"}. Here is what needs attention across the studio.</p>
        </div>
        <Link className="btn btn--primary" to="/studio">Open Studio <ArrowRight size={16} /></Link>
      </header>

      <section className="metric-grid" aria-label="Production metrics">
        <MetricCard icon={FolderKanban} label="Active Projects" value={projects.length} caption="Live production workspaces" />
        <MetricCard icon={PlaySquare} label="Rendered Media" value={(app.mediaItems || []).length} caption="Final outputs and clip exports" />
        <MetricCard icon={CheckCircle2} label="Ready For Review" value={readyForReview} caption="Waiting for a reviewer decision" />
        <MetricCard icon={Clock3} label="Pending Approvals" value={pendingApprovals} caption="Review or revision in progress" />
      </section>

      <section className="dashboard-grid dashboard-grid--primary">
        <Card eyebrow="Workflow" title="Client brief to approved media" className="workflow-card">
          <ol className="flow-steps" aria-label="Client brief workflow">
            {workflow.map((step, index) => (
              <li className={index < 3 ? "complete" : index === 3 ? "current" : ""} key={step}>
                <span>{index < 3 ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
          <div className="workflow-current"><span><i /> Current step</span><strong>Produce content</strong><small>Assets, generation jobs, and renders are in progress.</small><Link to="/studio">Go to Studio <ArrowRight size={14} /></Link></div>
        </Card>

        <Card eyebrow="Role access" title="Separated dashboards" className="role-access-card">
          <div className="role-cards">
            <article><span className="role-avatar">AD</span><div><strong>Admin</strong><small>Clients, campaigns, projects, team, analytics</small></div></article>
            <article><span className="role-avatar">ST</span><div><strong>Staff</strong><small>Assigned production work and deliverables</small></div></article>
            <article><span className="role-avatar">CL</span><div><strong>Client</strong><small>Media review, approvals, campaign reporting</small></div></article>
          </div>
        </Card>
      </section>

      <Card eyebrow="Recent activity" title="What changed in production" action={<Link className="text-link" to="/manage/jobs">View jobs <ArrowRight size={14} /></Link>} className="activity-card">
        <ActivityFeed items={app.activityItems || []} />
      </Card>
    </div>
  );
}
