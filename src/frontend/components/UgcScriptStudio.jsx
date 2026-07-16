import { useEffect, useMemo, useState } from "react";
import {
  Check, FileClock, Gauge, LockKeyhole, MessageSquareText, Plus, Save,
  ShieldAlert, ShieldCheck, Sparkles, Trash2
} from "lucide-react";
import { Badge } from "./Badge.jsx";
import { Button } from "./Button.jsx";
import { EmptyState } from "./EmptyState.jsx";

function readableLabel(value) {
  if (value == null || value === "") return "Not scored";
  return typeof value === "number" ? `Grade ${value}` : value;
}

function sceneDuration(scenes) {
  return scenes.reduce((total, scene) => total + Number(scene.durationSeconds || scene.duration || 0), 0);
}

function AnalysisPanel({ analysis }) {
  const entries = Object.entries(analysis || {}).filter(([, value]) => value && !Array.isArray(value) && typeof value !== "object").slice(0, 4);
  return (
    <aside className="script-analysis-panel">
      <header><p className="eyebrow">Pattern analysis</p><h3>Inspiration signals</h3></header>
      {entries.length ? entries.map(([key, value]) => <div key={key}><small>{key.replaceAll("_", " ")}</small><strong>{String(value)}</strong></div>) : <p>Analyze an inspiration source to reveal hook, pacing, proof, and CTA patterns.</p>}
    </aside>
  );
}

function SceneEditor({ scenes, onChange }) {
  const update = (index, field, value) => onChange(scenes.map((scene, itemIndex) => itemIndex === index ? { ...scene, [field]: value } : scene));
  const remove = (index) => onChange(scenes.filter((_, itemIndex) => itemIndex !== index));
  const add = () => onChange([...scenes, { id: `scene-${Date.now()}`, title: `Scene ${scenes.length + 1}`, durationSeconds: 5, visualAction: "", audioSpokenWord: "", evidence: [] }]);
  return (
    <div className="scene-editor">
      <div className="scene-editor__heading"><div><p className="eyebrow">Structured editor</p><h3>Scenes</h3></div><Button type="button" variant="secondary" onClick={add}><Plus size={15} /> Add scene</Button></div>
      {scenes.map((scene, index) => (
        <article className="scene-row" key={scene.id || index}>
          <div className="scene-row__index">{String(index + 1).padStart(2, "0")}</div>
          <div className="scene-row__fields">
            <label>Scene title<input value={scene.title || ""} onChange={(event) => update(index, "title", event.target.value)} /></label>
            <label>Seconds<input type="number" min="1" max="120" value={scene.durationSeconds || ""} onChange={(event) => update(index, "durationSeconds", Number(event.target.value))} /></label>
            <label className="scene-row__wide">Visual direction<textarea value={scene.visualAction || ""} onChange={(event) => update(index, "visualAction", event.target.value)} /></label>
            <label className="scene-row__wide">Dialogue<textarea aria-label={`Dialogue for ${scene.title || `Scene ${index + 1}`}`} value={scene.audioSpokenWord || ""} onChange={(event) => update(index, "audioSpokenWord", event.target.value)} /></label>
            <div className="scene-evidence"><small>Evidence</small><span>{(scene.evidence || []).length ? (scene.evidence || []).map((item) => typeof item === "string" ? item : item.quote || item.claim || item.text).join(" · ") : "No evidence attached"}</span></div>
          </div>
          <button className="icon-button" type="button" onClick={() => remove(index)} aria-label={`Delete ${scene.title || `scene ${index + 1}`}`} title="Delete scene"><Trash2 size={15} /></button>
        </article>
      ))}
    </div>
  );
}

