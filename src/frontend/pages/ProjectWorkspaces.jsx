import { useMemo, useState } from "react";
import {
  Check, Clapperboard, Download, Film, Image as ImageIcon, Link2, Play,
  Scissors, Sparkles, Upload, UserRound, WandSparkles
} from "lucide-react";
import { Button } from "../components/Button.jsx";
import { Card } from "../components/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { VideoCard } from "../components/VideoCard.jsx";
import { UgcScriptStudio } from "../components/UgcScriptStudio.jsx";

function FileAction({ label, accept, multiple = false, onFile }) {
  const [files, setFiles] = useState([]);
  return (
    <div className="file-action">
      <label className="file-picker">
        <Upload size={17} />
        <span>{files.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : label}</span>
        <input type="file" accept={accept} multiple={multiple} onChange={(event) => setFiles([...event.target.files])} />
      </label>
      <Button type="button" disabled={!files.length} onClick={() => onFile(multiple ? files : files[0])}>Upload</Button>
    </div>
  );
}

function ProgressSteps({ steps }) {
  return (
    <ol className="production-progress">
      {steps.map((step, index) => (
        <li key={step.label} className={step.ready ? "complete" : index === steps.findIndex((item) => !item.ready) ? "current" : ""}>
          <span>{step.ready ? <Check size={14} /> : index + 1}</span>
          <div><strong>{step.label}</strong><small>{step.detail}</small></div>
        </li>
      ))}
    </ol>
  );
}

function mediaItems(data) {
  return {
    products: data?.products || [],
    characters: data?.characters || [],
    videos: data?.videos || [],
    renders: data?.renders || [],
    reactions: data?.clipper?.reactions || []
  };
}

function AssetSummary({ icon: Icon, title, ready, children }) {
  return (
    <article className={`asset-summary${ready ? " ready" : ""}`}>
      <span className="asset-summary__icon"><Icon size={18} /></span>
      <div><strong>{title}</strong><small>{ready ? "Ready" : "Required"}</small></div>
      {children}
    </article>
  );
}

function Blueprint({ data }) {
  const blueprint = data?.files?.referenceBlueprint || data?.files?.styleAnalysis || data?.analysis?.referenceBlueprint;
  if (!blueprint) return <EmptyState title="No blueprint yet">Analyze the reference to map its hook, delivery, pacing, visuals, and CTA.</EmptyState>;
  const entries = Object.entries(blueprint).filter(([, value]) => value && typeof value !== "object").slice(0, 6);
  return (
    <div className="blueprint-list">
      {entries.length ? entries.map(([key, value]) => <article key={key}><span>{key.replaceAll("_", " ")}</span><p>{String(value)}</p></article>) : <pre>{JSON.stringify(blueprint, null, 2)}</pre>}
    </div>
  );
}

