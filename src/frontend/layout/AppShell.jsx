import { Sidebar } from "./Sidebar.jsx";
import { Topbar } from "./Topbar.jsx";

export function AppShell({ app, children }) {
  return (
    <main className="app-shell">
      <Sidebar app={app} />
      <section className="app-main">
        <Topbar app={app} />
        {children}
      </section>
    </main>
  );
}
