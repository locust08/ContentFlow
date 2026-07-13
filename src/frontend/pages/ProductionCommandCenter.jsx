import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, Clock3, ExternalLink, LoaderCircle,
  RefreshCw, RotateCcw, ShieldAlert, X, XCircle
} from "lucide-react";
import { Badge } from "../components/Badge.jsx";
import { Button } from "../components/Button.jsx";
import { Card } from "../components/Card.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { MetricCard } from "../components/MetricCard.jsx";
import { useProductionCommandCenter } from "../state/useProductionCommandCenter.js";

const metrics = [
  { key: "queued", label: "Queued", icon: Clock3, caption: "Ready for a worker" },
  { key: "processing", label: "Processing", icon: LoaderCircle, caption: "Claimed by a worker" },
  { key: "completed", label: "Completed", icon: CheckCircle2, caption: "Available outputs" },
  { key: "failed", label: "Failed", icon: AlertTriangle, caption: "Needs attention" },
  { key: "cancelled", label: "Cancelled", icon: XCircle, caption: "Stopped before work" }
];

const statusOptions = ["", "queued", "processing", "completed", "failed", "cancelled"];
const sensitiveKey = /api[_-]?key|token|authorization|password|secret|credential|bearer/i;
const sensitiveValue = /\bbearer\s+[a-z0-9._~+/=-]{8,}\b|\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]+\.[a-z0-9_-]+\b|\b(?:sk|pk|rk|api|token|ghp)[_-][a-z0-9_-]{16,}\b/i;
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function labelFor(value) {
  return value ? value.replaceAll("-", " ") : "All";
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function formatDuration(job) {
  if (!job.startedAt) return "Not started";
  const end = job.completedAt || job.cancelledAt || Date.now();
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(job.startedAt).getTime());
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function sanitizePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (typeof value === "string" && sensitiveValue.test(value)) return "[redacted]";
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !sensitiveKey.test(key))
    .map(([key, item]) => [key, sanitizePayload(item)]));
}

function workerState(workers = []) {
  const counts = { online: 0, busy: 0, offline: 0 };
  const activeWorkers = workers.map((worker) => ({
    ...worker,
    healthStatus: worker?.health?.status || (worker?.currentJobId ? "busy" : worker?.status || "offline")
  }));
  for (const worker of activeWorkers) counts[worker.healthStatus in counts ? worker.healthStatus : "offline"] += 1;
  const lastSeenWorker = activeWorkers.reduce((latest, worker) => !latest || new Date(worker.lastSeenAt || 0) > new Date(latest.lastSeenAt || 0) ? worker : latest, null);
  return {
    counts,
    lastSeenAt: lastSeenWorker?.lastSeenAt || "",
    status: counts.busy ? "busy" : counts.online ? "online" : "offline"
  };
}

function JobDetailsDrawer({ job, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!job) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, [job]);

  if (!job) return null;
  const payload = sanitizePayload(job.payload || {});
  const timestamps = [
    ["Requested", job.createdAt],
    ["Started", job.startedAt],
    ["Completed", job.completedAt],
    ["Cancelled", job.cancelledAt],
    ["Updated", job.updatedAt]
  ];

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll(focusableSelector)];
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="drawer-backdrop" onMouseDown={onClose}>
    <aside ref={dialogRef} className="side-drawer command-center-drawer" role="dialog" tabIndex="-1" aria-modal="true" aria-labelledby="job-details-title" onKeyDown={handleKeyDown} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">Production job</p><h2 id="job-details-title">Job details</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close job details" title="Close"><X size={18} /></button></header>
      <div className="command-center-drawer__summary"><Badge tone={job.status}>{job.status}</Badge><strong>{job.jobType || "production job"}</strong><span>{job.id}</span></div>
      <dl className="job-detail-list">
        <div><dt>Project</dt><dd>{job.projectName || "Not assigned"}</dd></div>
        <div><dt>Requested by</dt><dd>{job.requestedBy || "Not recorded"}</dd></div>
        <div><dt>Attempts</dt><dd>{job.attemptCount || 0}</dd></div>
        <div><dt>Progress</dt><dd>{job.progress || 0}% {job.progressMessage ? `- ${job.progressMessage}` : ""}</dd></div>
        {timestamps.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatTime(value)}</dd></div>)}
        {job.error && <div className="job-detail-list__error"><dt>Error</dt><dd>{job.error}</dd></div>}
      </dl>
      <section className="job-payload"><h3>Payload</h3><pre>{JSON.stringify(payload, null, 2)}</pre></section>
    </aside>
  </div>;
}

function JobRow({ job, pendingActions = {}, onCancel, onDetails, onRetry }) {
  const retryPending = Boolean(pendingActions[`${job.id}:retry`]);
  const cancelPending = Boolean(pendingActions[`${job.id}:cancel`]);
  const canRetry = job.status === "failed" || job.status === "cancelled";
  const canCancel = job.status === "queued";
  const progress = Math.min(100, Math.max(0, Number(job.progress || 0)));

  return <article className={`job-row job-row--${job.status || "queued"}`}>
    <div className="job-row__status"><Badge tone={job.status || "queued"}>{job.status || "queued"}</Badge><span>{progress}%</span></div>
    <div className="job-row__main"><button className="job-row__details-button" type="button" onClick={() => onDetails(job)} aria-label={`Open ${job.status || "queued"} job details`}><strong>{job.jobType || "production job"}</strong><span>{job.projectName || "No project"}</span></button><div className="job-progress" aria-label={`${job.jobType || "Job"} progress`}><span style={{ width: `${progress}%` }} /></div><small>{job.error || job.progressMessage || "Waiting for an update"}</small></div>
    <dl className="job-row__metadata"><div><dt>Requested</dt><dd>{formatTime(job.createdAt)}</dd></div><div><dt>Duration</dt><dd>{formatDuration(job)}</dd></div><div><dt>Attempt</dt><dd>{job.attemptCount || 0}</dd></div></dl>
    <div className="job-row__actions">
      {job.projectName && <Link className="text-button" to={`/projects?search=${encodeURIComponent(job.projectName)}`}>Open project</Link>}
      {job.outputUrl && <a className="text-button" href={job.outputUrl} target="_blank" rel="noreferrer" aria-label="Open output for completed job">Open output <ExternalLink size={14} /></a>}
      {canRetry && <Button variant="secondary" disabled={retryPending} onClick={() => onRetry(job.id)} aria-label={`Retry ${job.status} job`}><RotateCcw size={15} /> {retryPending ? "Retrying" : "Retry"}</Button>}
      {canCancel && <Button variant="danger" disabled={cancelPending} onClick={() => onCancel(job.id)} aria-label="Cancel queued job"><XCircle size={15} /> {cancelPending ? "Cancelling" : "Cancel"}</Button>}
    </div>
  </article>;
}