export function AiGeneratorPage({ app }) {
  const data = app.activeProjectData;
  const summary = data?.summary;
  const media = mediaItems(data);
  const [productionOverride, setProductionOverride] = useState("");

  if (!data) return <EmptyState title="Select an AI Generator project">Choose an AI project from Projects or Creator Studio.</EmptyState>;

  const steps = [
    { label: "Reference", ready: summary.hasReference, detail: "Winning example" },
    { label: "Product", ready: summary.hasProduct, detail: "Promoted item" },
    { label: "Character", ready: summary.hasCharacter, detail: "Creator identity" },
    { label: "Research", ready: data.files?.marketReport?.status === "approved", detail: "Market report" },
    { label: "Blueprint", ready: summary.hasReferenceBlueprint || summary.hasStyleAnalysis, detail: `${summary.frameCount || 0} frames read` },
    { label: "Script", ready: Boolean(data.files?.ugcScript), detail: `${data.scriptVersions?.length || 0} versions` },
    { label: "Review", ready: data.files?.ugcScript?.status === "approved" || data.scriptReviewEvents?.some((event) => (event.toStatus || event.status) === "approved"), detail: "Script decision" },
    { label: "Generate", ready: summary.hasUgcVideo, detail: "UGC output" },
    { label: "Finish", ready: summary.renderCount > 0, detail: `${summary.renderCount || 0} renders` }
  ];

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div><p className="eyebrow">AI UGC Generator</p><h1>{app.activeProject}</h1><p>Rebuild a proven UGC structure around your product and character.</p></div>
        <span className={`workspace-state${summary.renderCount ? " complete" : ""}`}>{summary.renderCount ? "Final ready" : "In production"}</span>
      </header>
      <ProgressSteps steps={steps} />

      <section className="ai-workspace-grid">
        <Card eyebrow="Source assets" title="Creative inputs" className="asset-panel">
          <AssetSummary icon={Film} title="Reference video" ready={summary.hasReference} />
          <FileAction label="Choose reference video" accept="video/*" onFile={(file) => app.uploadProjectFile("/reference", file, "Uploading reference")} />
          <AssetSummary icon={ImageIcon} title="Product image" ready={summary.hasProduct} />
          <FileAction label="Choose product image" accept="image/*" onFile={(file) => app.uploadProjectFile("/product", file, "Uploading product")} />
          <AssetSummary icon={UserRound} title="Character reference" ready={summary.hasCharacter} />
          <FileAction label="Choose character image" accept="image/*" onFile={(file) => app.uploadProjectFile("/character", file, "Uploading character")} />
        </Card>

        <Card eyebrow="Reference brain" title="Replication blueprint" className="blueprint-panel">
          <Blueprint data={data} />
        </Card>

        <Card eyebrow="Output preview" title="Latest generated video" className="output-preview-panel">
          {media.renders[0] || media.videos[0] ? <VideoCard item={media.renders[0] || media.videos[0]} /> : <div className="vertical-preview-placeholder"><Sparkles size={28} /><strong>Your UGC output appears here</strong><span>Complete the source assets, then analyze and generate.</span></div>}
        </Card>
      </section>

      <UgcScriptStudio app={app} data={data} />

      {(media.videos.length > 1 || media.renders.length > 1) && <Card eyebrow="Output library" title="Generated media"><div className="media-grid">{[...media.videos, ...media.renders].map((item) => <VideoCard key={item.url} item={item} />)}</div></Card>}

      <footer className="production-action-bar">
        <div><WandSparkles size={19} /><span><strong>Production actions</strong><small>{app.status}</small></span></div>
        <div className="production-action-bar__buttons">
          <Button variant="secondary" disabled={!summary.hasReference} onClick={() => app.runProjectAction("/analyze-reference", { body: { frames: 12 }, status: "Analyzing reference", done: "Analysis ready" })}>Analyze</Button>
          {app.isAdmin && data.files?.ugcScript && data.files.ugcScript.status !== "approved" && <label className="production-override">Admin override<input aria-label="Production override reason" value={productionOverride} onChange={(event) => setProductionOverride(event.target.value)} placeholder="Reason required" /></label>}
          <Button variant="secondary" disabled={!summary.hasReference || !summary.hasProduct || !summary.hasCharacter || !data.files?.ugcScript || (data.files.ugcScript.status !== "approved" && !(app.isAdmin && productionOverride.trim()))} onClick={() => app.runProjectAction("/generate-ugc-video", { body: { maxSeconds: 300, scriptId: data.files.ugcScript.id, scriptVersionId: data.files.ugcScript.currentVersionId, selectedHookId: data.files.ugcScript.selectedHookId, ...(productionOverride.trim() ? { overrideReason: productionOverride.trim() } : {}) }, status: "Generating UGC video", done: "UGC video ready" })}>Generate</Button>
          <Button variant="secondary" disabled={!summary.hasUgcVideo} onClick={() => app.runProjectAction("/transcribe-generated-video", { status: "Transcribing output", done: "Transcript ready" })}>Transcribe</Button>
          <Button disabled={!summary.hasUgcVideo} onClick={() => app.runProjectAction("/render", { status: "Rendering final MP4", done: "Final render ready" })}><Play size={16} /> Render final</Button>
        </div>
      </footer>
    </div>
  );
}

function ReactionPreview({ reaction, selected, onChange }) {
  const isVideo = reaction.type === "video" || /\.(mp4|webm)$/i.test(reaction.url || reaction.path || "");
  return (
    <label className={`reaction-card${selected ? " selected" : ""}`}>
      <input type="checkbox" checked={selected} onChange={onChange} aria-label={`Select ${reaction.name}`} />
      <span className="reaction-card__preview">{isVideo ? <video src={reaction.url} muted /> : reaction.url ? <img src={reaction.url} alt="" /> : <UserRound size={24} />}</span>
      <span><strong>{reaction.name}</strong><small>{isVideo ? "Video reaction" : "Image reaction"}</small></span>
      <i>{selected && <Check size={13} />}</i>
    </label>
  );
}

