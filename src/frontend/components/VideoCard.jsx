import { Badge } from "./Badge.jsx";

export function VideoCard({ item }) {
  return (
    <article className="video-card">
      {item.url ? <video src={item.url} controls /> : <div className="video-card__placeholder">No preview</div>}
      <div>
        <strong>{item.name || item.title || "Video output"}</strong>
        <span>{item.project || item.status || "ContentFlow output"}</span>
        {item.approvalStatus && <Badge tone={item.approvalStatus}>{item.approvalStatus}</Badge>}
      </div>
    </article>
  );
}
