import { useState } from "react";
import { Badge } from "../components/Badge.jsx";
import { Button } from "../components/Button.jsx";
import { Card } from "../components/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { VideoCard } from "../components/VideoCard.jsx";

function FileAction({ label, accept, multiple = false, onFile }) {
  const [files, setFiles] = useState([]);
  return (
    <div className="file-action">
      <input type="file" accept={accept} multiple={multiple} onChange={(event) => setFiles([...event.target.files])} />
      <Button type="button" disabled={!files.length} onClick={() => onFile(multiple ? files : files[0])}>{label}</Button>
    </div>
  );
}

function ReadinessCard({ label, ready, detail }) {
  return (
    <article className={`readiness-card ${ready ? "ready" : ""}`}>
      <strong>{label}</strong>
      <span>{detail || (ready ? "Ready" : "Waiting")}</span>
    </article>
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

export function AiGeneratorPage({ app }) {
  const data = app.activeProjectData;
  const summary = data?.summary;
  const media = mediaItems(data);

  if (!data) return <EmptyState title="Select an AI Generator project">Choose an AI project from Projects or Recent projects.</EmptyState>;

  return (
    <div className="page-stack">
      <section className="readiness-grid">
        <ReadinessCard label="Reference" ready={summary.hasReference} detail={summary.hasReference ? "Uploaded" : "Needs video"} />
        <ReadinessCard label="Product" ready={summary.hasProduct} detail={summary.hasProduct ? "Uploaded" : "Needs image"} />
        <ReadinessCard label="Character" ready={summary.hasCharacter} detail={summary.hasCharacter ? "Uploaded" : "Needs reference"} />
        <ReadinessCard label="Blueprint" ready={summary.hasReferenceBlueprint || summary.hasStyleAnalysis} detail={`${summary.frameCount || 0} frames`} />
        <ReadinessCard label="UGC Video" ready={summary.hasUgcVideo} detail={summary.hasUgcVideo ? "Generated" : "Pending"} />
        <ReadinessCard label="Final Render" ready={summary.renderCount > 0} detail={`${summary.renderCount || 0} renders`} />
      </section>

      <section className="workspace-grid">
        <Card eyebrow="Source assets" title="Reference, product, character">
          <div className="action-stack">
            <FileAction label="Upload Reference" accept="video/*" onFile={(file) => app.uploadProjectFile("/reference", file, "Uploading reference")} />
            <FileAction label="Upload Product" accept="image/*" onFile={(file) => app.uploadProjectFile("/product", file, "Uploading product")} />
            <FileAction label="Upload Character" accept="image/*" onFile={(file) => app.uploadProjectFile("/character", file, "Uploading character")} />
          </div>
        </Card>

        <Card eyebrow="Production actions" title="Generate and finish">
          <div className="action-stack">
            <Button onClick={() => app.runProjectAction("/analyze-reference", { body: { frames: 12 }, status: "Analyzing reference", done: "Analysis ready" })}>Analyze Reference</Button>
            <Button onClick={() => app.runProjectAction("/generate-ugc-video", { body: { maxSeconds: 300 }, status: "Generating UGC video", done: "UGC video ready" })}>Generate UGC Video</Button>
            <Button onClick={() => app.runProjectAction("/transcribe-generated-video", { status: "Transcribing output", done: "Transcript ready" })}>Transcribe Output</Button>
            <Button onClick={() => app.runProjectAction("/render", { status: "Rendering final MP4", done: "Final render ready" })}>Render Final MP4</Button>
          </div>
        </Card>
      </section>

      <Card eyebrow="Outputs" title="Generated media">
        <div className="media-grid">
          {media.videos.map((item) => <VideoCard key={item.url} item={item} />)}
          {media.renders.map((item) => <VideoCard key={item.url} item={item} />)}
          {!media.videos.length && !media.renders.length && <EmptyState>Generated UGC and final MP4 outputs appear here.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}

export function AutoClipperPage({ app }) {
  const data = app.activeProjectData;
  const summary = data?.summary;
  const [sourceUrl, setSourceUrl] = useState("");
  const highlights = data?.files?.clipperHighlights?.candidates || data?.summary?.clipCandidates || [];
  const media = mediaItems(data);

  if (!data) return <EmptyState title="Select an Auto Clipper project">Choose a clipper project from Projects or Recent projects.</EmptyState>;

  return (
    <div className="page-stack">
      <section className="readiness-grid">
        <ReadinessCard label="Source" ready={summary.hasClipperSource} detail={summary.hasClipperSource ? "Downloaded" : "Needs link"} />
        <ReadinessCard label="Reaction" ready={summary.hasClipperReaction} detail={summary.hasClipperReaction ? "Uploaded" : "Needs character"} />
        <ReadinessCard label="Transcript" ready={summary.hasClipperTranscript} detail={summary.hasClipperTranscript ? "Ready" : "Pending"} />
        <ReadinessCard label="Highlights" ready={summary.hasClipperHighlights} detail={summary.hasClipperHighlights ? `${highlights.length} moments` : "Pending"} />
        <ReadinessCard label="Active Clip" ready={summary.hasClipperSelection} detail={summary.hasClipperSelection ? "Selected" : "Pending"} />
        <ReadinessCard label="Renders" ready={summary.hasClipperRender} detail={`${summary.renderCount || 0} files`} />
      </section>

      <section className="workspace-grid">
        <Card eyebrow="Source" title="Long-form video">
          <div className="action-stack">
            <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="YouTube or TikTok URL" />
            <Button disabled={!sourceUrl.trim()} onClick={() => app.runProjectAction("/clipper/source-link", { body: { url: sourceUrl.trim() }, status: "Downloading source", done: "Source ready" })}>Download Source</Button>
            <Button onClick={() => app.runProjectAction("/clipper/analyze", { status: "Analyzing highlights", done: "Highlights ready" })}>Analyze Highlights</Button>
          </div>
        </Card>

        <Card eyebrow="Reaction characters" title="Top-left overlays">
          <div className="action-stack">
            <FileAction label="Upload Reaction Characters" accept="image/*,video/*" multiple onFile={async (files) => {
              for (const file of files) await app.uploadProjectFile("/clipper/reaction", file, "Uploading reaction");
            }} />
            <Button onClick={() => app.runProjectAction("/clipper/render", { status: "Rendering active clip", done: "Clip rendered" })}>Render Active Clip</Button>
          </div>
        </Card>
      </section>

      <Card eyebrow="Highlights" title="Candidate moments">
        <div className="data-list">
          {highlights.length ? highlights.map((item) => (
            <article key={item.id} className="data-row">
              <div>
                <p className="eyebrow">{item.start}s - {item.end}s · score {item.score || "-"}</p>
                <h3>{item.title || item.id}</h3>
                <span>{item.reason || item.hook || "Highlight candidate"}</span>
              </div>
              <Button variant="secondary" onClick={() => app.runProjectAction("/clipper/select-highlight", { body: { highlightId: item.id }, status: "Selecting highlight", done: "Highlight selected" })}>Select</Button>
            </article>
          )) : <EmptyState>Run highlight analysis to see clip candidates.</EmptyState>}
        </div>
      </Card>

      <Card eyebrow="Outputs" title="Rendered clips">
        <div className="media-grid">
          {media.renders.map((item) => <VideoCard key={item.url} item={item} />)}
          {!media.renders.length && <EmptyState>Rendered clips appear here.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
