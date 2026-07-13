export const PRODUCTION_JOB_TYPES = new Set([
  "analyze-reference",
  "generate-content",
  "generate-images",
  "generate-videos",
  "generate-ugc-video",
  "transcribe-generated-video",
  "generate-voiceover",
  "render-final-video",
  "clipper-source-link",
  "clipper-analyze",
  "clipper-render",
  "clipper-render-bulk",
  "clipper-render-variations",
  "pipeline"
]);

const actionToJobType = {
  "analyze-reference": "analyze-reference",
  generate: "generate-content",
  images: "generate-images",
  videos: "generate-videos",
  "generate-ugc-video": "generate-ugc-video",
  "transcribe-generated-video": "transcribe-generated-video",
  voiceover: "generate-voiceover",
  render: "render-final-video",
  pipeline: "pipeline",
  "clipper/source-link": "clipper-source-link",
  "clipper/analyze": "clipper-analyze",
  "clipper/render": "clipper-render",
  "clipper/render-bulk": "clipper-render-bulk",
  "clipper/render-variations": "clipper-render-variations"
};

export function jobTypeForAction(action) {
  return actionToJobType[action] || "";
}

export function buildProductionJob({ projectName, jobType, payload = {}, requestedBy = "" }) {
  if (!projectName) throw new Error("Project name is required.");
  if (!PRODUCTION_JOB_TYPES.has(jobType)) throw new Error(`Unsupported production job type: ${jobType}`);
  return {
    projectName,
    jobType,
    status: "queued",
    payload: payload && typeof payload === "object" ? payload : {},
    requestedBy: requestedBy || ""
  };
}

export const PRODUCTION_JOB_STATUSES = Object.freeze(["queued", "processing", "completed", "failed", "cancelled"]);

export function canCancelProductionJob(job) {
  return job?.status === "queued";
}

export function canRetryProductionJob(job) {
  return job?.status === "failed" || job?.status === "cancelled";
}

export function productionJobSummary(jobs = []) {
  const summary = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, total: jobs.length };
  for (const job of jobs) {
    if (Object.hasOwn(summary, job?.status)) summary[job.status] += 1;
  }
  return summary;
}

export function productionJobDuration(job, now = Date.now()) {
  if (!job?.startedAt) return 0;
  const start = Date.parse(job.startedAt);
  const end = job.completedAt ? Date.parse(job.completedAt) : Number(now);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export function workerHealth(worker, now = Date.now(), timeoutMs = 20000) {
  if (!worker?.lastSeenAt) return { status: "offline", ageMs: Infinity };
  const ageMs = Math.max(0, Number(now) - Date.parse(worker.lastSeenAt));
  if (!Number.isFinite(ageMs) || ageMs > timeoutMs) return { status: "offline", ageMs };
  return { status: worker.currentJobId ? "busy" : "online", ageMs };
}
