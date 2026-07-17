import path from "node:path";
import fs from "node:fs/promises";
import { loadEnv, rootDir, projectPath } from "../config.js";
import { analyzeClipperSource, downloadClipperSource, selectClipperHighlight } from "../services/clipperService.js";
import { generateContentIdeas, generateScriptPlan } from "../services/contentReplicator.js";
import { generateElevenLabsVoiceover } from "../services/elevenLabsClient.js";
import { generateSceneImages } from "../services/imageGenerator.js";
import { generateLibTvUgcVideo, generateLibTvVideos } from "../services/libtvClient.js";
import { transcribeAudio } from "../services/openaiClient.js";
import { generateImagePrompts, generateVideoPrompts } from "../services/promptGenerator.js";
import { analyzeReference } from "../services/referenceAnalyzer.js";
import { generateMarketReport } from "../services/marketIntelligence.js";
import {
  analyzeUgcInspiration,
  assertVideoGenerationEligible,
  createScriptVersion,
  generateUgcScript,
  selectHook
} from "../services/ugcScriptStudio.js";
import { renderClipperVideo, renderFinalVideo } from "../services/remotionRenderer.js";
import {
  claimNextSupabaseProductionJob,
  updateSupabaseProductionJob,
  uploadSupabaseStorageFile,
  supabaseCampaignIntelligence,
  supabaseProjectScriptBundle,
  upsertSupabaseClipCandidates,
  upsertSupabaseMarketReport,
  upsertSupabaseRenderJob,
  upsertSupabaseUgcScript,
  upsertSupabaseUgcScriptVersion
} from "../services/supabaseDb.js";
import { transcribeGeneratedVideo } from "../services/subtitlePlanner.js";
import { extractAudio, extractFrames } from "../services/video.js";
import { fileExists, readJson, writeJson } from "../utils/files.js";
import { buildEditPlan } from "../services/editPlanBuilder.js";
import { createCloudflareProductionClient } from "../services/cloudflareProductionClient.js";
import { createProductionQueue } from "./productionQueue.js";

loadEnv();

const port = Number(process.env.PORT || 4173);
const pollMs = Number(process.env.WORKER_POLL_MS || 5000);
const cloudflareProduction = createCloudflareProductionClient();
const productionQueue = createProductionQueue({
  cloudflareClient: cloudflareProduction,
  claimLegacy: claimNextSupabaseProductionJob,
  updateLegacy: updateSupabaseProductionJob
});

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw signal.reason instanceof Error ? signal.reason : new Error("Production job was aborted after losing its lease.");
}

async function runAbortable(signal, operation) {
  throwIfAborted(signal);
  const result = await operation();
  throwIfAborted(signal);
  return result;
}

function writeJsonAbortable(signal, filePath, value) {
  throwIfAborted(signal);
  writeJson(filePath, value);
  throwIfAborted(signal);
}

function transcriptText(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.text || value?.transcript || value?.segments?.map((segment) => segment.text).join(" ") || "").trim();
}

function localTranscript(projectDir, manual = "") {
  if (manual) return String(manual).trim();
  const transcriptPath = path.join(projectDir, "analysis", "transcript.json");
  return fileExists(transcriptPath) ? transcriptText(readJson(transcriptPath)) : "";
}

async function analyzeProjectReference(project, frames = 12, signal) {
  const projectDir = projectPath(project);
  const referenceVideo = path.join(projectDir, "reference", "reference.mp4");
  if (!fileExists(referenceVideo)) throw new Error("Local worker cannot find reference/reference.mp4 for this project.");
  const metadata = await runAbortable(signal, () => extractFrames(referenceVideo, path.join(projectDir, "analysis", "frames"), Number(frames || 12)));
  writeJsonAbortable(signal, path.join(projectDir, "analysis", "metadata.json"), metadata);
  const audioPath = await runAbortable(signal, () => extractAudio(referenceVideo, path.join(projectDir, "analysis", "audio.wav")));
  const transcript = await runAbortable(signal, () => transcribeAudio(audioPath));
  writeJsonAbortable(signal, path.join(projectDir, "analysis", "transcript.json"), transcript);
  const styleAnalysis = await runAbortable(signal, () => analyzeReference({ projectDir, metadata, transcript, signal }));
  writeJsonAbortable(signal, path.join(projectDir, "analysis", "style-analysis.json"), styleAnalysis);
  writeJsonAbortable(signal, path.join(projectDir, "analysis", "reference-blueprint.json"), styleAnalysis);
  return { metadata, transcript, styleAnalysis };
}

