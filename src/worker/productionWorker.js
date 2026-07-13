import path from "node:path";
import os from "node:os";
import { loadEnv, rootDir, projectPath } from "../config.js";
import { analyzeClipperSource, downloadClipperSource, selectClipperHighlight } from "../services/clipperService.js";
import { generateContentIdeas, generateScriptPlan } from "../services/contentReplicator.js";
import { generateElevenLabsVoiceover } from "../services/elevenLabsClient.js";
import { generateSceneImages } from "../services/imageGenerator.js";
import { generateLibTvUgcVideo, generateLibTvVideos } from "../services/libtvClient.js";
import { transcribeAudio } from "../services/openaiClient.js";
import { generateImagePrompts, generateVideoPrompts } from "../services/promptGenerator.js";
import { analyzeReference } from "../services/referenceAnalyzer.js";
import { renderClipperVideo, renderFinalVideo } from "../services/remotionRenderer.js";
import { renderClipperVariations } from "../services/clipperVariations.js";
import {
  claimNextSupabaseProductionJob,
  updateSupabaseProductionJob,
  upsertSupabaseWorkerHeartbeat,
  uploadSupabaseStorageFile,
  upsertSupabaseClipCandidates,
  upsertSupabaseRenderJob
} from "../services/supabaseDb.js";
import { PRODUCTION_JOB_TYPES } from "../services/productionJobs.js";
import { transcribeGeneratedVideo } from "../services/subtitlePlanner.js";
import { extractAudio, extractFrames } from "../services/video.js";
import { fileExists, readJson, writeJson } from "../utils/files.js";
import { buildEditPlan } from "../services/editPlanBuilder.js";

loadEnv();

const port = Number(process.env.PORT || 4173);
const pollMs = Number(process.env.WORKER_POLL_MS || 5000);

async function analyzeProjectReference(project, frames = 12) {
  const projectDir = projectPath(project);
  const referenceVideo = path.join(projectDir, "reference", "reference.mp4");
  if (!fileExists(referenceVideo)) throw new Error("Local worker cannot find reference/reference.mp4 for this project.");
  const metadata = await extractFrames(referenceVideo, path.join(projectDir, "analysis", "frames"), Number(frames || 12));
  writeJson(path.join(projectDir, "analysis", "metadata.json"), metadata);
  const audioPath = await extractAudio(referenceVideo, path.join(projectDir, "analysis", "audio.wav"));
  const transcript = await transcribeAudio(audioPath);
  writeJson(path.join(projectDir, "analysis", "transcript.json"), transcript);
  const styleAnalysis = await analyzeReference({ projectDir, metadata, transcript });
  writeJson(path.join(projectDir, "analysis", "style-analysis.json"), styleAnalysis);
  writeJson(path.join(projectDir, "analysis", "reference-blueprint.json"), styleAnalysis);
  return { metadata, transcript, styleAnalysis };
}

async function generateProjectContent(project, topic) {
  if (!topic) throw new Error("Job payload missing topic.");
  const projectDir = projectPath(project);
  const metadata = readJson(path.join(projectDir, "analysis", "metadata.json"));
  const styleAnalysis = readJson(path.join(projectDir, "analysis", "style-analysis.json"));
  const contentIdeas = await generateContentIdeas({ topic, styleAnalysis });
  writeJson(path.join(projectDir, "generated", "content-ideas.json"), contentIdeas);
  const scriptPlan = await generateScriptPlan({ topic, styleAnalysis, contentIdeas });
  writeJson(path.join(projectDir, "generated", "script-plan.json"), scriptPlan);
  const imagePrompts = await generateImagePrompts({ styleAnalysis, scriptPlan });
  writeJson(path.join(projectDir, "generated", "image-prompts.json"), imagePrompts);
  const videoPrompts = await generateVideoPrompts({ styleAnalysis, scriptPlan, imagePrompts });
  writeJson(path.join(projectDir, "generated", "video-prompts.json"), videoPrompts);
  const editPlan = buildEditPlan({ metadata, styleAnalysis, scriptPlan });
  writeJson(path.join(projectDir, "generated", "edit-plan.json"), editPlan);
  return { contentIdeas, scriptPlan, imagePrompts, videoPrompts, editPlan };
}

