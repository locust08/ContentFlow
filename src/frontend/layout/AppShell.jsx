import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar.jsx";
import { Topbar } from "./Topbar.jsx";

export function AppShell({ app, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  return (
    <main className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar app={app} />
      <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
      <section className="app-main">
        <Topbar app={app} onMenu={() => setSidebarOpen((open) => !open)} />
        <div className="page-frame">{children}</div>
      </section>
    </main>
  );
}
