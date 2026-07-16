import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight, Check, FileText, Lightbulb, Plus, ShieldCheck, Sparkles,
  Trash2, Upload
} from "lucide-react";
import { Badge } from "../components/Badge.jsx";
import { Button } from "../components/Button.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { getCampaignIntelligencePath, getProjectPath } from "../routing/routes.js";

const PILLAR_DEFINITIONS = [
  ["features", "Features"],
  ["benefits", "Benefits"],
  ["painPoints", "Pain points"],
  ["objections", "Objections"],
  ["failedSolutions", "Failed solutions"],
  ["triggerEvents", "Trigger events"],
  ["drivingEmotions", "Driving emotions"]
];

function reportPillars(report) {
  const raw = report?.pillars || report?.sections || {};
  return PILLAR_DEFINITIONS.map(([key, title], index) => {
    const value = Array.isArray(raw) ? raw[index] : raw[key] || raw[title] || [];
    const entries = Array.isArray(value) ? value : [typeof value === "string" ? { insight: value } : value];
    return { key, title, entries: entries.filter(Boolean) };
  });
}

function evidenceLabel(item) {
  if (typeof item === "string") return item;
  return item?.quote || item?.claim || item?.text || item?.sourceName || "Research evidence";
}

function intelligencePayload(app) {
  return app.intelligence?.active || app.intelligence?.campaign || null;
}

export function IntelligencePage({ app }) {
  const campaigns = app.intelligence?.campaigns || app.organization?.campaigns || [];
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadError("");
    app.loadIntelligence?.().catch((error) => {
      if (!active) return;
      setLoadError(error.message || "Market intelligence could not be loaded");
      app.setStatus?.("Intelligence unavailable");
    });
    return () => { active = false; };
  }, [app.loadIntelligence]);

  return (
    <div className="page-stack intelligence-index">
      <header className="page-heading intelligence-heading">
        <div><p className="eyebrow">Digital Bee research desk</p><h1>Market Intelligence</h1><p>Turn campaign evidence into an approved strategy foundation for script generation.</p></div>
        <span className="intelligence-heading__mark"><Lightbulb size={22} /><strong>{campaigns.length}</strong><small>campaign workspaces</small></span>
      </header>
      {loadError && <div className="app-alert" role="alert">{loadError}</div>}
      <section className="campaign-intelligence-grid" aria-label="Campaign intelligence workspaces">
        {campaigns.map((campaign) => (
          <Link className="campaign-intelligence-item" key={campaign.id || campaign.name} to={getCampaignIntelligencePath(campaign.id || campaign.name)}>
            <span className="campaign-intelligence-item__icon"><Sparkles size={20} /></span>
            <span><small>{campaign.clientName || campaign.client || "Campaign"}</small><strong>{campaign.name}</strong><em>{campaign.reportStatus || campaign.intelligence?.activeReport?.status || campaign.marketReport?.status || "Research not started"}</em></span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ))}
        {!campaigns.length && <EmptyState title="No campaigns yet">Create a campaign, then return here to begin research.</EmptyState>}
      </section>
    </div>
  );
}

