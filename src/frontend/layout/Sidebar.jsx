import { Button } from "../components/Button.jsx";

const navItems = [
  ["dashboard", "Dashboard"],
  ["projects", "Projects"],
  ["clients", "Clients"],
  ["campaigns", "Campaigns"],
  ["team", "Team"],
  ["media", "Media Library"],
  ["approvals", "Approvals"],
  ["analytics", "Analytics"],
  ["jobs", "Production Jobs"],
  ["settings", "Settings"]
];

export function Sidebar({ app }) {
  const visibleItems = navItems.filter(([view]) => {
    if (app.isClient) return ["dashboard", "media", "approvals", "analytics"].includes(view);
    if (!app.isAdmin) return !["clients", "campaigns", "team", "settings"].includes(view);
    return true;
  });

  return (
    <aside className="app-sidebar">
      <div className="brand-lockup">
        <span className="brand-mark">CF</span>
        <div>
          <h1>ContentFlow AI</h1>
          <p>Digital Bee production OS</p>
        </div>
      </div>

      <div className="user-card">
        <span>{app.auth.user?.name || "Local demo"}</span>
        <small>{app.auth.user?.role || app.role}</small>
        <Button variant="ghost" onClick={app.logout}>Logout</Button>
      </div>

      <nav className="nav-list" aria-label="Main workspace">
        {visibleItems.map(([view, label]) => (
          <button
            key={view}
            className={app.activeView === view ? "active" : ""}
            type="button"
            onClick={() => app.showView(view)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!app.isClient && (
        <div className="quick-projects">
          <p className="eyebrow">Recent projects</p>
          {app.projects.slice(0, 8).map((project) => (
            <button
              key={project.name}
              className={project.name === app.activeProject ? "active" : ""}
              type="button"
              onClick={() => app.selectProject(project.name)}
            >
              <strong>{project.name}</strong>
              <span>{project.type === "auto-clipper" ? "Auto Clipper" : "AI Generator"} · {project.renderCount || 0} renders</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
