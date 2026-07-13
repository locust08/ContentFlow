import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Command, Menu, Search, Sun } from "lucide-react";

export function Topbar({ app, onMenu }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const name = app.auth.user?.name || "Admin";
  const firstName = name.split(/\s+/)[0];
  const initial = firstName.slice(0, 2).toUpperCase();
  const jobs = app.productionJobs || [];
  const activeJobs = jobs.filter((job) => ["queued", "processing"].includes(job.status)).length;

  function submitSearch(event) {
    event.preventDefault();
    const search = query.trim();
    navigate(search ? `/projects?search=${encodeURIComponent(search)}` : "/projects");
  }

  return (
    <header className="topbar">
      <button className="icon-button topbar__menu" type="button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="topbar__brand"><img className="brand-symbol brand-symbol--small" src="/assets/brand/contentflow-bee.png" alt="" /><strong>ContentFlow AI</strong></div>
      <div className="topbar__greeting"><Sun size={17} aria-hidden="true" /><span>Good morning, {firstName}</span></div>
      <form className="topbar-search" role="search" onSubmit={submitSearch}>
        <Search size={17} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, media, and more..." aria-label="Search projects, media, and more" />
        <kbd><Command size={12} /> K</kbd>
      </form>
      <div className="topbar__actions">
        <span className="status-pill"><i />{app.status}</span>
        <div className="notification-menu">
          <button className="icon-button" type="button" onClick={() => setNotificationsOpen((open) => !open)} title="Notifications" aria-label="Notifications"><Bell size={17} />{activeJobs > 0 && <span className="notification-dot" />}</button>
          {notificationsOpen && <div className="notification-popover" role="status"><strong>Production queue</strong><span>{activeJobs ? `${activeJobs} active job${activeJobs === 1 ? "" : "s"}` : "No jobs need attention"}</span><button type="button" onClick={() => navigate(app.isAdmin ? "/manage/jobs" : "/projects")}>View queue</button></div>}
        </div>
        <button className="avatar-button" type="button" onClick={() => navigate(app.isClient ? "/media" : "/studio")} aria-label="Open profile" title={name}>{initial}</button>
      </div>
    </header>
  );
}