async function generateProjectContent(project, topic, signal) {
  if (!topic) throw new Error("Job payload missing topic.");
  const projectDir = projectPath(project);
  const metadata = readJson(path.join(projectDir, "analysis", "metadata.json"));
  const styleAnalysis = readJson(path.join(projectDir, "analysis", "style-analysis.json"));
  const contentIdeas = await runAbortable(signal, () => generateContentIdeas({ topic, styleAnalysis, signal }));
  writeJsonAbortable(signal, path.join(projectDir, "generated", "content-ideas.json"), contentIdeas);
  const scriptPlan = await runAbortable(signal, () => generateScriptPlan({ topic, styleAnalysis, contentIdeas, signal }));
  writeJsonAbortable(signal, path.join(projectDir, "generated", "script-plan.json"), scriptPlan);
  const imagePrompts = await runAbortable(signal, () => generateImagePrompts({ styleAnalysis, scriptPlan, signal }));
  writeJsonAbortable(signal, path.join(projectDir, "generated", "image-prompts.json"), imagePrompts);
  const videoPrompts = await runAbortable(signal, () => generateVideoPrompts({ styleAnalysis, scriptPlan, imagePrompts, signal }));
  writeJsonAbortable(signal, path.join(projectDir, "generated", "video-prompts.json"), videoPrompts);
  throwIfAborted(signal);
  const editPlan = buildEditPlan({ metadata, styleAnalysis, scriptPlan });
  writeJsonAbortable(signal, path.join(projectDir, "generated", "edit-plan.json"), editPlan);
  return { contentIdeas, scriptPlan, imagePrompts, videoPrompts, editPlan };
}

