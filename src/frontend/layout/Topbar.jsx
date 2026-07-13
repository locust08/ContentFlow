import { Button } from "../components/Button.jsx";

const titleMap = {
  dashboard: ["Dashboard", "A clean command center for production health and role-based work."],
  projects: ["Projects", "Manage AI Generator and Auto Clipper workspaces."],
  clients: ["Clients", "Register and organize client accounts."],
  campaigns: ["Campaigns", "Group projects by campaign objective and client."],
  team: ["Team", "Review internal staff and client reviewer roles."],
  media: ["Media Library", "Final outputs ready for review and campaign use."],
  approvals: ["Approvals", "Track submitted work, feedback, and approval status."],
  analytics: ["Analytics", "Production stats for FYP evaluation and business reporting."],
  jobs: ["Production Jobs", "Hosted queue for the local production worker."],
  settings: ["Settings", "Supabase and local synchronization controls."],
  ai: ["AI Generator", "Replicate a proven UGC reference into a new product video."],
  clipper: ["Auto Clipper", "Find highlight moments and render reaction clips."]
};

export function Topbar({ app }) {
  const [title, subtitle] = titleMap[app.activeView] || titleMap.dashboard;
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Digital Bee workflow OS</p>
        <h2>{app.activeProject && ["ai", "clipper"].includes(app.activeView) ? app.activeProject : title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="topbar__actions">
        <span className="status-pill">{app.status}</span>
        <Button variant="secondary" onClick={app.refresh}>Refresh</Button>
      </div>
    </header>
  );
}