export function AutoClipperPage({ app }) {
  const data = app.activeProjectData;
  const summary = data?.summary;
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedHighlights, setSelectedHighlights] = useState([]);
  const [selectedReactions, setSelectedReactions] = useState([]);
  const highlights = data?.files?.clipperHighlights?.candidates || data?.summary?.clipCandidates || [];
  const activeHighlight = data?.files?.clipperSelection?.id || data?.files?.clipperSelection?.highlightId;
  const media = mediaItems(data);

  const expectedOutputs = useMemo(() => Math.max(selectedHighlights.length, selectedReactions.length, 1), [selectedHighlights, selectedReactions]);
  if (!data) return <EmptyState title="Select an Auto Clipper project">Choose a clipper project from Projects or Creator Studio.</EmptyState>;

  function toggle(list, setList, id) {
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  return (
    <div className="workspace-page clipper-workspace">
      <header className="workspace-heading">
        <div><p className="eyebrow">Auto Clipper</p><h1>{app.activeProject}</h1><p>Find the strongest moments and produce reaction-ready vertical variations.</p></div>
        <span className={`workspace-state${summary.hasClipperRender ? " complete" : ""}`}>{summary.hasClipperRender ? `${summary.renderCount || 0} outputs` : "In production"}</span>
      </header>

      <section className="clipper-command-grid">
        <Card eyebrow="01 Source" title="Long-form video" className="clipper-source-panel">
          <label className="field-label" htmlFor="clipper-url">YouTube or TikTok URL</label>
          <div className="url-field"><Link2 size={17} /><input id="clipper-url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Paste the source link" /></div>
          <div className="inline-actions"><Button disabled={!sourceUrl.trim()} onClick={() => app.runProjectAction("/clipper/source-link", { body: { url: sourceUrl.trim() }, status: "Downloading source", done: "Source ready" })}><Download size={16} /> Download</Button><Button variant="secondary" disabled={!summary.hasClipperSource} onClick={() => app.runProjectAction("/clipper/analyze", { status: "Analyzing highlights", done: "Highlights ready" })}><Sparkles size={16} /> Analyze highlights</Button></div>
          <div className="compact-status-list"><span className={summary.hasClipperSource ? "ready" : ""}><Check size={14} /> Source</span><span className={summary.hasClipperTranscript ? "ready" : ""}><Check size={14} /> Transcript</span><span className={summary.hasClipperHighlights ? "ready" : ""}><Check size={14} /> {highlights.length || 0} highlights</span></div>
        </Card>

        <Card eyebrow="02 Highlights" title="Ranked moments" className="highlight-panel">
          <div className="highlight-list">
            {highlights.length ? highlights.map((item, index) => (
              <article key={item.id} className={`highlight-card${activeHighlight === item.id ? " active" : ""}${selectedHighlights.includes(item.id) ? " selected" : ""}`}>
                <label className="selection-control"><input type="checkbox" checked={selectedHighlights.includes(item.id)} onChange={() => toggle(selectedHighlights, setSelectedHighlights, item.id)} aria-label={`Select ${item.title || item.id}`} /><span><Check size={12} /></span></label>
                <div className="highlight-rank">{String(index + 1).padStart(2, "0")}</div>
                <div><strong>{item.title || item.id}</strong><small>{item.start}s - {item.end}s · score {item.score || "-"}</small><p>{item.reason || item.hook || "High-retention moment"}</p></div>
                <button className="text-button" type="button" onClick={() => app.runProjectAction("/clipper/select-highlight", { body: { highlightId: item.id }, status: "Selecting highlight", done: "Active clip updated" })}>{activeHighlight === item.id ? "Active" : "Make active"}</button>
              </article>
            )) : <EmptyState>Analyze the source to reveal ranked highlight candidates.</EmptyState>}
          </div>
        </Card>

        <Card eyebrow="03 Reactions" title="Character variations" className="reaction-panel">
          <FileAction label="Add reaction characters" accept="image/*,video/*" multiple onFile={async (files) => { for (const file of files) await app.uploadProjectFile("/clipper/reaction", file, "Uploading reaction"); }} />
          <div className="reaction-list">
            {media.reactions.length ? media.reactions.map((reaction) => <ReactionPreview key={reaction.id} reaction={reaction} selected={selectedReactions.includes(reaction.id)} onChange={() => toggle(selectedReactions, setSelectedReactions, reaction.id)} />) : <EmptyState>Add image or video reaction characters.</EmptyState>}
          </div>
        </Card>
      </section>

      <Card eyebrow="Rendered output" title="Clip library" className="clip-output-panel">
        <div className="media-grid">{media.renders.length ? media.renders.map((item) => <VideoCard key={item.url} item={item} />) : <EmptyState>Rendered clips and character variations appear here.</EmptyState>}</div>
      </Card>

      <footer className="production-action-bar">
        <div><Clapperboard size={19} /><span><strong>{expectedOutputs} expected output{expectedOutputs === 1 ? "" : "s"}</strong><small>{selectedHighlights.length} highlights · {selectedReactions.length} characters</small></span></div>
        <div className="production-action-bar__buttons">
          <Button variant="secondary" disabled={!summary.hasClipperSelection} onClick={() => app.runProjectAction("/clipper/render", { status: "Rendering active clip", done: "Clip rendered" })}><Play size={16} /> Render active clip</Button>
          <Button variant="secondary" disabled={!selectedHighlights.length} onClick={() => app.runProjectAction("/clipper/render-bulk", { body: { highlightIds: selectedHighlights }, status: `Rendering ${selectedHighlights.length} clips`, done: "Selected clips rendered" })}><Scissors size={16} /> {selectedHighlights.length ? `Render ${selectedHighlights.length} selected clips` : "Render selected clips"}</Button>
          <Button disabled={!selectedReactions.length || !summary.hasClipperSelection} onClick={() => app.runProjectAction("/clipper/render-variations", { body: { reactionIds: selectedReactions }, status: `Rendering ${selectedReactions.length} variations`, done: "Character variations ready" })}><UserRound size={16} /> {selectedReactions.length ? `Render ${selectedReactions.length} character variations` : "Render character variations"}</Button>
        </div>
      </footer>
    </div>
  );
}