function BriefEditor({ campaignId, brief = {}, onSave }) {
  const [draft, setDraft] = useState(brief);
  useEffect(() => setDraft(brief), [brief]);
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  return (
    <form className="intelligence-panel brief-editor" onSubmit={(event) => { event.preventDefault(); onSave(campaignId, draft); }}>
      <header><div><p className="eyebrow">Campaign brief</p><h2>Strategic direction</h2></div><Button type="submit" variant="secondary"><Check size={16} /> Save brief</Button></header>
      <div className="brief-grid">
        <label>Brand<input value={draft.brand || ""} onChange={(event) => update("brand", event.target.value)} /></label>
        <label>Product<input value={draft.product || ""} onChange={(event) => update("product", event.target.value)} /></label>
        <label>Objective<textarea value={draft.objective || ""} onChange={(event) => update("objective", event.target.value)} /></label>
        <label>Core audience<textarea value={draft.targetAudience || draft.audience || ""} onChange={(event) => update("targetAudience", event.target.value)} /></label>
        <label>Offer<input value={draft.offer || ""} onChange={(event) => update("offer", event.target.value)} /></label>
        <label>Brand voice<input value={draft.brandVoice || ""} onChange={(event) => update("brandVoice", event.target.value)} /></label>
        <label>Approved claims<textarea value={Array.isArray(draft.approvedClaims) ? draft.approvedClaims.join("\n") : draft.approvedClaims || ""} onChange={(event) => update("approvedClaims", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></label>
        <label>Restricted claims<textarea value={Array.isArray(draft.restrictedClaims) ? draft.restrictedClaims.join("\n") : draft.restrictedClaims || ""} onChange={(event) => update("restrictedClaims", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></label>
      </div>
    </form>
  );
}

function SourcesPanel({ campaignId, sources, selected, onSelected, app }) {
  const [source, setSource] = useState({ name: "", content: "" });
  const [mode, setMode] = useState("text");
  const toggle = (id) => onSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  async function submitText(event) {
    event.preventDefault();
    if (!source.name.trim() || !source.content.trim()) return;
    await app.addResearchText(campaignId, { name: source.name.trim(), content: source.content.trim() });
    setSource({ name: "", content: "" });
  }

  return (
    <section className="intelligence-panel sources-panel">
      <header><div><p className="eyebrow">Evidence library</p><h2>Research sources</h2></div><div className="segmented-control" role="group" aria-label="Source type"><button type="button" aria-pressed={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>Text</button><button type="button" aria-pressed={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>File</button></div></header>
      {mode === "text" ? (
        <form className="source-composer" onSubmit={submitText}>
          <label>Source name<input aria-label="Source name" value={source.name} onChange={(event) => setSource((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Customer interviews" /></label>
          <label>Source content<textarea aria-label="Source content" value={source.content} onChange={(event) => setSource((current) => ({ ...current, content: event.target.value }))} placeholder="Paste transcripts, comments, notes, or findings" /></label>
          <Button disabled={!source.name.trim() || !source.content.trim()}><Plus size={16} /> Add text source</Button>
        </form>
      ) : (
        <label className="research-file-picker"><Upload size={18} /><span><strong>Upload research file</strong><small>TXT, MD, or CSV</small></span><input type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" onChange={(event) => event.target.files[0] && app.uploadResearchSource(campaignId, event.target.files[0])} /></label>
      )}
      <div className="research-source-list">
        {sources.map((item) => (
          <article className={selected.includes(item.id) ? "selected" : ""} key={item.id}>
            <label><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`Select ${item.name}`} /><span><Check size={12} /></span></label>
            <span className="research-source-icon"><FileText size={17} /></span>
            <span><strong>{item.name}</strong><small>{item.type || "text"} · {item.evidenceCount || 0} evidence signals</small></span>
            <Badge tone={item.status === "ready" ? "approved" : "queued"}>{item.status || "ready"}</Badge>
            <button className="icon-button" type="button" onClick={async () => { await app.deleteResearchSource(campaignId, item.id); onSelected(selected.filter((id) => id !== item.id)); }} aria-label={`Delete ${item.name}`} title="Delete source"><Trash2 size={15} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}

function PillarReport({ campaignId, report, selectedSourceIds, app }) {
  const pillars = useMemo(() => reportPillars(report), [report]);
  const [activeKey, setActiveKey] = useState(pillars[0].key);
  const active = pillars.find((item) => item.key === activeKey) || pillars[0];
  const [draftEntries, setDraftEntries] = useState(active.entries);
  useEffect(() => setDraftEntries(active.entries), [activeKey, report?.updatedAt, report?.id]);
  const approved = report?.status === "approved";
  function moveTab(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? pillars.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + pillars.length) % pillars.length;
    setActiveKey(pillars[nextIndex].key);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')?.[nextIndex]?.focus();
  }

  return (
    <section className="intelligence-panel pillar-report">
      <header><div><p className="eyebrow">Seven-pillar report</p><h2>Market signal map</h2></div><div className="report-actions"><Badge tone={approved ? "approved" : "queued"}>{report?.status || "not generated"}</Badge><Button variant="secondary" disabled={!selectedSourceIds.length} onClick={() => app.generateMarketReport(campaignId, selectedSourceIds)}><Sparkles size={16} /> Generate report</Button>{report?.id && !approved && <Button onClick={() => app.approveMarketReport(campaignId, report.id)}><ShieldCheck size={16} /> Approve report</Button>}</div></header>
      <div className="pillar-tabs" role="tablist" aria-label="Market report pillars">
        {pillars.map((item, index) => <button key={item.key} type="button" role="tab" tabIndex={item.key === active.key ? 0 : -1} aria-selected={item.key === active.key} aria-controls={`pillar-${item.key}`} id={`tab-${item.key}`} onKeyDown={(event) => moveTab(event, index)} onClick={() => setActiveKey(item.key)}>{item.title}</button>)}
      </div>
      <div className="pillar-panel" role="tabpanel" id={`pillar-${active.key}`} aria-labelledby={`tab-${active.key}`} aria-label={active.title}>
        <div className="pillar-panel__main">
          {draftEntries.map((entry, index) => (
            <article className="pillar-insight-row" key={`${active.key}-${index}`}>
              <label>Finding<textarea value={entry.insight || ""} onChange={(event) => {
                setDraftEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, insight: event.target.value } : item));
              }} /></label>
              <div className="signal-metrics"><span><strong>{entry.frequency || 0}</strong><small>Frequency</small></span><span><strong>{Math.round(Number(entry.confidence || 0) * 100)}%</strong><small>Confidence</small></span></div>
              <ul>{(entry.evidence || []).map((item, evidenceIndex) => <li key={`${item.sourceId || "source"}-${evidenceIndex}`}>{evidenceLabel(item)} <small>{item.sourceId}</small></li>)}</ul>
            </article>
          ))}
          {!draftEntries.length && <EmptyState title={`No ${active.title.toLowerCase()} yet`}>Generate the report from selected evidence sources.</EmptyState>}
        </div>
        <aside className="evidence-rail"><h3>Traceability</h3><p>Every finding retains its source quote, observed frequency, and confidence score.</p><Button variant="secondary" disabled={!report?.id || approved} onClick={() => app.updateMarketReport(campaignId, report.id, { pillars: { ...(report.pillars || {}), [active.key]: draftEntries } })}>Save findings</Button></aside>
      </div>
    </section>
  );
}

export function CampaignIntelligencePage({ app }) {
  const { campaign = "" } = useParams();
  const navigate = useNavigate();
  const active = intelligencePayload(app);
  const campaignRecord = app.organization?.campaigns?.find((item) => String(item.id) === String(campaign)) || {};
  const campaignData = { ...campaignRecord, ...(active?.campaign || {}) };
  const brief = active?.brief || active?.campaignBrief || campaignData.brief || {};
  const sources = active?.sources || active?.researchSources || [];
  const report = active?.activeReport || active?.marketReport || active?.report || null;
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [loadError, setLoadError] = useState("");
  const approved = report?.status === "approved";
  const scriptProject = app.projects?.find((project) => project.campaignId === campaignData.id && project.type !== "auto-clipper");

  useEffect(() => {
    let mounted = true;
    setLoadError("");
    app.loadCampaignIntelligence?.(campaign).catch((error) => {
      if (!mounted) return;
      setLoadError(error.message || "Campaign intelligence could not be loaded");
      app.setStatus?.("Campaign intelligence unavailable");
    });
    return () => { mounted = false; };
  }, [app.loadCampaignIntelligence, campaign]);

  useEffect(() => setSelectedSourceIds([]), [campaign]);

  return (
    <div className="page-stack campaign-intelligence-page">
      <header className="workspace-heading intelligence-workspace-heading"><div><Link className="back-link" to="/intelligence">Market Intelligence</Link><p className="eyebrow">{campaignData.clientName || "Campaign research"}</p><h1>{campaignData.name || campaign}</h1><p>Build a traceable market thesis, approve it, then hand it to the UGC Script Studio.</p></div><span className={`workspace-state${approved ? " complete" : ""}`}>{approved ? "Report approved" : "Research in progress"}</span></header>
      {loadError && <div className="app-alert" role="alert">{loadError}</div>}
      <BriefEditor campaignId={campaign} brief={brief} onSave={app.updateCampaignBrief} />
      <SourcesPanel campaignId={campaign} sources={sources} selected={selectedSourceIds} onSelected={setSelectedSourceIds} app={app} />
      <PillarReport campaignId={campaign} report={report} selectedSourceIds={selectedSourceIds} app={app} />
      <section className={`scriptwriter-gate${approved ? " ready" : ""}`}><span><Sparkles size={21} /></span><div><p className="eyebrow">Scriptwriter handoff</p><h2>{approved ? "Strategy cleared for scripting" : "Approval required"}</h2><p>{approved ? "Generate hooks and scenes from the approved evidence base." : "Approve the market report before generating a UGC script."}</p></div><Button disabled={!approved} onClick={() => navigate(scriptProject ? getProjectPath(scriptProject) : "/projects")}>Open Script Studio <ArrowRight size={16} /></Button></section>
    </div>
  );
}
