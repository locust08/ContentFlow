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
  "generate-market-report",
  "analyze-ugc-script",
  "generate-ugc-script",
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
  "clipper/render-variations": "clipper-render-variations",
  "market-reports/generate": "generate-market-report",
  "ugc-script/analyze": "analyze-ugc-script",
  "ugc-script/generate": "generate-ugc-script"
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
