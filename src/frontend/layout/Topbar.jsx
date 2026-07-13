import { Menu, RefreshCw } from "lucide-react";

export function Topbar({ app, onMenu }) {
  return (
    <header className="topbar">
      <button className="icon-button topbar__menu" type="button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="topbar__brand"><span className="brand-mark brand-mark--small">CF</span><strong>ContentFlow AI</strong></div>
      <div className="topbar__actions">
        <span className="status-pill"><i />{app.status}</span>
        <button className="icon-button" type="button" onClick={app.refresh} title="Refresh workspace" aria-label="Refresh workspace"><RefreshCw size={17} /></button>
      </div>
    </header>
  );
}
