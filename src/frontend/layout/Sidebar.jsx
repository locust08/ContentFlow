import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BarChart3,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clapperboard,
  Files,
  FolderKanban,
  Gauge,
  LogOut,
  Megaphone,
  Plus,
  Settings,
  Sparkles,
  UsersRound,
  Workflow
} from "lucide-react";

const creatorItems = [
  { to: "/studio", label: "Studio", icon: Sparkles },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/media", label: "Media", icon: Clapperboard },
  { to: "/approvals", label: "Approvals", icon: Files },
  { to: "/analytics", label: "Analytics", icon: BarChart3 }
];

const clientItems = creatorItems.filter((item) => ["/media", "/approvals", "/analytics"].includes(item.to));

const manageItems = [
  { to: "/manage/clients", label: "Clients", icon: BriefcaseBusiness },
  { to: "/manage/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/manage/team", label: "Team", icon: UsersRound },
  { to: "/manage/jobs", label: "Production Jobs", icon: Workflow },
  { to: "/manage/settings", label: "Settings", icon: Settings }
];

function NavigationLink({ item }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
      <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar({ app }) {
  const [manageOpen, setManageOpen] = useState(false);
  const primaryItems = app.isClient ? clientItems : creatorItems;

  return (
    <aside className="app-sidebar">
      <NavLink className="brand-lockup" to={app.isClient ? "/media" : "/studio"} aria-label="ContentFlow AI home">
        <span className="brand-mark">CF</span>
        <span className="brand-copy">
          <strong>ContentFlow AI</strong>
          <small>Digital Bee production OS</small>
        </span>
      </NavLink>

      {app.isAdmin && (
        <button className="create-button" type="button" onClick={app.openCreateProject}>
          <Plus aria-hidden="true" size={18} />
          <span>Create</span>
        </button>
      )}

      <nav className="nav-list" aria-label="Main workspace">
        {app.isAdmin && <NavigationLink item={{ to: "/dashboard", label: "Dashboard", icon: Gauge }} />}
        {primaryItems.map((item) => <NavigationLink key={item.to} item={item} />)}
      </nav>

      {app.isAdmin && (
        <section className="manage-nav">
          <button className="manage-toggle" type="button" onClick={() => setManageOpen((open) => !open)} aria-expanded={manageOpen}>
            <span>Manage</span>
            {manageOpen ? <ChevronDown aria-hidden="true" size={16} /> : <ChevronRight aria-hidden="true" size={16} />}
          </button>
          {manageOpen && <nav className="nav-list nav-list--nested" aria-label="Administration">{manageItems.map((item) => <NavigationLink key={item.to} item={item} />)}</nav>}
        </section>
      )}

      <div className="sidebar-spacer" />
      <div className="sidebar-user">
        <CircleUserRound aria-hidden="true" size={24} />
        <span><strong>{app.auth.user?.name || "Local demo"}</strong><small>{app.auth.user?.role || app.role}</small></span>
        <button className="icon-button" type="button" onClick={app.logout} title="Logout" aria-label="Logout">
          <LogOut aria-hidden="true" size={17} />
        </button>
      </div>
    </aside>
  );
}
