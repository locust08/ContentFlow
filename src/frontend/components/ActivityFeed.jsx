import { AlertCircle, CheckCircle2, FileUp, FolderKanban, MessageSquareText, Sparkles } from "lucide-react";
import { EmptyState } from "./EmptyState.jsx";

const eventIcons = {
  project_synced: FolderKanban,
  "project.created": FolderKanban,
  "project.assigned": FolderKanban,
  "asset.uploaded": FileUp,
  "production.queued": Sparkles,
  "production.job.queued": Sparkles,
  "production.job.claimed": Sparkles,
  "production.completed": CheckCircle2,
  "production.job.completed": CheckCircle2,
  "production.failed": AlertCircle,
  "production.job.failed": AlertCircle,
  "production.worker.online": CheckCircle2,
  "approval.submitted": MessageSquareText,
  "approval.approved": CheckCircle2,
  "approval.changes_requested": MessageSquareText
};

function displayTime(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function eventLabel(value) {
  if (!value) return "Production updated";
  const label = value.replace(/[._-]+/g, " ").trim();
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function ActivityFeed({ items = [] }) {
  if (!items.length) return <EmptyState>Production events will appear here as your team works.</EmptyState>;

  return (
    <div className="activity-feed">
      {items.slice(0, 8).map((item) => {
        const Icon = eventIcons[item.eventType] || Sparkles;
        return (
          <article className="activity-row" key={item.id || `${item.eventType}-${item.createdAt}`}>
            <span className={`activity-row__icon activity-row__icon--${item.eventType?.includes("failed") ? "danger" : "default"}`}><Icon size={16} /></span>
            <div><strong>{item.summary || eventLabel(item.eventType)}</strong><small>{item.projectName || "ContentFlow"}{item.actorName ? ` / ${item.actorName}` : ""}</small></div>
            <time dateTime={item.createdAt}>{displayTime(item.createdAt)}</time>
          </article>
        );
      })}
    </div>
  );
}