async function recordRenders(project, result, signal, cloudflareClient = cloudflareProduction) {
  const output = result?.output;
  if (!output) return "";
  const localPath = path.join(projectPath(project), output);
  let outputUrl = "";
  if (cloudflareClient) {
    const asset = await runAbortable(signal, () => cloudflareClient.uploadProjectAsset({
      projectName: project,
      assetPath: output.replace(/\\/g, "/"),
      localPath,
      contentType: "video/mp4",
      kind: "final-render",
      signal
    }));
    outputUrl = asset?.url || "";
  } else {
    outputUrl = await runAbortable(signal, () => uploadSupabaseStorageFile(localPath, `projects/${project}/${output}`).catch((error) => {
      console.warn(`[worker] storage upload skipped: ${error.message}`);
      return "";
    }));
    await runAbortable(signal, () => upsertSupabaseRenderJob({
      project,
      projectType: result.mode || "worker",
      name: output.replace(/^renders\//, ""),
      status: "completed",
      outputUrl
    }));
  }
  return outputUrl;
}

const hostedSourceKinds = new Set([
  "reference-video",
  "product-image",
  "character-reference",
  "clipper-source",
  "reaction-character"
]);

const singletonHostedSourceKinds = new Set([
  "reference-video",
  "product-image",
  "character-reference",
  "clipper-source"
]);

function canonicalAssetName(value, fallback) {
  const leaf = String(value || fallback).split(/[\\/]/).at(-1);
  return String(leaf || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

export function canonicalHostedAssetPath(projectDir, asset = {}) {
  if (!hostedSourceKinds.has(asset.kind)) return null;
  let relativePath;
  if (asset.kind === "reference-video") {
    relativePath = path.join("reference", "reference.mp4");
  } else if (asset.kind === "product-image") {
    relativePath = path.join("product", canonicalAssetName(asset.name, "product-image"));
  } else if (asset.kind === "character-reference") {
    relativePath = path.join("character", canonicalAssetName(asset.name, "character-reference"));
  } else if (asset.kind === "clipper-source") {
    relativePath = path.join("clipper", "source", "source-video.mp4");
  } else {
    const fileName = canonicalAssetName(asset.name, "reaction-character");
    const extension = path.extname(fileName);
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;
    const assetId = canonicalAssetName(asset.id, "reaction");
    relativePath = path.join("clipper", "reaction", `${stem}--${assetId}${extension}`);
  }
  const base = path.resolve(projectDir);
  const destination = path.resolve(base, relativePath);
  if (!destination.startsWith(`${base}${path.sep}`)) throw new Error("Hosted asset destination must remain inside the project folder.");
  return destination;
}

export async function ensureHostedSourceAssets({ projectDir, assets = [], cloudflareClient, signal }) {
  if (!cloudflareClient?.downloadAsset) throw new Error("Cloudflare asset download client is required.");
  const hydratedSingletonKinds = new Set();
  for (const asset of assets) {
    throwIfAborted(signal);
    if (singletonHostedSourceKinds.has(asset.kind)) {
      if (hydratedSingletonKinds.has(asset.kind)) continue;
      hydratedSingletonKinds.add(asset.kind);
    }
    const localPath = canonicalHostedAssetPath(projectDir, asset);
    if (!localPath) continue;
    if (!asset.id) throw new Error(`Hosted ${asset.kind} asset is missing its D1 asset ID.`);
    const temporaryPath = `${localPath}.download`;
    await fs.rm(temporaryPath, { force: true });
    try {
      await runAbortable(signal, () => cloudflareClient.downloadAsset({ assetId: asset.id, localPath: temporaryPath, signal }));
      throwIfAborted(signal);
      await fs.rename(temporaryPath, localPath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
  }
}

function generatedMediaFiles(jobType, result = {}) {
  let files = [];
  if (jobType === "generate-images") {
    files = (result.images || []).map((item) => item?.file);
  } else if (jobType === "generate-videos") {
    files = (result.videos || []).flatMap((item) => (item?.downloaded || []).map((media) => media?.file));
  } else if (jobType === "generate-ugc-video") {
    files = [result.output, ...(result.downloaded || []).map((item) => item?.file)];
  } else if (jobType === "generate-voiceover") {
    files = [result.file];
  }
  return [...new Set(files.map((file) => String(file || "").replace(/\\/g, "/")).filter(Boolean))];
}

function generatedMediaType(file) {
  const extension = path.extname(file).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4"
  };
  return contentTypes[extension] || "application/octet-stream";
}

function generatedMediaKind(contentType) {
  if (contentType.startsWith("image/")) return "generated-image";
  if (contentType.startsWith("video/")) return "generated-video";
  if (contentType.startsWith("audio/")) return "generated-audio";
  return "generated-output";
}

async function publishHostedMedia({ project, projectDir, jobType, result, cloudflareClient, signal }) {
  if (!cloudflareClient) return result;
  if (!cloudflareClient.uploadProjectAsset) throw new Error("Cloudflare asset upload client is required.");
  const base = path.resolve(projectDir);
  const hostedOutputs = [];
  for (const file of generatedMediaFiles(jobType, result)) {
    throwIfAborted(signal);
    const localPath = path.resolve(base, file);
    if (!localPath.startsWith(`${base}${path.sep}`)) throw new Error("Generated media output must remain inside the project folder.");
    const contentType = generatedMediaType(file);
    const kind = generatedMediaKind(contentType);
    const asset = await runAbortable(signal, () => cloudflareClient.uploadProjectAsset({
      projectName: project,
      assetPath: file,
      localPath,
      contentType,
      kind,
      signal
    }));
    hostedOutputs.push({
      assetId: String(asset?.id || ""),
      file,
      kind,
      contentType,
      url: String(asset?.url || "")
    });
  }
  return { ...result, hostedOutputs };
}

const defaultSupabase = {
  campaignIntelligence: supabaseCampaignIntelligence,
  projectScriptBundle: supabaseProjectScriptBundle,
  upsertClipCandidates: upsertSupabaseClipCandidates,
  upsertMarketReport: upsertSupabaseMarketReport,
  upsertUgcScript: upsertSupabaseUgcScript,
  upsertUgcScriptVersion: upsertSupabaseUgcScriptVersion
};

const defaultProductionServices = {
  analyzeClipperSource,
  generateElevenLabsVoiceover,
  generateLibTvVideos,
  generateLibTvUgcVideo,
  generateSceneImages,
  generateMarketReport,
  generateUgcScript,
  renderClipperVideo,
  renderFinalVideo
};

function slugify(text) {
  return String(text || "clip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "clip";
}

function hostedReactionAssets(projectDir, hostedContext) {
  return (hostedContext?.assets || [])
    .filter((asset) => asset.kind === "reaction-character")
    .map((asset) => {
      const localPath = canonicalHostedAssetPath(projectDir, asset);
      return {
        ...asset,
        name: asset.name || path.basename(localPath),
        path: path.relative(projectDir, localPath).replace(/\\/g, "/"),
        type: String(asset.contentType || asset.mediaType || "").startsWith("video/")
          || /\.(mp4|mov|webm)$/i.test(localPath)
          ? "video"
          : "image"
      };
    });
}

export function createProductionJobProcessor({
  cloudflareClient = cloudflareProduction,
  services = {},
  supabase = {}
} = {}) {
  const runtime = { ...defaultProductionServices, ...services };
  const legacy = { ...defaultSupabase, ...supabase };

  return async function processProductionJob(job, { signal } = {}) {
  throwIfAborted(signal);
  const project = job.projectName;
  const payload = job.payload || {};
  const projectDir = projectPath(project);
  const hostedContext = cloudflareClient
    ? await runAbortable(signal, () => cloudflareClient.getProjectContext(project, { signal }))
    : null;
  if (hostedContext) {
    await ensureHostedSourceAssets({ projectDir, assets: hostedContext.assets, cloudflareClient, signal });
  }
  switch (job.jobType) {
    case "analyze-reference":
      return analyzeProjectReference(project, payload.frames || 12, signal);
    case "generate-content":
      return generateProjectContent(project, payload.topic, signal);
    case "generate-images": {
      const imagePrompts = readJson(path.join(projectDir, "generated", "image-prompts.json"));
      const result = await runAbortable(signal, () => runtime.generateSceneImages({ projectDir, imagePrompts, limit: payload.limit, signal }));
      return publishHostedMedia({ project, projectDir, jobType: job.jobType, result, cloudflareClient, signal });
    }
    case "generate-videos": {
      const videoPrompts = readJson(path.join(projectDir, "generated", "video-prompts.json"));
      const result = await runAbortable(signal, () => runtime.generateLibTvVideos({ projectDir, videoPrompts, limit: payload.limit ?? 1, maxSeconds: payload.maxSeconds ?? 180, signal }));
      return publishHostedMedia({ project, projectDir, jobType: job.jobType, result, cloudflareClient, signal });
    }
    case "generate-market-report": {
      if (!payload.campaignId) throw new Error("Market report job is missing campaignId.");
      const intelligence = hostedContext?.campaignIntelligence
        || await runAbortable(signal, () => legacy.campaignIntelligence(payload.campaignId, { signal }));
      if (!intelligence.campaignBrief?.id) throw new Error("Save the campaign brief before market analysis.");
      const selected = payload.sourceIds?.length
        ? intelligence.researchSources.filter((source) => payload.sourceIds.includes(source.id))
        : intelligence.researchSources;
      const generated = await runAbortable(signal, () => runtime.generateMarketReport({ brief: intelligence.campaignBrief.brief || intelligence.campaignBrief, sources: selected, signal }));
      const reportInput = {
        ...generated,
        id: `report-${payload.campaignId}-${Date.now()}`,
        briefId: intelligence.campaignBrief.id,
        campaignId: payload.campaignId,
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const report = hostedContext
        ? reportInput
        : await runAbortable(signal, () => legacy.upsertMarketReport(reportInput, { signal }));
      writeJsonAbortable(signal, path.join(projectDir, "analysis", "market-report.json"), report);
      return report;
    }
    case "analyze-ugc-script": {
      const transcript = localTranscript(projectDir, payload.manualTranscript);
      if (!transcript) throw new Error("Analyze the reference video or provide a manual transcript first.");
      const analysis = await runAbortable(signal, () => analyzeUgcInspiration({ transcript, signal }));
      writeJsonAbortable(signal, path.join(projectDir, "analysis", "ugc-script-analysis.json"), analysis);
      return analysis;
    }
    case "generate-ugc-script": {
      const summaries = hostedContext?.scriptBundle
        || await runAbortable(signal, () => legacy.projectScriptBundle(project, { signal }));
      const campaignId = payload.campaignId || summaries.ugcScript?.campaignId || payload.projectCampaignId;
      if (!campaignId) throw new Error("Script generation job is missing campaignId.");
      const intelligence = hostedContext?.campaignIntelligence
        || await runAbortable(signal, () => legacy.campaignIntelligence(campaignId, { signal }));
      const report = intelligence.marketReport;
      if (!report) throw new Error("Generate a market report before the UGC script.");
      const transcript = localTranscript(projectDir, payload.manualTranscript);
      const generated = await runAbortable(signal, () => runtime.generateUgcScript({
        title: `${project} UGC Script`,
        transcript,
        scriptwriterInput: report.scriptwriterInput,
        marketReportId: report.id,
        reportStatus: report.status,
        isAdmin: Boolean(payload.overrideReason),
        overrideReason: payload.overrideReason,
        signal
      }));
      const now = new Date().toISOString();
      let script = selectHook({
        ...generated,
        id: summaries.ugcScript?.id || `script-${project}`,
        projectName: project,
        campaignId,
        currentVersionNumber: summaries.ugcScript?.currentVersionNumber || 0,
        createdAt: summaries.ugcScript?.createdAt || now,
        updatedAt: now
      }, generated.hooks[0].id);
      const analysisPath = path.join(projectDir, "analysis", "ugc-script-analysis.json");
      const content = { ...script, scriptAnalysis: fileExists(analysisPath) ? readJson(analysisPath) : null };
      const created = createScriptVersion({ script, versions: summaries.scriptVersions, content, changeNote: "Generated by local production worker", createdBy: job.requestedBy || "worker", now });
      const savedScript = hostedContext
        ? created.script
        : await runAbortable(signal, () => legacy.upsertUgcScript(created.script, { signal }));
      const savedVersion = hostedContext
        ? created.version
        : await runAbortable(signal, () => legacy.upsertUgcScriptVersion(created.version, { signal }));
      script = { ...created.script, currentVersionId: savedVersion.id };
      writeJsonAbortable(signal, path.join(projectDir, "generated", "ugc-script.json"), script);
      writeJsonAbortable(signal, path.join(projectDir, "generated", "ugc-script-versions.json"), { versions: [...summaries.scriptVersions, savedVersion] });
      return { script: savedScript, version: savedVersion };
    }
    case "generate-ugc-video": {
      const scriptBundle = hostedContext?.scriptBundle
        || await runAbortable(signal, () => legacy.projectScriptBundle(project, { signal }));
      const script = scriptBundle.ugcScript || (fileExists(path.join(projectDir, "generated", "ugc-script.json")) ? readJson(path.join(projectDir, "generated", "ugc-script.json")) : null);
      if (!script) throw new Error("Approved UGC script is missing.");
      const versionId = script.currentVersionId || script.versionId;
      const queuedVersionIsStale = payload.scriptVersionId
        && ((hostedContext && !versionId) || (versionId && payload.scriptVersionId !== versionId));
      if (queuedVersionIsStale) throw new Error("Queued script version is no longer active. Queue production again.");
      assertVideoGenerationEligible(script, {
        isAdmin: Boolean(payload.override?.overrideReason || payload.override?.reason),
        overrideReason: payload.override?.overrideReason || payload.override?.reason || "",
        versionId,
        actorId: job.requestedBy || "worker"
      });
      const intelligence = script.campaignId
        ? hostedContext?.campaignIntelligence
          || await runAbortable(signal, () => legacy.campaignIntelligence(script.campaignId, { signal }))
        : null;
      const blueprint = fileExists(path.join(projectDir, "analysis", "reference-blueprint.json"))
        ? readJson(path.join(projectDir, "analysis", "reference-blueprint.json"))
        : readJson(path.join(projectDir, "analysis", "style-analysis.json"));
      const result = await runAbortable(signal, () => runtime.generateLibTvUgcVideo({
        projectDir,
        blueprint,
        script,
        campaignBrief: intelligence?.campaignBrief?.brief || intelligence?.campaignBrief || null,
        maxSeconds: payload.maxSeconds || 300,
        signal
      }));
      return publishHostedMedia({ project, projectDir, jobType: job.jobType, result, cloudflareClient, signal });
    }
    case "transcribe-generated-video":
      return runAbortable(signal, () => transcribeGeneratedVideo({ projectDir, signal }));
    case "generate-voiceover": {
      const scriptPlan = readJson(path.join(projectDir, "generated", "script-plan.json"));
      const result = await runAbortable(signal, () => runtime.generateElevenLabsVoiceover({ projectDir, scriptPlan, signal }));
      return publishHostedMedia({ project, projectDir, jobType: job.jobType, result, cloudflareClient, signal });
    }
    case "render-final-video": {
      const result = await runAbortable(signal, () => runtime.renderFinalVideo({ project, port, cwd: rootDir, signal }));
      result.outputUrl = await recordRenders(project, result, signal, cloudflareClient);
      return result;
    }
    case "clipper-source-link":
      return runAbortable(signal, () => downloadClipperSource({ projectDir, url: payload.url, signal }));
    case "clipper-analyze": {
      const result = await runAbortable(signal, () => runtime.analyzeClipperSource({ projectDir, signal }));
      if (!hostedContext) {
        await runAbortable(signal, () => legacy.upsertClipCandidates(project, result.candidates || [], { signal }));
      }
      return result;
    }
    case "clipper-render": {
      const result = await runAbortable(signal, () => runtime.renderClipperVideo({ project, port, cwd: rootDir, signal }));
      result.outputUrl = await recordRenders(project, result, signal, cloudflareClient);
      return result;
    }
    case "clipper-render-bulk": {
      const candidatesManifest = readJson(path.join(projectDir, "clipper", "generated", "highlight-candidates.json"));
      const candidateMap = new Map((candidatesManifest.candidates || []).map((candidate) => [candidate.id, candidate]));
      const selections = (payload.highlightIds || []).map((id) => candidateMap.get(id)).filter(Boolean);
      const outputs = [];
      for (let index = 0; index < selections.length; index += 1) {
        throwIfAborted(signal);
        const selection = selections[index];
        selectClipperHighlight({ projectDir, highlightId: selection.id });
        throwIfAborted(signal);
        const result = await runAbortable(signal, () => runtime.renderClipperVideo({
          project,
          port,
          cwd: rootDir,
          outputName: `clip-${String(index + 1).padStart(2, "0")}-${selection.id}.mp4`,
          outputDir: "renders/clips",
          signal
        }));
        result.outputUrl = await recordRenders(project, result, signal, cloudflareClient);
        outputs.push(result);
      }
      return { outputs };
    }
    case "clipper-render-variations": {
      const selected = readJson(path.join(projectDir, "clipper", "generated", "selected-highlight.json"));
      const reactionMap = new Map(hostedReactionAssets(projectDir, hostedContext).map((reaction) => [reaction.id, reaction]));
      const selectedReactions = (payload.reactionIds || []).map((id) => reactionMap.get(id)).filter(Boolean);
      if (!selectedReactions.length) throw new Error("Select one or more reaction characters before rendering variations.");

      const outputs = [];
      for (let index = 0; index < selectedReactions.length; index += 1) {
        throwIfAborted(signal);
        const reaction = selectedReactions[index];
        const rank = String(index + 1).padStart(2, "0");
        const outputName = `char-${rank}-${slugify(path.parse(reaction.name || reaction.id).name)}__clip-${slugify(selected.title || selected.id)}.mp4`;
        try {
          const render = await runAbortable(signal, () => runtime.renderClipperVideo({
            project,
            port,
            cwd: rootDir,
            outputName,
            outputDir: "renders/clips",
            reactionAsset: reaction,
            signal
          }));
          render.outputUrl = await recordRenders(project, render, signal, cloudflareClient);
          outputs.push({
            reactionId: reaction.id,
            reactionName: reaction.name,
            highlightId: selected.id,
            title: selected.title,
            output: render.output,
            outputUrl: render.outputUrl,
            status: "completed",
            clipStart: render.clipStart,
            clipEnd: render.clipEnd
          });
        } catch (error) {
          throwIfAborted(signal);
          outputs.push({
            reactionId: reaction.id,
            reactionName: reaction.name,
            highlightId: selected.id,
            title: selected.title,
            output: path.join("renders", "clips", outputName).replace(/\\/g, "/"),
            outputUrl: "",
            status: "failed",
            error: error.message
          });
        }
      }
      const result = {
        renderedAt: new Date().toISOString(),
        mode: "clipper-character-variations",
        selectedHighlight: selected,
        count: outputs.length,
        completed: outputs.filter((output) => output.status === "completed").length,
        failed: outputs.filter((output) => output.status === "failed").length,
        outputs
      };
      writeJsonAbortable(signal, path.join(projectDir, "clipper", "generated", "clipper-character-variations-manifest.json"), result);
      return result;
    }
    case "pipeline":
      await analyzeProjectReference(project, payload.frames || 10, signal);
      return generateProjectContent(project, payload.topic, signal);
    default:
      throw new Error(`Unsupported job type: ${job.jobType}`);
  }
  };
}

export const processJob = createProductionJobProcessor();

export function createProductionWorkerTick({
  queue = productionQueue,
  processJob: processClaimedJob = processJob,
  log = console.log,
  logError = console.error
} = {}) {
  return async function tick() {
    const job = await queue.claim();
    if (!job) return false;
    log(`[worker] processing ${job.id} ${job.jobType} for ${job.projectName}`);

    let result;
    try {
      result = await queue.run(job, (signal) => processClaimedJob(job, { signal }));
    } catch (error) {
      await queue.fail(job, error);
      logError(`[worker] failed ${job.id}: ${error.message}`);
      return true;
    }

    try {
      await queue.complete(job, {
        outputUrl: result?.outputUrl || result?.output || result?.url || "",
        result
      });
      log(`[worker] completed ${job.id}`);
    } catch (error) {
      logError(`[worker] completion deferred for retry ${job.id}: ${error.message}`);
    }
    return true;
  };
}

const tick = createProductionWorkerTick();

export async function runWorker({ once = false } = {}) {
  console.log(`[worker] ContentFlow production worker started${once ? " (once)" : ""} (${cloudflareProduction ? "Cloudflare" : "legacy"} queue)`);
  do {
    const processed = await tick();
    if (once) break;
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (true);
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  runWorker({ once: process.argv.includes("--once") }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
