import { Card } from "../components/Card.jsx";
import { MetricCard } from "../components/MetricCard.jsx";

export function DashboardPage({ app }) {
  return (
    <div className="page-stack">
      <section className="metric-grid">
        <MetricCard label="Active Projects" value={app.projects.length} caption="Live production workspaces" />
        <MetricCard label="Rendered Media" value={app.mediaItems.length} caption="Final outputs and clip exports" />
        <MetricCard label="Ready For Review" value={app.reviewItems.length} caption="Submitted or reviewed projects" />
        <MetricCard label="AI / Clipper" value={`${app.aiProjects.length} / ${app.clipperProjects.length}`} caption="Generator vs clipping workload" />
      </section>

      <section className="dashboard-grid">
        <Card eyebrow="Workflow" title="Client brief to approved media">
          <div className="flow-steps">
            <span>Create client</span>
            <span>Create campaign</span>
            <span>Assign project</span>
            <span>Produce content</span>
            <span>Review output</span>
          </div>
        </Card>

        <Card eyebrow="Role access" title="Separated dashboards">
          <div className="role-cards">
            <article><strong>Admin</strong><span>Clients, campaigns, projects, team, analytics</span></article>
            <article><strong>Staff</strong><span>Assigned production work and outputs</span></article>
            <article><strong>Client</strong><span>Media library, approvals, campaign reporting</span></article>
          </div>
        </Card>
      </section>
    </div>
  );
}
