import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Clapperboard, FolderKanban, Sparkles, UserRound, Workflow } from "lucide-react";
import { getProjectPath } from "../routing/routes.js";
import { VideoCard } from "../components/VideoCard.jsx";

export function StudioPage({ app }) {
  const navigate = useNavigate();
  const recentProjects = app.projects.slice(0, 6);
  const recentMedia = app.mediaItems.slice(0, 6);

  return (
    <div className="studio-page">
      <header className="page-heading page-heading--studio">
        <div>
          <p className="eyebrow">Creator Studio</p>
          <h1>Create content</h1>
          <p>Turn proven references and long-form videos into campaign-ready social content.</p>
        </div>
      </header>

      <section className="tool-hero-grid" aria-label="Production tools">
        <button className="tool-hero tool-hero--ugc" type="button" onClick={() => app.isAdmin ? app.openCreateProject?.("ai-generator") : navigate("/projects")}>
          <span className="tool-hero__tag"><Sparkles size={15} /> AI production</span>
          <span className="tool-hero__copy">
            <span><strong role="heading" aria-level="2">AI UGC Generator</strong><small>Replicate a winning content flow with your own product and character.</small></span>
            <ArrowRight aria-hidden="true" size={25} />
          </span>
        </button>
        <button className="tool-hero tool-hero--clipper" type="button" onClick={() => app.isAdmin ? app.openCreateProject?.("auto-clipper") : navigate("/projects")}>
          <span className="tool-hero__tag"><Clapperboard size={15} /> Remotion</span>
          <span className="tool-hero__copy">
            <span><strong role="heading" aria-level="2">Auto Clipper</strong><small>Find high-retention moments and render character reaction variations.</small></span>
            <ArrowRight aria-hidden="true" size={25} />
          </span>
        </button>
      </section>

      <section className="quick-tool-grid" aria-label="Workspace shortcuts">
        <Link to="/projects" className="quick-tool"><span className="quick-tool__icon"><FolderKanban size={20} /></span><span><strong>Projects</strong><small>Manage all production workspaces</small></span><ArrowRight size={16} /></Link>
        <Link to="/media" className="quick-tool"><span className="quick-tool__icon quick-tool__icon--violet"><UserRound size={20} /></span><span><strong>Characters & media</strong><small>Review reusable assets and outputs</small></span><ArrowRight size={16} /></Link>
        <Link to={app.isAdmin ? "/manage/jobs" : "/projects"} className="quick-tool"><span className="quick-tool__icon quick-tool__icon--blue"><Workflow size={20} /></span><span><strong>Production queue</strong><small>Track local and hosted jobs</small></span><ArrowRight size={16} /></Link>
      </section>

      <section className="studio-section">
        <div className="section-heading"><div><p className="eyebrow">Continue working</p><h2>Recent projects</h2></div><Link to="/projects">View all <ArrowRight size={15} /></Link></div>
        <div className="project-tile-grid">
          {recentProjects.map((project) => (
            <Link key={project.name} to={getProjectPath(project)} className="project-tile">
              <span className={`project-tile__icon project-tile__icon--${project.type === "auto-clipper" ? "clipper" : "ugc"}`}>{project.type === "auto-clipper" ? <Clapperboard size={22} /> : <Sparkles size={22} />}</span>
              <span><strong>{project.name}</strong><small>{project.type === "auto-clipper" ? "Auto Clipper" : "AI Generator"} · {project.renderCount || 0} outputs</small></span>
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          ))}
          {!recentProjects.length && <button className="empty-tile" type="button" onClick={() => app.isAdmin ? app.openCreateProject?.() : navigate("/projects")}>{app.isAdmin ? "Create your first production project" : "No assigned projects yet"}</button>}
        </div>
      </section>

      {recentMedia.length > 0 && (
        <section className="studio-section">
          <div className="section-heading"><div><p className="eyebrow">Latest exports</p><h2>Recent outputs</h2></div><Link to="/media">Open library <ArrowRight size={15} /></Link></div>
          <div className="media-grid media-grid--studio">{recentMedia.map((item) => <VideoCard key={`${item.project}-${item.name}-${item.url}`} item={item} />)}</div>
        </section>
      )}
    </div>
  );
}
