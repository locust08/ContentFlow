import path from "node:path";
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

loadEnv();

const port = Number(process.env.PORT || 4173);
const pollMs = Number(process.env.WORKER_POLL_MS || 5000);

function transcriptText(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.text || value?.transcript || value?.segments?.map((segment) => segment.text).join(" ") || "").trim();
}

function localTranscript(projectDir, manual = "") {
  if (manual) return String(manual).trim();
  const transcriptPath = path.join(projectDir, "analysis", "transcript.json");
  return fileExists(transcriptPath) ? transcriptText(readJson(transcriptPath)) : "";
}

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
    console.warn(`[worker] storage upload skipped: ${error.message}`);
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

export async function processJob(job) {
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
    case "generate-market-report": {
      if (!payload.campaignId) throw new Error("Market report job is missing campaignId.");
      const intelligence = await supabaseCampaignIntelligence(payload.campaignId);
      if (!intelligence.campaignBrief?.id) throw new Error("Save the campaign brief before market analysis.");
      const selected = payload.sourceIds?.length
        ? intelligence.researchSources.filter((source) => payload.sourceIds.includes(source.id))
        : intelligence.researchSources;
      const generated = await generateMarketReport({ brief: intelligence.campaignBrief.brief || intelligence.campaignBrief, sources: selected });
      const report = await upsertSupabaseMarketReport({
        ...generated,
        id: `report-${payload.campaignId}-${Date.now()}`,
        briefId: intelligence.campaignBrief.id,
        campaignId: payload.campaignId,
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      writeJson(path.join(projectDir, "analysis", "market-report.json"), report);
      return report;
    }
    case "analyze-ugc-script": {
      const transcript = localTranscript(projectDir, payload.manualTranscript);
      if (!transcript) throw new Error("Analyze the reference video or provide a manual transcript first.");
      const analysis = await analyzeUgcInspiration({ transcript });
      writeJson(path.join(projectDir, "analysis", "ugc-script-analysis.json"), analysis);
      return analysis;
    }
    case "generate-ugc-script": {
      const summaries = await supabaseProjectScriptBundle(project);
      const campaignId = payload.campaignId || summaries.ugcScript?.campaignId || payload.projectCampaignId;
      if (!campaignId) throw new Error("Script generation job is missing campaignId.");
      const intelligence = await supabaseCampaignIntelligence(campaignId);
      const report = intelligence.marketReport;
      if (!report) throw new Error("Generate a market report before the UGC script.");
      const transcript = localTranscript(projectDir, payload.manualTranscript);
      const generated = await generateUgcScript({
        title: `${project} UGC Script`,
        transcript,
        scriptwriterInput: report.scriptwriterInput,
        marketReportId: report.id,
        reportStatus: report.status,
        isAdmin: Boolean(payload.overrideReason),
        overrideReason: payload.overrideReason
      });
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
      const savedScript = await upsertSupabaseUgcScript(created.script);
      const savedVersion = await upsertSupabaseUgcScriptVersion(created.version);
      script = { ...created.script, currentVersionId: savedVersion.id };
      writeJson(path.join(projectDir, "generated", "ugc-script.json"), script);
      writeJson(path.join(projectDir, "generated", "ugc-script-versions.json"), { versions: [...summaries.scriptVersions, savedVersion] });
      return { script: savedScript, version: savedVersion };
    }
    case "generate-ugc-video": {
      const scriptBundle = await supabaseProjectScriptBundle(project);
      const script = scriptBundle.ugcScript || (fileExists(path.join(projectDir, "generated", "ugc-script.json")) ? readJson(path.join(projectDir, "generated", "ugc-script.json")) : null);
      if (!script) throw new Error("Approved UGC script is missing.");
      const versionId = script.currentVersionId || script.versionId;
      if (payload.scriptVersionId && versionId && payload.scriptVersionId !== versionId) throw new Error("Queued script version is no longer active. Queue production again.");
      assertVideoGenerationEligible(script, {
        isAdmin: Boolean(payload.override?.overrideReason || payload.override?.reason),
        overrideReason: payload.override?.overrideReason || payload.override?.reason || "",
        versionId,
        actorId: job.requestedBy || "worker"
      });
      const intelligence = script.campaignId ? await supabaseCampaignIntelligence(script.campaignId) : null;
      const blueprint = fileExists(path.join(projectDir, "analysis", "reference-blueprint.json"))
        ? readJson(path.join(projectDir, "analysis", "reference-blueprint.json"))
        : readJson(path.join(projectDir, "analysis", "style-analysis.json"));
      return generateLibTvUgcVideo({ projectDir, blueprint, script, campaignBrief: intelligence?.campaignBrief?.brief || intelligence?.campaignBrief || null, maxSeconds: payload.maxSeconds || 300 });
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
    case "clipper-render-variations":
      throw new Error("Worker variation rendering is queued but not automated yet; use local dashboard render for this job type.");
    case "pipeline":
      await analyzeProjectReference(project, payload.frames || 10);
      return generateProjectContent(project, payload.topic);
    default:
      throw new Error(`Unsupported job type: ${job.jobType}`);
  }
}

async function tick() {
  const job = await claimNextSupabaseProductionJob();
  if (!job) return false;
  console.log(`[worker] processing ${job.id} ${job.jobType} for ${job.projectName}`);
  try {
    const result = await processJob(job);
    await updateSupabaseProductionJob(job.id, {
      status: "completed",
      outputUrl: result?.outputUrl || result?.output || result?.url || ""
    });
    console.log(`[worker] completed ${job.id}`);
  } catch (error) {
    await updateSupabaseProductionJob(job.id, {
      status: "failed",
      error: error.message
    });
    console.error(`[worker] failed ${job.id}: ${error.message}`);
  }
  return true;
}

export async function runWorker({ once = false } = {}) {
  console.log(`[worker] ContentFlow production worker started${once ? " (once)" : ""}`);
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