function VersionRail({ versions, reviewEvents }) {
  return (
    <aside className="script-version-rail">
      <section><header><FileClock size={17} /><h3>Versions</h3></header>{versions.length ? versions.slice().reverse().map((version, index) => <div key={version.id || index}><strong>Version {version.versionNumber || version.number || versions.length - index}</strong><small>{version.createdAt ? new Date(version.createdAt).toLocaleString() : version.id}</small></div>) : <p>No saved versions yet.</p>}</section>
      <section><header><MessageSquareText size={17} /><h3>Review trail</h3></header>{reviewEvents.length ? reviewEvents.slice().reverse().map((event, index) => { const status = event.toStatus || event.status || event.eventType; return <div key={event.id || index}><Badge tone={status === "approved" ? "approved" : "queued"}>{status}</Badge><small>{event.feedback || event.overrideReason || "No feedback"}</small></div>; }) : <p>No review events yet.</p>}</section>
    </aside>
  );
}

export function UgcScriptStudio({ app, data }) {
  const files = data?.files || {};
  const report = files.marketReport || data?.marketReport || null;
  const analysis = files.scriptAnalysis || data?.scriptAnalysis || null;
  const script = files.ugcScript || data?.ugcScript || null;
  const hooks = script?.hooks || [];
  const [mode, setMode] = useState("auto");
  const [manualTranscript, setManualTranscript] = useState("");
  const [selectedHookId, setSelectedHookId] = useState(script?.selectedHookId || hooks[0]?.id || "");
  const [scenes, setScenes] = useState(script?.scenes || []);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const approved = report?.status === "approved";
  const canGenerate = approved || (app.isAdmin && overrideOpen && overrideReason.trim());

  useEffect(() => {
    setSelectedHookId(script?.selectedHookId || hooks[0]?.id || "");
    setScenes(script?.scenes || []);
  }, [script?.id, script?.versionId]);

  const metrics = useMemo(() => ({
    duration: script?.estimatedDurationSeconds ?? script?.metrics?.durationSeconds ?? sceneDuration(scenes),
    readability: script?.readingGradeLevel ?? script?.metrics?.readabilityGrade ?? script?.readabilityGrade,
    evidence: script?.metrics?.evidenceCoverage ?? script?.evidenceCoverage ?? 0
  }), [scenes, script]);

  function generate() {
    if (!canGenerate) return;
    app.generateUgcScript(report?.id, approved ? "" : overrideReason.trim());
  }

  function saveVersion() {
    app.updateUgcScript({
      scriptId: script.id,
      baseVersionId: script.currentVersionId || script.versionId || script.baseVersionId,
      hooks,
      selectedHookId,
      scenes
    });
  }

  function moveHook(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? hooks.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + hooks.length) % hooks.length;
    setSelectedHookId(hooks[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')?.[nextIndex]?.focus();
  }

  const availableReviewActions = {
    draft: [{ status: "internal-review", label: "Submit internal review" }],
    "internal-review": [
      { status: "changes-requested", label: "Request changes", secondary: true },
      { status: "client-review", label: "Send to client" }
    ],
    "client-review": [
      { status: "changes-requested", label: "Request changes", secondary: true },
      { status: "approved", label: "Approve script" }
    ],
    "changes-requested": [{ status: "draft", label: "Return to draft" }],
    approved: []
  }[script?.status || "draft"] || [];
  const reviewActions = app.isAdmin
    ? availableReviewActions
    : app.isClient
      ? availableReviewActions.filter((action) => ["approved", "changes-requested"].includes(action.status) && script?.status === "client-review")
      : availableReviewActions.filter((action) => !(script?.status === "client-review"));

  return (
    <section className="ugc-script-studio" aria-labelledby="script-studio-title">
      <header className="script-studio-heading"><div><p className="eyebrow">UGC Script Studio</p><h2 id="script-studio-title">Evidence-led scriptwriter</h2><p>Analyze inspiration, choose a hook, and shape every scene against approved market signals.</p></div><Badge tone={approved ? "approved" : "queued"}>{approved ? "report approved" : "report approval required"}</Badge></header>

      <div className="script-intake-grid">
        <section className="script-intake-panel">
          <div className="mode-options" role="radiogroup" aria-label="Inspiration mode">
            <label className={mode === "auto" ? "selected" : ""}><input aria-label="Auto inspiration" type="radio" name="script-mode" checked={mode === "auto"} onChange={() => setMode("auto")} /><Sparkles size={18} /><span><strong>Auto inspiration</strong><small>Use the project reference transcript</small></span></label>
            <label className={mode === "manual" ? "selected" : ""}><input aria-label="Manual transcript" type="radio" name="script-mode" checked={mode === "manual"} onChange={() => setMode("manual")} /><MessageSquareText size={18} /><span><strong>Manual transcript</strong><small>Paste a specific winning example</small></span></label>
          </div>
          {mode === "manual" && <label className="manual-transcript">Inspiration transcript<textarea aria-label="Inspiration transcript" value={manualTranscript} onChange={(event) => setManualTranscript(event.target.value)} placeholder="Paste the spoken transcript here" /></label>}
          <Button variant="secondary" disabled={mode === "manual" && !manualTranscript.trim()} onClick={() => app.analyzeUgcScript(mode, mode === "manual" ? manualTranscript.trim() : undefined)}><Gauge size={16} /> Analyze inspiration</Button>
        </section>
        <AnalysisPanel analysis={analysis} />
      </div>

      <div className={`script-generation-gate${approved ? " ready" : ""}`}>
        <span>{approved ? <ShieldCheck size={20} /> : <LockKeyhole size={20} />}</span>
        <div><strong>{approved ? "Approved intelligence connected" : "Approved market report required"}</strong><small>{approved ? "Generation will cite report evidence." : "Staff generation stays locked until strategy approval."}</small></div>
        {!approved && app.isAdmin && !overrideOpen && <Button variant="secondary" onClick={() => setOverrideOpen(true)}><ShieldAlert size={16} /> Override approval gate</Button>}
        {!approved && app.isAdmin && overrideOpen && <label className="override-reason">Override reason<input aria-label="Override reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Required for the audit trail" /></label>}
        <Button disabled={!canGenerate} onClick={generate}><Sparkles size={16} /> Generate script</Button>
      </div>

      {script ? (
        <div className="script-editor-layout">
          <div className="script-editor-main">
            <div className="hook-workbench"><div><p className="eyebrow">Hook candidates</p><h3>Choose the opening</h3></div><div className="hook-tabs" role="tablist" aria-label="Generated hook candidates">{hooks.map((hook, index) => <button type="button" key={hook.id || index} role="tab" tabIndex={selectedHookId === hook.id ? 0 : -1} aria-selected={selectedHookId === hook.id} onKeyDown={(event) => moveHook(event, index)} onClick={() => setSelectedHookId(hook.id)}><small>Hook {index + 1}</small><strong>{hook.text}</strong><span>{(hook.evidence || []).length} evidence link{(hook.evidence || []).length === 1 ? "" : "s"}</span></button>)}</div></div>
            <SceneEditor scenes={scenes} onChange={setScenes} />
            <div className="script-metrics" aria-label="Script quality metrics"><span><strong>{metrics.duration}s</strong><small>Duration</small></span><span><strong>{readableLabel(metrics.readability)}</strong><small>Readability</small></span><span><strong>{metrics.evidence}%</strong><small>Evidence coverage</small></span></div>
            <div className="script-save-bar"><span><Save size={18} /><span><strong>Version {data?.scriptVersions?.length ? data.scriptVersions.length + 1 : 1}</strong><small>Saving creates a new, reviewable snapshot.</small></span></span><Button onClick={saveVersion}><Save size={16} /> Save version</Button></div>
            <section className="script-review-box"><div><p className="eyebrow">Review decision</p><h3>{script.status === "approved" ? "Script approved" : "Send the script forward"}</h3></div><label>Review feedback<textarea aria-label="Review feedback" value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} placeholder="Optional context for the next reviewer" /></label><div>{reviewActions.map((action) => <Button key={action.status} variant={action.secondary ? "secondary" : "primary"} onClick={() => app.reviewUgcScript(action.status, reviewFeedback.trim() || undefined)}>{action.status === "approved" && <Check size={16} />}{action.label}</Button>)}</div></section>
          </div>
          <VersionRail versions={data?.scriptVersions || []} reviewEvents={data?.scriptReviewEvents || []} />
        </div>
      ) : <EmptyState title="No script generated">Connect an approved market report, analyze inspiration, then generate the first version.</EmptyState>}
    </section>
  );
}