async function recordRenders(project, result) {
  const output = result?.output;
  if (!output) return "";
  const localPath = path.join(projectPath(project), output);
  const outputUrl = await uploadSupabaseStorageFile(localPath, `projects/${project}/${output}`).catch((error) => {
    console.warn("[worker] storage upload skipped");
    return "";
  });
  await upsertSupabaseRenderJob({
    project,
    projectType: result.mode || "worker",
    name: output.replace(/^renders\//, ""),
    status: "completed",
    outputUrl
  });
  return outputUrl;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function deliverVariationOutputs({
  project,
  result,
  projectPathFor = projectPath,
  uploadFile = uploadSupabaseStorageFile,
  persistRender = upsertSupabaseRenderJob
}) {
  const projectDir = projectPathFor(project);
  for (const output of result.outputs.filter((item) => item.status === "completed")) {
    let stage = "upload";
    try {
      const outputUrl = await uploadFile(
        path.join(projectDir, output.output),
        `projects/${project}/${output.output}`
      );
      if (!outputUrl) throw new Error("storage upload did not return a public URL");

      stage = "persistence";
      const persisted = await persistRender({
        project,
        projectType: result.mode || "worker",
        name: output.output.replace(/^renders\//, ""),
        status: "completed",
        outputUrl
      });
      if (persisted?.skipped) throw new Error("render-row persistence was skipped");
      output.outputUrl = outputUrl;
    } catch (error) {
      output.status = "failed";
      output.error = `Delivery ${stage} failed: ${errorMessage(error)}`;
      output.deliveryStage = stage;
      delete output.outputUrl;
    }
  }

  result.completed = result.outputs.filter((item) => item.status === "completed").length;
  result.failed = result.outputs.filter((item) => item.status === "failed").length;
  result.outputUrl = result.outputs.find((item) => item.status === "completed")?.outputUrl || "";
  writeJson(path.join(projectDir, "clipper", "generated", "clipper-character-variations-manifest.json"), result);
  return result;
}

async function processJob(job) {
  const project = job.projectName;
  const payload = job.payload || {};
  const projectDir = projectPath(project);
  switch (job.jobType) {
    case "analyze-reference":
      return analyzeProjectReference(project, payload.frames || 12);
    case "generate-content":
      return generateProjectContent(project, payload.topic);
    case "generate-images": {
      const imagePrompts = readJson(path.join(projectDir, "generated", "image-prompts.json"));
      return generateSceneImages({ projectDir, imagePrompts, limit: payload.limit });
    }
    case "generate-videos": {
      const videoPrompts = readJson(path.join(projectDir, "generated", "video-prompts.json"));
      return generateLibTvVideos({ projectDir, videoPrompts, limit: payload.limit ?? 1, maxSeconds: payload.maxSeconds ?? 180 });
    }
    case "generate-ugc-video": {
      const blueprint = fileExists(path.join(projectDir, "analysis", "reference-blueprint.json"))
        ? readJson(path.join(projectDir, "analysis", "reference-blueprint.json"))
        : readJson(path.join(projectDir, "analysis", "style-analysis.json"));
      return generateLibTvUgcVideo({ projectDir, blueprint, maxSeconds: payload.maxSeconds || 300 });
    }
    case "transcribe-generated-video":
      return transcribeGeneratedVideo({ projectDir });
    case "generate-voiceover": {
      const scriptPlan = readJson(path.join(projectDir, "generated", "script-plan.json"));
      return generateElevenLabsVoiceover({ projectDir, scriptPlan });
    }
    case "render-final-video": {
      const result = await renderFinalVideo({ project, port, cwd: rootDir });
      result.outputUrl = await recordRenders(project, result);
      return result;
    }
    case "clipper-source-link":
      return downloadClipperSource({ projectDir, url: payload.url });
    case "clipper-analyze": {
      const result = await analyzeClipperSource({ projectDir });
      await upsertSupabaseClipCandidates(project, result.candidates || []);
      return result;
    }
    case "clipper-render": {
      const result = await renderClipperVideo({ project, port, cwd: rootDir });
      result.outputUrl = await recordRenders(project, result);
      return result;
    }
    case "clipper-render-bulk": {
      const candidatesManifest = readJson(path.join(projectDir, "clipper", "generated", "highlight-candidates.json"));
      const candidateMap = new Map((candidatesManifest.candidates || []).map((candidate) => [candidate.id, candidate]));
      const selections = (payload.highlightIds || []).map((id) => candidateMap.get(id)).filter(Boolean);
      const outputs = [];
      for (let index = 0; index < selections.length; index += 1) {
        const selection = selections[index];
        selectClipperHighlight({ projectDir, highlightId: selection.id });
        const result = await renderClipperVideo({
          project,
          port,
          cwd: rootDir,
          outputName: `clip-${String(index + 1).padStart(2, "0")}-${selection.id}.mp4`,
          outputDir: "renders/clips"
        });
        result.outputUrl = await recordRenders(project, result);
        outputs.push(result);
      }
      return { outputs };
    }
    case "clipper-render-variations": {
      const result = await renderClipperVariations({
        project,
        projectDir,
        port,
        cwd: rootDir,
        reactionIds: payload.reactionIds
      });
      return deliverVariationOutputs({ project, result });
    }
    case "pipeline":
      await analyzeProjectReference(project, payload.frames || 10);
      return generateProjectContent(project, payload.topic);
    default:
      throw new Error(`Unsupported job type: ${job.jobType}`);
  }
}

function resultOutputUrl(result) {
  return result?.outputUrl
    || result?.outputs?.find((output) => output.status === "completed")?.outputUrl
    || result?.output
    || result?.url
    || "";
}

export async function runWorkerTick({
  claimJob = claimNextSupabaseProductionJob,
  updateJob = updateSupabaseProductionJob,
  processJob: runJob = processJob
} = {}) {
  const job = await claimJob();
  if (!job) return false;
  console.log(`[worker] processing ${job.id} ${job.jobType} for ${job.projectName}`);
  try {
    const result = await runJob(job);
    const variationFailed = result?.mode === "clipper-character-variations" && result.failed > 0;
    await updateJob(job.id, {
      status: variationFailed ? "failed" : "completed",
      outputUrl: resultOutputUrl(result),
      error: variationFailed ? `${result.failed} variation output${result.failed === 1 ? "" : "s"} failed.` : "",
      result
    });
    console.log(`[worker] ${variationFailed ? "failed" : "completed"} ${job.id}`);
  } catch (error) {
    await updateJob(job.id, {
      status: "failed",
      error: errorMessage(error)
    });
    console.error(`[worker] failed ${job.id}`);
  }
  return true;
}

export function createProductionWorker({
  workerId = process.env.CONTENTFLOW_WORKER_ID || os.hostname(),
  workerName = process.env.CONTENTFLOW_WORKER_NAME || os.hostname(),
  hostname = os.hostname(),
  capabilities = Array.from(PRODUCTION_JOB_TYPES),
  claimJob = claimNextSupabaseProductionJob,
  updateJob = updateSupabaseProductionJob,
  updateHeartbeat = upsertSupabaseWorkerHeartbeat,
  processJob: runJob = processJob,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  heartbeatMs = 5000
} = {}) {
  let currentJobId = "";
  let heartbeatTimer = null;
  let heartbeatTail = Promise.resolve();
  let startPromise = null;
  let lifecycleVersion = 0;

  function heartbeat() {
    const heartbeatRecord = {
      workerId,
      workerName,
      hostname,
      status: currentJobId ? "busy" : "online",
      currentJobId,
      capabilities: Array.from(capabilities),
      lastSeenAt: now().toISOString()
    };
    const write = heartbeatTail.then(
      () => updateHeartbeat(heartbeatRecord),
      () => updateHeartbeat(heartbeatRecord)
    );
    heartbeatTail = write.catch(() => {});
    return write;
  }

  async function tick() {
    const job = await claimJob();
    if (!job) {
      await heartbeat();
      return false;
    }

    currentJobId = job.id;
    let lastPersistedProgress = 0;
    const persistMilestone = async (patch) => {
      await updateJob(job.id, patch);
      if (Number.isFinite(patch.progress)) lastPersistedProgress = patch.progress;
    };
    try {
      await heartbeat();
      await persistMilestone({
        status: "processing",
        progress: 25,
        progressMessage: "Preparing production inputs"
      });
      const result = await runJob(job);
      const variationFailed = result?.mode === "clipper-character-variations" && result.failed > 0;
      if (variationFailed) {
        await persistMilestone({
          status: "failed",
          progress: lastPersistedProgress,
          outputUrl: resultOutputUrl(result),
          error: `${result.failed} variation output${result.failed === 1 ? "" : "s"} failed.`,
          result
        });
        return true;
      }

      await persistMilestone({
        status: "processing",
        progress: 75,
        progressMessage: "Production operation completed",
        result
      });
      await persistMilestone({
        status: "processing",
        progress: 90,
        progressMessage: "Saving output records",
        result
      });
      await persistMilestone({
        status: "completed",
        progress: 100,
        progressMessage: "Completed",
        outputUrl: result?.outputUrl || "",
        result
      });
      return true;
    } catch (error) {
      await updateJob(job.id, {
        status: "failed",
        progress: lastPersistedProgress,
        error: errorMessage(error)
      });
      return true;
    } finally {
      currentJobId = "";
      await heartbeat();
    }
  }

  function start() {
    if (heartbeatTimer !== null) return Promise.resolve();
    if (startPromise) return startPromise;

    const startVersion = lifecycleVersion;
    const startup = (async () => {
      await heartbeat();
      if (startVersion !== lifecycleVersion || heartbeatTimer !== null) return;
      heartbeatTimer = setIntervalFn(() => {
        void heartbeat().catch(() => {});
      }, heartbeatMs);
    })();
    startPromise = startup;
    return startup.finally(() => {
      if (startPromise === startup) startPromise = null;
    });
  }

  function shutdown() {
    lifecycleVersion += 1;
    startPromise = null;
    if (heartbeatTimer === null) return;
    clearIntervalFn(heartbeatTimer);
    heartbeatTimer = null;
  }

  return Object.freeze({
    workerId,
    workerName,
    hostname,
    capabilities: Array.from(capabilities),
    heartbeat,
    tick,
    start,
    shutdown
  });
}

export async function runWorker({ once = false, worker, ...dependencies } = {}) {
  const runtime = worker || createProductionWorker(dependencies);
  console.log(`[worker] ContentFlow production worker started${once ? " (once)" : ""}`);
  await runtime.start();
  try {
    do {
      const processed = await runtime.tick();
      if (once) break;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (true);
  } finally {
    runtime.shutdown();
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runWorker({ once: process.argv.includes("--once") }).catch((error) => {
    console.error("[worker] fatal runtime error");
    process.exitCode = 1;
  });
}