export function ProductionCommandCenter({ app }) {
  const commandCenter = useProductionCommandCenter();
  const [selectedJob, setSelectedJob] = useState(null);
  const { counts: workerCounts, lastSeenAt, status: workerStatus } = workerState(commandCenter.workers);
  const projects = useMemo(() => [...new Set([...(app.projects || []).map((project) => project.name), ...commandCenter.jobs.map((job) => job.projectName).filter(Boolean)])], [app.projects, commandCenter.jobs]);
  const jobTypes = useMemo(() => [...new Set(commandCenter.jobs.map((job) => job.jobType).filter(Boolean))], [commandCenter.jobs]);
  const visibleJobs = useMemo(() => {
    const search = commandCenter.filters.search.trim().toLowerCase();
    if (!search) return commandCenter.jobs;
    return commandCenter.jobs.filter((job) => [job.id, job.projectName, job.jobType].some((value) => value?.toLowerCase().includes(search)));
  }, [commandCenter.filters.search, commandCenter.jobs]);
  const updateFilter = (key, value) => commandCenter.setFilters({ ...commandCenter.filters, [key]: value });
  const runAction = (method, jobId) => Promise.resolve(method(jobId)).catch(() => {});

  return <div className="page-stack command-center-page">
    <header className="page-heading command-center-heading"><div><p className="eyebrow">Hybrid production engine</p><h1>Production Command Center</h1><p>Monitor hosted requests and the local Digital Bee production worker.</p></div><div className="command-center-heading__actions"><div className={`worker-health worker-health--${workerStatus}`}><span className="worker-health__dot" /><div><strong>Worker {workerStatus}</strong><small>{workerCounts.online} online · {workerCounts.busy} busy · {workerCounts.offline} offline</small><small>{lastSeenAt ? `Last heartbeat ${formatTime(lastSeenAt)}` : "No worker heartbeat recorded"}</small></div></div><Button variant="secondary" onClick={() => commandCenter.refresh().catch(() => {})} disabled={commandCenter.loading}><RefreshCw size={16} /> Refresh</Button></div></header>

    {workerStatus === "offline" && commandCenter.summary.queued > 0 && <div className="command-center-warning"><ShieldAlert size={18} /><span><strong>Queued work is waiting safely</strong><small>Jobs will start when the local worker reconnects.</small></span></div>}
    {commandCenter.error && <div className="app-alert command-center-error"><span>{commandCenter.error}</span><Button variant="ghost" onClick={() => commandCenter.refresh().catch(() => {})}>Retry</Button></div>}

    <section className="metric-grid command-center-metrics" aria-label="Production job totals">{metrics.map(({ key, label, icon, caption }) => <MetricCard key={key} icon={icon} label={label} value={commandCenter.summary[key] || 0} caption={caption} />)}</section>

    <Card eyebrow="Queue controls" title="Production jobs" action={<span className="queue-count">{visibleJobs.length} shown</span>}>
      <div className="command-center-filters">
        <div className="status-filter" role="group" aria-label="Filter jobs by status">{statusOptions.map((status) => <button key={status || "all"} type="button" className={commandCenter.filters.status === status ? "active" : ""} onClick={() => updateFilter("status", status)}>{labelFor(status)}</button>)}</div>
        <label><span>Project</span><select aria-label="Filter jobs by project" value={commandCenter.filters.project} onChange={(event) => updateFilter("project", event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label>
        <label><span>Job type</span><select aria-label="Filter jobs by job type" value={commandCenter.filters.jobType} onChange={(event) => updateFilter("jobType", event.target.value)}><option value="">All job types</option>{jobTypes.map((jobType) => <option key={jobType} value={jobType}>{jobType}</option>)}</select></label>
        <label className="search-field"><span className="sr-only">Search jobs</span><input aria-label="Search jobs" value={commandCenter.filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search ID, project, or job type" /></label>
      </div>
      <div className="job-list">
        {commandCenter.loading && !commandCenter.jobs.length ? <div className="queue-loading"><span className="spinner" /> Loading production jobs</div> : visibleJobs.map((job) => <JobRow key={job.id} job={job} pendingActions={commandCenter.pendingActions} onDetails={setSelectedJob} onRetry={(jobId) => runAction(commandCenter.retryJob, jobId)} onCancel={(jobId) => runAction(commandCenter.cancelJob, jobId)} />)}
        {!commandCenter.loading && !visibleJobs.length && <EmptyState title="No production jobs">Hosted production requests will appear here when a project queues work for the local worker.</EmptyState>}
      </div>
    </Card>
    <JobDetailsDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
  </div>;
}
