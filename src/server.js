import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, URL } from "node:url";
import { loadEnv, projectPath, projectsDir, rootDir } from "./config.js";
import { createFolder, createProject, deleteFolder, deleteProject, getProjectMeta, readFolders, renameFolder, updateProjectMeta } from "./services/project.js";
import { createCampaign, createClient, readOrganization } from "./services/organization.js";
import { canAccessCampaign, canAccessProject, canEditCampaign, filterMediaForUser, filterProjectsForUser } from "./services/access.js";
import { authConfig, authRequired, getRequestUser, hostedDemoMode, publicUser } from "./services/auth.js";
import { extractAudio, extractFrames } from "./services/video.js";
import { analyzeReference } from "./services/referenceAnalyzer.js";
import { transcribeAudio } from "./services/openaiClient.js";
import { generateContentIdeas, generateScriptPlan } from "./services/contentReplicator.js";
import { generateImagePrompts, generateVideoPrompts } from "./services/promptGenerator.js";
import { buildEditPlan } from "./services/editPlanBuilder.js";
import { generateSceneImages } from "./services/imageGenerator.js";
import { generateLibTvUgcVideo, generateLibTvVideos } from "./services/libtvClient.js";
import { listRenders, renderClipperVideo, renderFinalVideo } from "./services/remotionRenderer.js";
import { generateElevenLabsVoiceover, listAudio } from "./services/elevenLabsClient.js";
import { transcribeGeneratedVideo } from "./services/subtitlePlanner.js";
import { analyzeClipperSource, downloadClipperSource, selectClipperHighlight } from "./services/clipperService.js";
import { buildProductionJob } from "./services/productionJobs.js";
import { generateMarketReport, prepareResearchSource } from "./services/marketIntelligence.js";
import { createLocalIntelligenceStore } from "./services/localIntelligenceStore.js";
import {
  analyzeUgcInspiration,
  assertVideoGenerationEligible,
  createScriptVersion,
  generateUgcScript,
  importLegacyScriptPlan,
  selectHook,
  transitionScriptStatus
} from "./services/ugcScriptStudio.js";
import {
  createSupabaseProductionJob,
  deleteSupabaseResearchSource,
  deleteSupabaseProject,
  initializeSupabaseSchema,
  listSupabaseMediaItems,
  listSupabaseActivity,
  listSupabaseOrganization,
  listSupabaseProjectSummaries,
  listSupabaseProductionJobs,
  recordSupabaseApprovalEvent,
  recordSupabaseActivityEvent,
  recordSupabaseScriptReviewEvent,
  supabaseAnalytics,
  supabaseCampaignIntelligence,
  supabaseProjectScriptBundle,
  supabaseProjectData,
  supabaseStatus,
  syncLocalSnapshotToSupabase,
  upsertSupabaseAsset,
  upsertSupabaseCampaign,
  upsertSupabaseCampaignBrief,
  upsertSupabaseClipCandidates,
  upsertSupabaseClient,
  upsertSupabaseMarketReport,
  upsertSupabaseProject,
  upsertSupabaseResearchSource,
  upsertSupabaseRenderJob,
  upsertSupabaseUgcScript,
  upsertSupabaseUgcScriptVersion
} from "./services/supabaseDb.js";
import { ensureDir, fileExists, readJson, writeJson } from "./utils/files.js";
import { run } from "./utils/exec.js";

loadEnv();

const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 4173);
const localIntelligence = createLocalIntelligenceStore(path.join(projectsDir, "intelligence.json"));

function scriptPaths(projectDir) {
  return {
    analysis: path.join(projectDir, "analysis", "ugc-script-analysis.json"),
    script: path.join(projectDir, "generated", "ugc-script.json"),
    versions: path.join(projectDir, "generated", "ugc-script-versions.json"),
    reviews: path.join(projectDir, "generated", "ugc-script-review-events.json")
  };
}

function transcriptText(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.text || value?.transcript || value?.segments?.map((segment) => segment.text).join(" ") || "").trim();
}

function projectScriptBundle(project, { importLegacy = true } = {}) {
  const projectDir = safeProject(project);
  const paths = scriptPaths(projectDir);
  let script = jsonOrNull(paths.script);
  let versionsData = jsonOrNull(paths.versions) || { versions: [] };
  const reviewsData = jsonOrNull(paths.reviews) || { events: [] };

  if (!script && importLegacy) {
    const legacyPlan = jsonOrNull(path.join(projectDir, "generated", "script-plan.json"));
    if (legacyPlan?.scenes?.length) {
      const now = new Date().toISOString();
      script = {
        ...importLegacyScriptPlan(legacyPlan),
        id: `script-${project}`,
        projectName: project,
        currentVersionNumber: 0,
        createdAt: now,
        updatedAt: now
      };
      const created = createScriptVersion({
        script,
        versions: [],
        content: script,
        changeNote: "Imported legacy script plan",
        createdBy: "legacy-import",
        now
      });
      const version = { ...created.version, id: `${script.id}-v1` };
      script = { ...created.script, currentVersionId: version.id };
      versionsData = { versions: [version] };
      writeJson(paths.script, script);
      writeJson(paths.versions, versionsData);
      writeJson(paths.reviews, reviewsData);
    }
  }

  return {
    analysis: jsonOrNull(paths.analysis),
    script,
    versions: Array.isArray(versionsData.versions) ? versionsData.versions : [],
    reviewEvents: Array.isArray(reviewsData.events) ? reviewsData.events : [],
    paths
  };
}

function writeProjectScriptBundle(bundle) {
  if (bundle.analysis !== undefined) writeJson(bundle.paths.analysis, bundle.analysis);
  if (bundle.script) writeJson(bundle.paths.script, bundle.script);
  writeJson(bundle.paths.versions, { versions: bundle.versions || [] });
  writeJson(bundle.paths.reviews, { events: bundle.reviewEvents || [] });
}

function assertScriptReviewRole(currentStatus, nextStatus, user) {
  const role = user?.role || "admin";
  if (role === "admin") return;
  const staffTransitions = new Set(["draft:internal-review", "internal-review:client-review", "internal-review:changes-requested", "changes-requested:draft"]);
  const clientTransitions = new Set(["client-review:approved", "client-review:changes-requested"]);
  const transition = `${currentStatus}:${nextStatus}`;
  if (role === "staff-editor" && staffTransitions.has(transition)) return;
  if (role === "manager-client" && clientTransitions.has(transition)) return;
  throw new Error("Your role cannot perform this script review transition.");
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { "Content-Type": "application/json; charset=utf-8" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function safeProject(name) {
  return projectPath(name);
}

function jsonOrNull(filePath) {
  return fileExists(filePath) ? readJson(filePath) : null;
}

function slugify(text) {
  return String(text || "clip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "clip";
}

function reactionManifestPath(projectDir) {
  return path.join(projectDir, "clipper", "generated", "reaction-characters.json");
}

function reactionAssetUrl(project, localPath, absolutePath) {
  return `/media/${encodeURIComponent(project)}/${localPath.split("/").map(encodeURIComponent).join("/")}?v=${fs.statSync(absolutePath).mtimeMs}`;
}

function readReactionManifest(projectDir) {
  const manifestPath = reactionManifestPath(projectDir);
  const data = fileExists(manifestPath) ? readJson(manifestPath) : { characters: [] };
  return Array.isArray(data.characters) ? data.characters : [];
}

function writeReactionManifest(projectDir, characters) {
  const manifestPath = reactionManifestPath(projectDir);
  ensureDir(path.dirname(manifestPath));
  writeJson(manifestPath, { updatedAt: new Date().toISOString(), characters });
}

function listFrames(projectDir, project) {
  const framesDir = path.join(projectDir, "analysis", "frames");
  if (!fs.existsSync(framesDir)) return [];
  return fs.readdirSync(framesDir)
    .filter((file) => /\.(jpg|jpeg|png)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/analysis/frames/${encodeURIComponent(file)}`
    }));
}

function listImages(projectDir, project) {
  const imagesDir = path.join(projectDir, "assets", "images");
  if (!fs.existsSync(imagesDir)) return [];
  return fs.readdirSync(imagesDir)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/assets/images/${encodeURIComponent(file)}`
    }));
}

function listProductImages(projectDir, project) {
  const productDir = path.join(projectDir, "product");
  if (!fs.existsSync(productDir)) return [];
  return fs.readdirSync(productDir)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/product/${encodeURIComponent(file)}?v=${fs.statSync(path.join(productDir, file)).mtimeMs}`
    }));
}

function listCharacterImages(projectDir, project) {
  const characterDir = path.join(projectDir, "character");
  if (!fs.existsSync(characterDir)) return [];
  return fs.readdirSync(characterDir)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/character/${encodeURIComponent(file)}?v=${fs.statSync(path.join(characterDir, file)).mtimeMs}`
    }));
}

function listClipperReaction(projectDir, project) {
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  if (!fs.existsSync(reactionDir)) return [];

  const manifestCharacters = readReactionManifest(projectDir)
    .filter((character) => character.path && fileExists(path.join(projectDir, character.path)))
    .map((character) => {
      const absolutePath = path.join(projectDir, character.path);
      return {
        ...character,
        type: character.type || (/\.(mp4|mov|webm)$/i.test(character.path) ? "video" : "image"),
        name: character.name || path.basename(character.path),
        url: reactionAssetUrl(project, character.path, absolutePath)
      };
    });
  const knownPaths = new Set(manifestCharacters.map((character) => character.path));

  const legacyCharacters = fs.readdirSync(reactionDir)
    .filter((file) => /\.(png|jpg|jpeg|webp|mp4|mov|webm)$/i.test(file))
    .filter((file) => !knownPaths.has(`clipper/reaction/${file}`))
    .sort()
    .map((file, index) => ({
      id: `legacy-${slugify(path.parse(file).name) || index + 1}`,
      name: path.parse(file).name,
      originalName: file,
      path: `clipper/reaction/${file}`,
      type: /\.(mp4|mov|webm)$/i.test(file) ? "video" : "image",
      uploadedAt: "",
      url: reactionAssetUrl(project, `clipper/reaction/${file}`, path.join(reactionDir, file))
    }));

  return [...manifestCharacters, ...legacyCharacters];
}

function clipperSourceUrl(projectDir, project) {
  const sourcePath = path.join(projectDir, "clipper", "source", "source-video.mp4");
  return fileExists(sourcePath)
    ? `/media/${encodeURIComponent(project)}/clipper/source/source-video.mp4?v=${fs.statSync(sourcePath).mtimeMs}`
    : null;
}

function detectProductImageType(buffer) {
  const ascii = buffer.subarray(0, 32).toString("latin1");
  const brand = buffer.subarray(4, 16).toString("latin1");
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: ".png", mime: "image/png" };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (ascii.startsWith("RIFF") && ascii.includes("WEBP")) return { ext: ".webp", mime: "image/webp" };
  if (brand.includes("avif") || brand.includes("avis")) return { ext: ".avif", mime: "image/avif" };
  return null;
}

function detectVideoType(buffer, fileName = "") {
  const ext = path.extname(fileName || "").toLowerCase();
  const brand = buffer.subarray(4, 16).toString("latin1").toLowerCase();
  if (brand.includes("ftyp") || ["mp4", "isom", "iso2", "avc1", "mp41", "mp42", "qt  "].some((token) => brand.includes(token))) {
    return { ext: ext === ".mov" ? ".mov" : ".mp4", mime: ext === ".mov" ? "video/quicktime" : "video/mp4" };
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return { ext: ".webm", mime: "video/webm" };
  return null;
}

async function saveImageAsset(buffer, dir, baseName) {
  ensureDir(dir);
  for (const existing of fs.readdirSync(dir).filter((file) => /\.(png|jpg|jpeg|webp|avif)$/i.test(file))) {
    fs.unlinkSync(path.join(dir, existing));
  }

  const detected = detectProductImageType(buffer);
  if (!detected) throw new Error("Unsupported image. Upload a PNG, JPG, WEBP, or AVIF image.");

  if (detected.ext === ".avif") {
    const rawPath = path.join(dir, `${baseName}-upload.avif`);
    const outputPath = path.join(dir, `${baseName}.png`);
    fs.writeFileSync(rawPath, buffer);
    try {
      await run("ffmpeg", [
        "-y",
        "-i", rawPath,
        "-frames:v", "1",
        "-update", "1",
        outputPath
      ]);
    } finally {
      if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
    }
    return outputPath;
  }

  const outputPath = path.join(dir, `${baseName}${detected.ext}`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function saveReactionAsset(buffer, dir, fileName = "") {
  ensureDir(dir);
  const projectDir = path.resolve(dir, "..", "..");
  const displayName = path.parse(fileName || "reaction-character").name || "reaction-character";
  const baseName = `${Date.now()}-${slugify(displayName)}`;
  const imageType = detectProductImageType(buffer);
  let outputPath = "";
  let type = "";

  if (imageType) {
    type = "image";
    if (imageType.ext === ".avif") {
      const rawPath = path.join(dir, `${baseName}-upload.avif`);
      outputPath = path.join(dir, `${baseName}.png`);
      fs.writeFileSync(rawPath, buffer);
      try {
        await run("ffmpeg", [
          "-y",
          "-i", rawPath,
          "-frames:v", "1",
          "-update", "1",
          outputPath
        ]);
      } finally {
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
      }
    } else {
      outputPath = path.join(dir, `${baseName}${imageType.ext}`);
      fs.writeFileSync(outputPath, buffer);
    }
  } else {
    const videoType = detectVideoType(buffer, fileName);
    if (!videoType) throw new Error("Unsupported reaction asset. Upload PNG, JPG, WEBP, AVIF, MP4, MOV, or WEBM.");
    type = "video";
    outputPath = path.join(dir, `${baseName}${videoType.ext}`);
    fs.writeFileSync(outputPath, buffer);
  }

  const character = {
    id: `char-${baseName}`,
    name: displayName,
    originalName: fileName || path.basename(outputPath),
    path: path.relative(projectDir, outputPath).replace(/\\/g, "/"),
    type,
    uploadedAt: new Date().toISOString()
  };
  writeReactionManifest(projectDir, [...readReactionManifest(projectDir), character]);
  return character;
}

function listVideos(projectDir, project) {
  const videosDir = path.join(projectDir, "assets", "videos");
  if (!fs.existsSync(videosDir)) return [];
  return fs.readdirSync(videosDir)
    .filter((file) => /\.(mp4|mov|webm)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/assets/videos/${encodeURIComponent(file)}?v=${fs.statSync(path.join(videosDir, file)).mtimeMs}`
    }));
}

function getProjectSummary(project) {
  const dir = safeProject(project);
  const meta = getProjectMeta(project);
  const reference = path.join(dir, "reference", "reference.mp4");
  const renders = listRenders(dir, project);
  const highlights = jsonOrNull(path.join(dir, "clipper", "generated", "highlight-candidates.json"));
  const ugcScript = jsonOrNull(path.join(dir, "generated", "ugc-script.json"));
  return {
    name: project,
    type: meta.type,
    folderId: meta.folderId,
    clientId: meta.clientId,
    campaignId: meta.campaignId,
    assignedStaffId: meta.assignedStaffId,
    reviewerId: meta.reviewerId,
    priority: meta.priority,
    approvalStatus: meta.approvalStatus,
    approvalFeedback: meta.approvalFeedback,
    reviewSubmittedAt: meta.reviewSubmittedAt,
    reviewedAt: meta.reviewedAt,
    hasReference: fileExists(reference),
    hasProduct: listProductImages(dir, project).length > 0,
    hasCharacter: listCharacterImages(dir, project).length > 0,
    frameCount: listFrames(dir, project).length,
    imageCount: listImages(dir, project).length,
    videoCount: listVideos(dir, project).length,
    audioCount: listAudio(dir, project).length,
    renderCount: renders.length,
    hasStyleAnalysis: fileExists(path.join(dir, "analysis", "style-analysis.json")),
    hasReferenceBlueprint: fileExists(path.join(dir, "analysis", "reference-blueprint.json")),
    hasUgcVideo: fileExists(path.join(dir, "assets", "videos", "ugc-output.mp4")),
    hasGeneratedTranscript: fileExists(path.join(dir, "analysis", "generated-transcript.json")),
    hasSubtitlePlan: fileExists(path.join(dir, "generated", "subtitle-plan.json")),
    hasGeneratedPlan: fileExists(path.join(dir, "generated", "edit-plan.json")),
    hasMarketReport: Boolean(meta.campaignId && localIntelligence.getCampaign(meta.campaignId).activeReport),
    hasUgcScript: Boolean(ugcScript),
    scriptStatus: ugcScript?.status || "",
    hasClipperSource: fileExists(path.join(dir, "clipper", "source", "source-video.mp4")),
    hasClipperTranscript: fileExists(path.join(dir, "clipper", "analysis", "source-transcript.json")),
    hasClipperHighlights: fileExists(path.join(dir, "clipper", "generated", "highlight-candidates.json")),
    hasClipperSelection: fileExists(path.join(dir, "clipper", "generated", "selected-highlight.json")),
    hasClipperReaction: listClipperReaction(dir, project).length > 0,
    hasClipperRender: fileExists(path.join(dir, "renders", "final-clip.mp4")) || renders.some((render) => render.name.startsWith("clips/")),
    assets: listProjectAssets(dir, project),
    clipCandidates: Array.isArray(highlights?.candidates) ? highlights.candidates : []
  };
}

function listProjects() {
  ensureDir(projectsDir);
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => getProjectSummary(entry.name));
}

function mediaLibrary() {
  return listProjects().flatMap((project) => {
    const dir = safeProject(project.name);
    return listRenders(dir, project.name).map((render) => ({
      ...render,
      project: project.name,
      projectType: project.type,
      clientId: project.clientId,
      campaignId: project.campaignId,
      assignedStaffId: project.assignedStaffId,
      reviewerId: project.reviewerId,
      approvalStatus: project.approvalStatus,
      approvalFeedback: project.approvalFeedback
    }));
  });
}

function listProjectAssets(projectDir, project) {
  const assets = [];
  const pushAsset = ({ kind, name, localPath, url, mediaType }) => {
    assets.push({
      id: `${project}:${kind}:${name}`,
      kind,
      name,
      localPath,
      url,
      mediaType
    });
  };
  if (fileExists(path.join(projectDir, "reference", "reference.mp4"))) {
    pushAsset({ kind: "reference-video", name: "reference.mp4", localPath: "reference/reference.mp4", url: `/media/${encodeURIComponent(project)}/reference/reference.mp4`, mediaType: "video/mp4" });
  }
  if (fileExists(path.join(projectDir, "clipper", "source", "source-video.mp4"))) {
    pushAsset({ kind: "clipper-source", name: "source-video.mp4", localPath: "clipper/source/source-video.mp4", url: `/media/${encodeURIComponent(project)}/clipper/source/source-video.mp4`, mediaType: "video/mp4" });
  }
  for (const item of listProductImages(projectDir, project)) pushAsset({ kind: "product-image", name: item.name, localPath: `product/${item.name}`, url: item.url, mediaType: "image" });
  for (const item of listCharacterImages(projectDir, project)) pushAsset({ kind: "character-reference", name: item.name, localPath: `character/${item.name}`, url: item.url, mediaType: "image" });
  for (const item of listClipperReaction(projectDir, project)) pushAsset({ kind: "reaction-character", name: item.name, localPath: item.path, url: item.url, mediaType: item.type });
  return assets;
}

async function analyze(project, frames = 10) {
  const projectDir = safeProject(project);
  const referenceVideo = path.join(projectDir, "reference", "reference.mp4");
  if (!fileExists(referenceVideo)) throw new Error("Upload reference/reference.mp4 before analysis.");

  const metadata = await extractFrames(referenceVideo, path.join(projectDir, "analysis", "frames"), Number(frames || 10));
  writeJson(path.join(projectDir, "analysis", "metadata.json"), metadata);

  const audioPath = await extractAudio(referenceVideo, path.join(projectDir, "analysis", "audio.wav"));
  const transcript = await transcribeAudio(audioPath);
  writeJson(path.join(projectDir, "analysis", "transcript.json"), transcript);

  const styleAnalysis = await analyzeReference({ projectDir, metadata, transcript });
  writeJson(path.join(projectDir, "analysis", "style-analysis.json"), styleAnalysis);
  writeJson(path.join(projectDir, "analysis", "reference-blueprint.json"), styleAnalysis);

  return { metadata, transcript, styleAnalysis };
}

async function generate(project, topic) {
  if (!topic) throw new Error("Topic is required.");
  const projectDir = safeProject(project);
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

function projectData(project) {
  const dir = safeProject(project);
  const scriptBundle = projectScriptBundle(project);
  const meta = getProjectMeta(project);
  const campaignIntelligence = meta.campaignId ? localIntelligence.getCampaign(meta.campaignId) : null;
  return {
    summary: getProjectSummary(project),
    folders: readFolders(),
    organization: readOrganization(),
    products: listProductImages(dir, project),
    characters: listCharacterImages(dir, project),
    frames: listFrames(dir, project),
    images: listImages(dir, project),
    videos: listVideos(dir, project),
    audio: listAudio(dir, project),
    renders: listRenders(dir, project),
    clipper: {
      sourceUrl: clipperSourceUrl(dir, project),
      reactions: listClipperReaction(dir, project)
    },
    referenceUrl: fileExists(path.join(dir, "reference", "reference.mp4"))
      ? `/media/${encodeURIComponent(project)}/reference/reference.mp4`
      : null,
    marketReport: campaignIntelligence?.activeReport || null,
    scriptVersions: scriptBundle.versions,
    scriptReviewEvents: scriptBundle.reviewEvents,
    files: {
      metadata: jsonOrNull(path.join(dir, "analysis", "metadata.json")),
      transcript: jsonOrNull(path.join(dir, "analysis", "transcript.json")),
      marketReport: campaignIntelligence?.activeReport || null,
      scriptAnalysis: scriptBundle.analysis,
      ugcScript: scriptBundle.script,
      styleAnalysis: jsonOrNull(path.join(dir, "analysis", "style-analysis.json")),
      referenceBlueprint: jsonOrNull(path.join(dir, "analysis", "reference-blueprint.json")),
      generatedTranscript: jsonOrNull(path.join(dir, "analysis", "generated-transcript.json")),
      contentIdeas: jsonOrNull(path.join(dir, "generated", "content-ideas.json")),
      scriptPlan: jsonOrNull(path.join(dir, "generated", "script-plan.json")),
      imagePrompts: jsonOrNull(path.join(dir, "generated", "image-prompts.json")),
      imageAssets: jsonOrNull(path.join(dir, "generated", "image-assets.json")),
      videoPrompts: jsonOrNull(path.join(dir, "generated", "video-prompts.json")),
      libtvVideoAssets: jsonOrNull(path.join(dir, "generated", "libtv-video-assets.json")),
      libtvUgcVideo: jsonOrNull(path.join(dir, "generated", "libtv-ugc-video.json")),
      voiceoverManifest: jsonOrNull(path.join(dir, "generated", "voiceover-manifest.json")),
      subtitlePlan: jsonOrNull(path.join(dir, "generated", "subtitle-plan.json")),
      renderManifest: jsonOrNull(path.join(dir, "generated", "render-manifest.json")),
      clipperSource: jsonOrNull(path.join(dir, "clipper", "source", "source-url.json")),
      clipperMetadata: jsonOrNull(path.join(dir, "clipper", "analysis", "source-metadata.json")),
      clipperTranscript: jsonOrNull(path.join(dir, "clipper", "analysis", "source-transcript.json")),
      clipperHighlights: jsonOrNull(path.join(dir, "clipper", "generated", "highlight-candidates.json")),
      clipperSelection: jsonOrNull(path.join(dir, "clipper", "generated", "selected-highlight.json")),
      clipperSubtitlePlan: jsonOrNull(path.join(dir, "clipper", "generated", "clip-subtitle-plan.json")),
      clipperRenderManifest: jsonOrNull(path.join(dir, "clipper", "generated", "clipper-render-manifest.json")),
      clipperBulkRenderManifest: jsonOrNull(path.join(dir, "clipper", "generated", "clipper-bulk-render-manifest.json")),
      clipperReactionCharacters: jsonOrNull(path.join(dir, "clipper", "generated", "reaction-characters.json")),
      clipperVariationRenderManifest: jsonOrNull(path.join(dir, "clipper", "generated", "clipper-character-variations-manifest.json")),
      editPlan: jsonOrNull(path.join(dir, "generated", "edit-plan.json"))
    }
  };
}

async function trySupabaseWrite(task) {
  try {
    await task();
    return null;
  } catch (error) {
    return error.message;
  }
}

function recordApprovalActivity(recordActivity, projectName, status, feedback = "") {
  const eventType = status === "in-review"
    ? "approval.submitted"
    : status === "approved"
      ? "approval.approved"
      : status === "changes-requested"
        ? "approval.changes_requested"
        : "";
  if (eventType) recordActivity(eventType, projectName, `Approval status changed to ${status}`, { status, feedback: feedback || "" });
}

async function syncProjectAssetsToSupabase(project) {
  const projectDir = safeProject(project);
  for (const asset of listProjectAssets(projectDir, project)) {
    await upsertSupabaseAsset(project, asset);
  }
}

async function syncProjectRendersToSupabase(project) {
  const summary = getProjectSummary(project);
  const projectDir = safeProject(project);
  for (const render of listRenders(projectDir, project)) {
    await upsertSupabaseRenderJob({
      ...render,
      project,
      projectType: summary.type
    });
  }
}

async function syncLocalIntelligenceToSupabase() {
  let briefs = 0;
  let sources = 0;
  let reports = 0;
  let scripts = 0;
  let versions = 0;
  let reviews = 0;
  for (const campaign of readOrganization().campaigns) {
    const intelligence = localIntelligence.getCampaign(campaign.id);
    const hosted = await supabaseCampaignIntelligence(campaign.id);
    const briefId = hosted.campaignBrief?.id || intelligence.brief.id || `brief-${campaign.id}`;
    if (Object.keys(intelligence.brief || {}).length) {
      await upsertSupabaseCampaignBrief({ ...intelligence.brief, id: briefId, campaignId: campaign.id, title: intelligence.brief.title || intelligence.brief.product || campaign.name });
      briefs += 1;
    }
    for (const source of intelligence.sources) {
      await upsertSupabaseResearchSource({ ...source, briefId });
      sources += 1;
    }
    for (const report of intelligence.reports) {
      await upsertSupabaseMarketReport({ ...report, briefId, campaignId: campaign.id });
      reports += 1;
    }
  }
  for (const project of listProjects()) {
    const bundle = projectScriptBundle(project.name);
    if (!bundle.script) continue;
    await upsertSupabaseUgcScript({ ...bundle.script, projectName: project.name, campaignId: bundle.script.campaignId || project.campaignId });
    scripts += 1;
    for (const version of bundle.versions) {
      await upsertSupabaseUgcScriptVersion(version);
      versions += 1;
    }
    for (const event of bundle.reviewEvents) {
      await recordSupabaseScriptReviewEvent({
        ...event,
        versionId: event.versionId || bundle.script.currentVersionId,
        fromStatus: event.fromStatus || bundle.script.status,
        toStatus: event.toStatus || bundle.script.status
      });
      reviews += 1;
    }
  }
  return { briefs, sources, reports, scripts, versions, reviews };
}

const editableFiles = {
  styleAnalysis: ["analysis", "style-analysis.json"],
  contentIdeas: ["generated", "content-ideas.json"],
  scriptPlan: ["generated", "script-plan.json"],
  imagePrompts: ["generated", "image-prompts.json"],
  videoPrompts: ["generated", "video-prompts.json"],
  editPlan: ["generated", "edit-plan.json"]
};

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const requestUser = await getRequestUser(req);

  if (req.method === "GET" && url.pathname === "/api/auth/config") {
    return sendJson(res, 200, authConfig());
  }

  if (req.method === "GET" && url.pathname === "/api/auth/profile") {
    if (authRequired() && !requestUser) return sendJson(res, 401, { error: "Login required" });
    return sendJson(res, 200, { user: publicUser(requestUser), required: authRequired() });
  }

  if (authRequired() && !requestUser) {
    return sendJson(res, 401, { error: "Login required" });
  }

  const allProjects = () => listProjects();
  const visibleProjects = () => filterProjectsForUser(allProjects(), requestUser);
  const visibleMedia = () => filterMediaForUser(mediaLibrary(), requestUser);
  const isAdmin = !requestUser || requestUser.role === "admin";
  const requireAdmin = () => {
    if (!isAdmin) throw new Error("Admin access required.");
  };
  const requireProjectAccess = (projectName) => {
    const summary = getProjectSummary(projectName);
    if (!canAccessProject(summary, requestUser)) throw new Error("Project access denied.");
    return summary;
  };
  const requireEditorAccess = (projectName) => {
    const summary = requireProjectAccess(projectName);
    if (requestUser?.role === "manager-client") throw new Error("Editor access required.");
    return summary;
  };
  const shouldQueueEngine = () => hostedDemoMode();
  const recordActivity = (eventType, projectName, summary, metadata = {}) => {
    void recordSupabaseActivityEvent({
      eventType,
      projectName,
      actor: requestUser,
      summary,
      metadata
    });
  };
  const createQueuedJob = async (projectName, jobType, payload = {}) => {
    const summary = hostedDemoMode()
      ? filterProjectsForUser(await listSupabaseProjectSummaries(), requestUser).find((item) => item.name === projectName)
      : requireEditorAccess(projectName);
    if (!summary) throw new Error("Project access denied.");
    if (requestUser?.role === "manager-client") throw new Error("Editor access required.");
    const job = buildProductionJob({
      projectName,
      jobType,
      payload,
      requestedBy: requestUser?.id || "local"
    });
    const created = await createSupabaseProductionJob(job);
    recordActivity("production.queued", projectName, `${jobType} queued`, { jobId: created?.id || "", jobType });
    const data = hostedDemoMode() ? await supabaseProjectData(projectName, { user: requestUser }) : projectData(projectName);
    return { ok: true, queued: true, job: created, project: summary, data };
  };

  if (req.method === "GET" && url.pathname === "/api/activity") {
    return sendJson(res, 200, { items: await listSupabaseActivity({ user: requestUser, limit: url.searchParams.get("limit") }) });
  }

  if (hostedDemoMode()) {
    const hostedProjects = async () => listSupabaseProjectSummaries();
    const hostedVisibleProjects = async () => filterProjectsForUser(await hostedProjects(), requestUser);
    const requireHostedProjectAccess = async (projectName) => {
      const summary = (await hostedVisibleProjects()).find((item) => item.name === projectName);
      if (!summary) throw new Error("Project access denied.");
      return summary;
    };
    const requireHostedEditorAccess = async (projectName) => {
      const summary = await requireHostedProjectAccess(projectName);
      if (requestUser?.role === "manager-client") throw new Error("Editor access required.");
      return summary;
    };
    const requireHostedCampaignAccess = async (campaignId, { edit = false } = {}) => {
      const organization = await listSupabaseOrganization();
      const campaign = organization.campaigns.find((item) => String(item.id) === String(campaignId));
      if (!campaign) throw new Error("Campaign not found.");
      const projects = await hostedProjects();
      const allowed = edit
        ? canEditCampaign(campaign, projects, requestUser)
        : canAccessCampaign(campaign, projects, requestUser);
      if (!allowed) throw new Error(edit ? "Campaign editor access required." : "Campaign access denied.");
      return { campaign, projects };
    };

    if (req.method === "GET" && url.pathname === "/api/projects") {
      return sendJson(res, 200, { projects: await hostedVisibleProjects(), folders: [] });
    }

    if (req.method === "GET" && url.pathname === "/api/folders") {
      return sendJson(res, 200, { folders: [] });
    }

    if (req.method === "GET" && url.pathname === "/api/organization") {
      const organization = await listSupabaseOrganization();
      if (isAdmin) return sendJson(res, 200, organization);
      const projects = await hostedVisibleProjects();
      const clientIds = new Set(projects.map((project) => project.clientId).filter(Boolean));
      const campaignIds = new Set(projects.map((project) => project.campaignId).filter(Boolean));
      return sendJson(res, 200, {
        clients: organization.clients.filter((client) => clientIds.has(client.id)),
        campaigns: organization.campaigns.filter((campaign) => campaignIds.has(campaign.id)),
        staff: organization.staff.filter((person) => person.id === requestUser?.id)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/media-library") {
      return sendJson(res, 200, { items: filterMediaForUser(await listSupabaseMediaItems(), requestUser) });
    }

    if (req.method === "GET" && url.pathname === "/api/intelligence") {
      const organization = await listSupabaseOrganization();
      const projects = await hostedProjects();
      const campaigns = organization.campaigns.filter((campaign) => canAccessCampaign(campaign, projects, requestUser));
      const intelligence = await Promise.all(campaigns.map(async (campaign) => ({
        ...campaign,
        intelligence: await supabaseCampaignIntelligence(campaign.id, { user: requestUser })
      })));
      return sendJson(res, 200, { campaigns: intelligence });
    }

    if (parts[0] === "api" && parts[1] === "campaigns" && parts[2]) {
      const campaignId = decodeURIComponent(parts[2]);
      const section = parts[3];
      const { campaign, projects } = await requireHostedCampaignAccess(campaignId, { edit: req.method !== "GET" });

      if (req.method === "GET" && section === "intelligence") {
        return sendJson(res, 200, await supabaseCampaignIntelligence(campaignId, { user: requestUser }));
      }

      if (req.method === "PUT" && section === "brief") {
        const body = await readJsonBody(req);
        const current = await supabaseCampaignIntelligence(campaignId, { user: requestUser });
        const brief = await upsertSupabaseCampaignBrief({
          ...current.campaignBrief,
          ...body,
          id: body.id || current.campaignBrief?.id,
          campaignId,
          title: body.title || body.product || campaign.name,
          createdBy: current.campaignBrief?.createdBy || requestUser?.id,
          updatedAt: new Date().toISOString()
        });
        return sendJson(res, 200, { ok: true, brief, intelligence: await supabaseCampaignIntelligence(campaignId, { user: requestUser }) });
      }

      if (section === "research-sources" && req.method === "POST" && ["text", "file"].includes(parts[4])) {
        const intelligence = await supabaseCampaignIntelligence(campaignId, { user: requestUser });
        if (!intelligence.campaignBrief?.id) throw new Error("Save the campaign brief before adding research sources.");
        let sourceInput;
        if (parts[4] === "text") {
          sourceInput = { ...(await readJsonBody(req)), type: "text" };
        } else {
          const fileName = String(req.headers["x-file-name"] || "research.txt");
          sourceInput = { name: fileName, fileName, type: path.extname(fileName).slice(1).toLowerCase(), content: (await readBody(req)).toString("utf8") };
        }
        const source = prepareResearchSource(sourceInput);
        const saved = await upsertSupabaseResearchSource({ ...source, briefId: intelligence.campaignBrief.id, createdBy: requestUser?.id });
        return sendJson(res, 201, { ok: true, source: saved, intelligence: await supabaseCampaignIntelligence(campaignId, { user: requestUser }) });
      }

      if (section === "research-sources" && req.method === "DELETE" && parts[4]) {
        await deleteSupabaseResearchSource(decodeURIComponent(parts[4]));
        return sendJson(res, 200, { ok: true, intelligence: await supabaseCampaignIntelligence(campaignId, { user: requestUser }) });
      }

      if (section === "market-reports" && req.method === "POST" && parts[4] === "generate") {
        const body = await readJsonBody(req);
        const project = projects.find((item) => item.campaignId === campaignId && item.type !== "auto-clipper");
        if (!project) throw new Error("Create an AI Generator project for this campaign before queuing market analysis.");
        return sendJson(res, 202, await createQueuedJob(project.name, "generate-market-report", { campaignId, sourceIds: body.sourceIds || [] }));
      }

      if (section === "market-reports" && parts[4]) {
        const reportId = decodeURIComponent(parts[4]);
        const intelligence = await supabaseCampaignIntelligence(campaignId, { user: requestUser });
        if (!intelligence.marketReport || intelligence.marketReport.id !== reportId) throw new Error("Market report not found.");
        if (req.method === "PUT" && parts.length === 5) {
          const patch = await readJsonBody(req);
          const report = await upsertSupabaseMarketReport({ ...intelligence.marketReport, ...patch, id: reportId, campaignId, status: "draft", approvedBy: null, approvedAt: null, updatedAt: new Date().toISOString() });
          return sendJson(res, 200, { ok: true, report, intelligence: await supabaseCampaignIntelligence(campaignId, { user: requestUser }) });
        }
        if (req.method === "POST" && parts[5] === "approve") {
          const report = await upsertSupabaseMarketReport({ ...intelligence.marketReport, id: reportId, campaignId, status: "approved", approvedBy: requestUser?.id, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          return sendJson(res, 200, { ok: true, report, intelligence: await supabaseCampaignIntelligence(campaignId, { user: requestUser }) });
        }
      }
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      requireAdmin();
      const body = await readJsonBody(req);
      const name = String(body.name || "").trim().replace(/\s+/g, "-").toLowerCase();
      if (!name) throw new Error("Project name is required.");
      const project = {
        name,
        type: body.type || "ai-generator",
        folderId: body.folderId || "",
        clientId: body.clientId || "",
        campaignId: body.campaignId || "",
        assignedStaffId: body.assignedStaffId || "",
        reviewerId: body.reviewerId || "",
        priority: body.priority || "normal",
        approvalStatus: "draft",
        approvalFeedback: "",
        createdAt: new Date().toISOString()
      };
      await upsertSupabaseProject(project);
      recordActivity("project.created", name, `Project ${name} created`, { type: project.type });
      return sendJson(res, 201, { project });
    }

    if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
      const project = decodeURIComponent(parts[2]);

      if (req.method === "GET" && parts.length === 3) {
        await requireHostedProjectAccess(project);
        const data = await supabaseProjectData(project, { user: requestUser });
        if (!data) throw new Error("Project not found.");
        return sendJson(res, 200, data);
      }

      if (req.method === "GET" && parts[3] === "jobs") {
        await requireHostedProjectAccess(project);
        return sendJson(res, 200, { jobs: await listSupabaseProductionJobs({ projectName: project }) });
      }

      if (req.method === "POST" && parts[3] === "jobs") {
        await requireHostedEditorAccess(project);
        const body = await readJsonBody(req);
        return sendJson(res, 201, await createQueuedJob(project, body.jobType, body.payload || {}));
      }

      if (req.method === "DELETE" && parts.length === 3) {
        requireAdmin();
        await deleteSupabaseProject(project);
        return sendJson(res, 200, { ok: true, projects: await hostedVisibleProjects(), folders: [] });
      }

      if (req.method === "PUT" && parts[3] === "meta") {
        await requireHostedProjectAccess(project);
        const current = (await hostedProjects()).find((item) => item.name === project);
        const body = await readJsonBody(req);
        const next = {
          ...current,
          ...body,
          name: project,
          type: body.type || current?.type || "ai-generator",
          folderId: body.folderId ?? current?.folderId ?? "",
          clientId: body.clientId ?? current?.clientId ?? "",
          campaignId: body.campaignId ?? current?.campaignId ?? "",
          assignedStaffId: body.assignedStaffId ?? current?.assignedStaffId ?? "",
          reviewerId: body.reviewerId ?? current?.reviewerId ?? "",
          priority: body.priority ?? current?.priority ?? "normal",
          approvalStatus: body.approvalStatus ?? current?.approvalStatus ?? "draft",
          approvalFeedback: body.approvalFeedback ?? current?.approvalFeedback ?? ""
        };
        await upsertSupabaseProject(next);
        if (body.assignedStaffId !== undefined && body.assignedStaffId !== current?.assignedStaffId) {
          recordActivity("project.assigned", project, `Project assigned to ${next.assignedStaffId || "no one"}`, { assignedStaffId: next.assignedStaffId || "" });
        }
        if (body.approvalStatus) {
          await recordSupabaseApprovalEvent({
            projectName: project,
            status: body.approvalStatus,
            feedback: body.approvalFeedback ?? next.approvalFeedback
          });
          recordApprovalActivity(recordActivity, project, body.approvalStatus, body.approvalFeedback ?? next.approvalFeedback);
        }
        return sendJson(res, 200, {
          ok: true,
          project: next,
          data: await supabaseProjectData(project, { user: requestUser }),
          projects: await hostedVisibleProjects(),
          folders: []
        });
      }

      if (parts[3] === "ugc-script" && req.method === "POST" && ["analyze", "generate"].includes(parts[4])) {
        const summary = await requireHostedEditorAccess(project);
        const body = await readJsonBody(req);
        const jobType = parts[4] === "analyze" ? "analyze-ugc-script" : "generate-ugc-script";
        return sendJson(res, 202, await createQueuedJob(project, jobType, { ...body, campaignId: summary.campaignId }));
      }

      if (parts[3] === "ugc-script" && req.method === "PUT" && parts.length === 4) {
        await requireHostedEditorAccess(project);
        const body = await readJsonBody(req);
        const bundle = await supabaseProjectScriptBundle(project, { user: requestUser });
        if (!bundle.ugcScript) throw new Error("Generate a UGC script before editing it.");
        const currentVersionId = bundle.ugcScript.currentVersionId || bundle.ugcScript.versionId;
        if (body.baseVersionId && body.baseVersionId !== currentVersionId) throw new Error("This script changed since it was opened. Reload before saving.");
        let script = {
          ...bundle.ugcScript,
          hooks: Array.isArray(body.hooks) ? body.hooks : bundle.ugcScript.hooks,
          scenes: Array.isArray(body.scenes) ? body.scenes : bundle.ugcScript.scenes,
          status: "draft",
          updatedBy: requestUser?.id,
          updatedAt: new Date().toISOString()
        };
        script = selectHook(script, body.selectedHookId || script.selectedHookId || script.hooks[0]?.id);
        const created = createScriptVersion({
          script,
          versions: bundle.scriptVersions,
          content: script,
          changeNote: body.changeNote || "Edited in UGC Script Studio",
          createdBy: requestUser?.id || ""
        });
        const savedScript = await upsertSupabaseUgcScript({ ...created.script, projectName: project });
        const savedVersion = await upsertSupabaseUgcScriptVersion(created.version);
        return sendJson(res, 200, { ok: true, result: savedScript, version: savedVersion, data: await supabaseProjectData(project, { user: requestUser }) });
      }

      if (parts[3] === "ugc-script" && req.method === "POST" && parts[4] === "review") {
        await requireHostedProjectAccess(project);
        const body = await readJsonBody(req);
        const bundle = await supabaseProjectScriptBundle(project, { user: requestUser });
        if (!bundle.ugcScript) throw new Error("Generate a UGC script before reviewing it.");
        const versionId = bundle.ugcScript.currentVersionId || bundle.ugcScript.versionId;
        assertScriptReviewRole(bundle.ugcScript.status, body.status, requestUser);
        const transitioned = transitionScriptStatus(bundle.ugcScript, body.status, { versionId, actorId: requestUser?.id || "", feedback: body.feedback });
        const savedScript = await upsertSupabaseUgcScript({ ...transitioned.script, projectName: project, updatedBy: requestUser?.id });
        const event = await recordSupabaseScriptReviewEvent(transitioned.event);
        return sendJson(res, 200, { ok: true, result: savedScript, event, data: await supabaseProjectData(project, { user: requestUser }) });
      }

      if (req.method === "POST" && parts[3] === "generate-ugc-video") {
        await requireHostedEditorAccess(project);
        const body = await readJsonBody(req);
        const bundle = await supabaseProjectScriptBundle(project, { user: requestUser });
        if (!bundle.ugcScript) throw new Error("Generate and approve a UGC script before video generation.");
        const versionId = bundle.ugcScript.currentVersionId || bundle.ugcScript.versionId;
        const eligibility = assertVideoGenerationEligible(bundle.ugcScript, {
          role: requestUser?.role,
          isAdmin: requestUser?.role === "admin",
          overrideReason: body.overrideReason,
          versionId,
          actorId: requestUser?.id || ""
        });
        if (eligibility.auditEvent) await recordSupabaseScriptReviewEvent({
          ...eligibility.auditEvent,
          versionId,
          fromStatus: bundle.ugcScript.status,
          toStatus: bundle.ugcScript.status
        });
        return sendJson(res, 202, await createQueuedJob(project, "generate-ugc-video", {
          ...body,
          marketReportId: bundle.ugcScript.marketReportId,
          scriptId: bundle.ugcScript.id,
          scriptVersionId: versionId,
          selectedHookId: bundle.ugcScript.selectedHookId,
          override: eligibility.overridden ? eligibility.auditEvent : null
        }));
      }

      const queueMap = {
        "analyze": "analyze-reference",
        "analyze-reference": "analyze-reference",
        "generate": "generate-content",
        "images": "generate-images",
        "videos": "generate-videos",
        "transcribe-generated-video": "transcribe-generated-video",
        "voiceover": "generate-voiceover",
        "render": "render-final-video",
        "pipeline": "pipeline"
      };
      const directAction = queueMap[parts[3]];
      if (req.method === "POST" && directAction) {
        await requireHostedEditorAccess(project);
        const body = await readJsonBody(req);
        return sendJson(res, 202, await createQueuedJob(project, directAction, body));
      }

      if (parts[3] === "clipper" && req.method === "POST") {
        const clipperMap = {
          "source-link": "clipper-source-link",
          "analyze": "clipper-analyze",
          "render": "clipper-render",
          "render-bulk": "clipper-render-bulk",
          "render-variations": "clipper-render-variations"
        };
        const jobType = clipperMap[parts[4]];
        if (jobType) {
          await requireHostedEditorAccess(project);
          const body = await readJsonBody(req);
          return sendJson(res, 202, await createQueuedJob(project, jobType, body));
        }
        if (parts[4] === "select-highlight") {
          await requireHostedEditorAccess(project);
          return sendJson(res, 200, { ok: true, data: await supabaseProjectData(project, { user: requestUser }) });
        }
      }
    }
  }

  const localCampaign = (campaignId) => readOrganization().campaigns.find((campaign) => campaign.id === campaignId);
  const requireLocalCampaign = (campaignId, { edit = false } = {}) => {
    const campaign = localCampaign(campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    const allowed = edit
      ? canEditCampaign(campaign, allProjects(), requestUser)
      : canAccessCampaign(campaign, allProjects(), requestUser);
    if (!allowed) throw new Error(edit ? "Campaign editor access required." : "Campaign access denied.");
    return campaign;
  };
  const visibleCampaignIntelligence = (campaignId) => {
    const intelligence = localIntelligence.getCampaign(campaignId);
    if (requestUser?.role !== "manager-client") return intelligence;
    const reports = intelligence.reports.filter((report) => report.status === "approved");
    return {
      brief: intelligence.brief,
      sources: [],
      reports,
      activeReportId: reports.find((report) => report.id === intelligence.activeReportId)?.id || reports.at(-1)?.id || "",
      activeReport: reports.find((report) => report.id === intelligence.activeReportId) || reports.at(-1) || null
    };
  };

  if (req.method === "GET" && url.pathname === "/api/intelligence") {
    const organization = readOrganization();
    const campaigns = organization.campaigns
      .filter((campaign) => canAccessCampaign(campaign, allProjects(), requestUser))
      .map((campaign) => ({ ...campaign, intelligence: visibleCampaignIntelligence(campaign.id) }));
    return sendJson(res, 200, { campaigns });
  }

  if (parts[0] === "api" && parts[1] === "campaigns" && parts[2]) {
    const campaignId = decodeURIComponent(parts[2]);
    const section = parts[3];

    if (req.method === "GET" && section === "intelligence") {
      requireLocalCampaign(campaignId);
      return sendJson(res, 200, visibleCampaignIntelligence(campaignId));
    }

    if (req.method === "PUT" && section === "brief") {
      requireLocalCampaign(campaignId, { edit: true });
      const brief = { ...(await readJsonBody(req)), id: `brief-${campaignId}`, campaignId };
      localIntelligence.saveBrief(campaignId, brief);
      const supabaseWarning = await trySupabaseWrite(async () => {
        const hosted = await supabaseCampaignIntelligence(campaignId);
        await upsertSupabaseCampaignBrief({ ...brief, id: hosted.campaignBrief?.id || brief.id, title: brief.title || brief.product || localCampaign(campaignId).name, createdBy: requestUser?.id || null });
      });
      return sendJson(res, 200, { ok: true, intelligence: visibleCampaignIntelligence(campaignId), supabaseWarning });
    }

    if (section === "research-sources" && req.method === "POST" && ["text", "file"].includes(parts[4])) {
      requireLocalCampaign(campaignId, { edit: true });
      let sourceInput;
      if (parts[4] === "text") {
        const body = await readJsonBody(req);
        sourceInput = { ...body, type: "text" };
      } else {
        const fileName = String(req.headers["x-file-name"] || "research.txt");
        const type = path.extname(fileName).slice(1).toLowerCase() || "txt";
        sourceInput = { name: fileName, fileName, type, content: (await readBody(req)).toString("utf8") };
      }
      const source = prepareResearchSource(sourceInput);
      source.createdBy = requestUser?.id || "local";
      source.createdAt = new Date().toISOString();
      localIntelligence.addSource(campaignId, source);
      const supabaseWarning = await trySupabaseWrite(async () => {
        const intelligence = localIntelligence.getCampaign(campaignId);
        const hosted = await supabaseCampaignIntelligence(campaignId);
        const briefId = hosted.campaignBrief?.id || intelligence.brief.id || `brief-${campaignId}`;
        await upsertSupabaseCampaignBrief({ ...intelligence.brief, id: briefId, campaignId, title: intelligence.brief.title || intelligence.brief.product || localCampaign(campaignId).name });
        await upsertSupabaseResearchSource({ ...source, briefId });
      });
      return sendJson(res, 201, { ok: true, source, intelligence: visibleCampaignIntelligence(campaignId), supabaseWarning });
    }

    if (section === "research-sources" && req.method === "DELETE" && parts[4]) {
      requireLocalCampaign(campaignId, { edit: true });
      const sourceId = decodeURIComponent(parts[4]);
      localIntelligence.deleteSource(campaignId, sourceId);
      const supabaseWarning = await trySupabaseWrite(() => deleteSupabaseResearchSource(sourceId));
      return sendJson(res, 200, { ok: true, intelligence: visibleCampaignIntelligence(campaignId), supabaseWarning });
    }

    if (section === "market-reports" && req.method === "POST" && parts[4] === "generate") {
      requireLocalCampaign(campaignId, { edit: true });
      const body = await readJsonBody(req);
      const intelligence = localIntelligence.getCampaign(campaignId);
      const requestedIds = new Set(Array.isArray(body.sourceIds) ? body.sourceIds : []);
      const sources = requestedIds.size ? intelligence.sources.filter((source) => requestedIds.has(source.id)) : intelligence.sources;
      if (shouldQueueEngine()) {
        throw new Error("Hosted market-report generation must be queued through Supabase.");
      }
      const generated = await generateMarketReport({ brief: intelligence.brief, sources });
      const report = localIntelligence.saveReport(campaignId, {
        ...generated,
        id: `report-${Date.now()}`,
        status: "draft",
        sourceIds: sources.map((source) => source.id),
        createdBy: requestUser?.id || "local"
      });
      const supabaseWarning = await trySupabaseWrite(async () => {
        const hosted = await supabaseCampaignIntelligence(campaignId);
        await upsertSupabaseMarketReport({ ...report, briefId: hosted.campaignBrief?.id || intelligence.brief.id || `brief-${campaignId}`, campaignId });
      });
      return sendJson(res, 201, { ok: true, report, intelligence: visibleCampaignIntelligence(campaignId), supabaseWarning });
    }

    if (section === "market-reports" && parts[4] && req.method === "PUT") {
      requireLocalCampaign(campaignId, { edit: true });
      const report = localIntelligence.updateReport(campaignId, decodeURIComponent(parts[4]), { ...(await readJsonBody(req)), status: "draft", approvedBy: "", approvedAt: "" });
      const supabaseWarning = await trySupabaseWrite(async () => {
        const hosted = await supabaseCampaignIntelligence(campaignId);
        await upsertSupabaseMarketReport({ ...report, briefId: hosted.campaignBrief?.id || localIntelligence.getCampaign(campaignId).brief.id || `brief-${campaignId}`, campaignId });
      });
      return sendJson(res, 200, { ok: true, report, intelligence: visibleCampaignIntelligence(campaignId), supabaseWarning });
    }

    if (section === "market-reports" && parts[4] && parts[5] === "approve" && req.method === "POST") {
      requireLocalCampaign(campaignId, { edit: true });
      const report = localIntelligence.approveReport(campaignId, decodeURIComponent(parts[4]), requestUser?.id || "local-admin");
      const supabaseWarning = await trySupabaseWrite(async () => {
        const hosted = await supabaseCampaignIntelligence(campaignId);
        await upsertSupabaseMarketReport({ ...report, briefId: hosted.campaignBrief?.id || localIntelligence.getCampaign(campaignId).brief.id || `brief-${campaignId}`, campaignId });
      });
      return sendJson(res, 200, { ok: true, report, intelligence: visibleCampaignIntelligence(campaignId), supabaseWarning });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    return sendJson(res, 200, { projects: visibleProjects(), folders: readFolders() });
  }

  if (req.method === "GET" && url.pathname === "/api/folders") {
    return sendJson(res, 200, { folders: readFolders() });
  }

  if (req.method === "GET" && url.pathname === "/api/organization") {
    const organization = readOrganization();
    if (isAdmin) return sendJson(res, 200, organization);
    const projects = visibleProjects();
    const clientIds = new Set(projects.map((project) => project.clientId).filter(Boolean));
    const campaignIds = new Set(projects.map((project) => project.campaignId).filter(Boolean));
    return sendJson(res, 200, {
      clients: organization.clients.filter((client) => clientIds.has(client.id)),
      campaigns: organization.campaigns.filter((campaign) => campaignIds.has(campaign.id)),
      staff: organization.staff.filter((person) => person.id === requestUser?.id)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/media-library") {
    return sendJson(res, 200, { items: visibleMedia() });
  }

  if (req.method === "GET" && url.pathname === "/api/supabase/status") {
    return sendJson(res, 200, await supabaseStatus());
  }

  if (req.method === "POST" && url.pathname === "/api/supabase/init") {
    return sendJson(res, 200, { ok: true, status: await initializeSupabaseSchema() });
  }

  if (req.method === "POST" && url.pathname === "/api/supabase/sync-local") {
    requireAdmin();
    const core = await syncLocalSnapshotToSupabase({
      organization: readOrganization(),
      projects: allProjects(),
      mediaItems: mediaLibrary()
    });
    const intelligence = await syncLocalIntelligenceToSupabase();
    const result = { core, intelligence };
    return sendJson(res, 200, { ok: true, result, status: await supabaseStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/supabase/analytics") {
    return sendJson(res, 200, { analytics: await supabaseAnalytics(requestUser) });
  }

  if (req.method === "GET" && url.pathname === "/api/production-jobs") {
    const status = url.searchParams.get("status") || "";
    return sendJson(res, 200, { jobs: await listSupabaseProductionJobs({ status }) });
  }

  if (req.method === "POST" && url.pathname === "/api/clients") {
    requireAdmin();
    const body = await readJsonBody(req);
    const client = createClient(body);
    const supabaseWarning = await trySupabaseWrite(() => upsertSupabaseClient(client));
    return sendJson(res, 201, { ok: true, client, organization: readOrganization(), projects: listProjects(), folders: readFolders(), supabaseWarning });
  }

  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    requireAdmin();
    const body = await readJsonBody(req);
    const campaign = createCampaign(body);
    const supabaseWarning = await trySupabaseWrite(() => upsertSupabaseCampaign(campaign));
    return sendJson(res, 201, { ok: true, campaign, organization: readOrganization(), projects: listProjects(), folders: readFolders(), supabaseWarning });
  }

  if (req.method === "POST" && url.pathname === "/api/folders") {
    requireAdmin();
    const body = await readJsonBody(req);
    const folder = createFolder(body.name);
    return sendJson(res, 201, { ok: true, folder, folders: readFolders(), projects: listProjects() });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    requireAdmin();
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim().replace(/\s+/g, "-").toLowerCase();
    if (!name) throw new Error("Project name is required.");
    createProject(name, {
      type: body.type,
      folderId: body.folderId || "",
      clientId: body.clientId || "",
      campaignId: body.campaignId || "",
      assignedStaffId: body.assignedStaffId || "",
      reviewerId: body.reviewerId || "",
      priority: body.priority || "normal"
    });
    const project = getProjectSummary(name);
    const supabaseWarning = await trySupabaseWrite(() => upsertSupabaseProject(project));
    recordActivity("project.created", name, `Project ${name} created`, { type: project.type });
    return sendJson(res, 201, { project, supabaseWarning });
  }

  if (parts[0] === "api" && parts[1] === "folders" && parts[2]) {
    const folderId = decodeURIComponent(parts[2]);
    if (req.method === "PUT") {
      requireAdmin();
      const body = await readJsonBody(req);
      const folder = renameFolder(folderId, body.name);
      return sendJson(res, 200, { ok: true, folder, folders: readFolders(), projects: listProjects() });
    }
    if (req.method === "DELETE") {
      requireAdmin();
      deleteFolder(folderId);
      return sendJson(res, 200, { ok: true, folders: readFolders(), projects: listProjects() });
    }
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
    const project = decodeURIComponent(parts[2]);

    if (req.method === "GET" && parts.length === 3) {
      requireProjectAccess(project);
      return sendJson(res, 200, projectData(project));
    }

    if (req.method === "GET" && parts[3] === "jobs") {
      requireProjectAccess(project);
      return sendJson(res, 200, { jobs: await listSupabaseProductionJobs({ projectName: project }) });
    }

    if (req.method === "POST" && parts[3] === "jobs") {
      const body = await readJsonBody(req);
      return sendJson(res, 201, await createQueuedJob(project, body.jobType, body.payload || {}));
    }

    if (req.method === "DELETE" && parts.length === 3) {
      requireAdmin();
      deleteProject(project);
      const supabaseWarning = await trySupabaseWrite(() => deleteSupabaseProject(project));
      return sendJson(res, 200, { ok: true, projects: listProjects(), folders: readFolders(), supabaseWarning });
    }

    if (req.method === "PUT" && parts[3] === "meta") {
      requireProjectAccess(project);
      const body = await readJsonBody(req);
      const current = getProjectMeta(project);
      updateProjectMeta(project, {
        type: body.type,
        folderId: body.folderId ?? getProjectMeta(project).folderId,
        clientId: body.clientId,
        campaignId: body.campaignId,
        assignedStaffId: body.assignedStaffId,
        reviewerId: body.reviewerId,
        priority: body.priority,
        approvalStatus: body.approvalStatus,
        approvalFeedback: body.approvalFeedback,
        reviewSubmittedAt: body.reviewSubmittedAt,
        reviewedAt: body.reviewedAt
      });
      const summary = getProjectSummary(project);
      if (body.assignedStaffId !== undefined && body.assignedStaffId !== current.assignedStaffId) {
        recordActivity("project.assigned", project, `Project assigned to ${summary.assignedStaffId || "no one"}`, { assignedStaffId: summary.assignedStaffId || "" });
      }
      const supabaseWarning = await trySupabaseWrite(async () => {
        await upsertSupabaseProject(summary);
        if (body.approvalStatus) {
          await recordSupabaseApprovalEvent({
            projectName: project,
            status: body.approvalStatus,
            feedback: body.approvalFeedback ?? summary.approvalFeedback
          });
        }
      });
      if (body.approvalStatus) recordApprovalActivity(recordActivity, project, body.approvalStatus, body.approvalFeedback ?? summary.approvalFeedback);
      return sendJson(res, 200, { ok: true, project: summary, data: projectData(project), projects: listProjects(), folders: readFolders(), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "reference") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "reference");
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "reference.mp4"), buffer);
      recordActivity("asset.uploaded", project, "Reference video uploaded", { assetKind: "reference-video" });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, project: getProjectSummary(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "product") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "product");
      await saveImageAsset(buffer, dir, "product-image");
      recordActivity("asset.uploaded", project, "Product image uploaded", { assetKind: "product-image" });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, project: getProjectSummary(project), data: projectData(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "character") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "character");
      await saveImageAsset(buffer, dir, "character-reference");
      recordActivity("asset.uploaded", project, "Character reference uploaded", { assetKind: "character-reference" });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, project: getProjectSummary(project), data: projectData(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "analyze") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "analyze-reference", body));
      const result = await analyze(project, body.frames || 10);
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "analyze-reference") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "analyze-reference", body));
      const result = await analyze(project, body.frames || 12);
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "generate") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-content", body));
      const result = await generate(project, body.topic);
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "images") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-images", body));
      const projectDir = safeProject(project);
      const imagePrompts = readJson(path.join(projectDir, "generated", "image-prompts.json"));
      const result = await generateSceneImages({ projectDir, imagePrompts, limit: body.limit });
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "videos") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-videos", body));
      const projectDir = safeProject(project);
      const videoPrompts = readJson(path.join(projectDir, "generated", "video-prompts.json"));
      const result = await generateLibTvVideos({
        projectDir,
        videoPrompts,
        limit: body.limit ?? 1,
        maxSeconds: body.maxSeconds ?? 180
      });
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (parts[3] === "ugc-script" && req.method === "POST" && parts[4] === "analyze") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "analyze-ugc-script", body));
      const projectDir = safeProject(project);
      const transcript = body.mode === "manual"
        ? String(body.manualTranscript || "").trim()
        : transcriptText(jsonOrNull(path.join(projectDir, "analysis", "transcript.json")));
      if (!transcript) throw new Error(body.mode === "manual" ? "Paste an inspiration transcript before analysis." : "Analyze the reference video or paste a transcript first.");
      const result = await analyzeUgcInspiration({ transcript });
      const bundle = projectScriptBundle(project);
      bundle.analysis = result;
      writeProjectScriptBundle(bundle);
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (parts[3] === "ugc-script" && req.method === "POST" && parts[4] === "generate") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-ugc-script", body));
      const meta = getProjectMeta(project);
      if (!meta.campaignId) throw new Error("Assign this project to a campaign before script generation.");
      const intelligence = localIntelligence.getCampaign(meta.campaignId);
      const report = intelligence.reports.find((item) => item.id === body.marketReportId)
        || intelligence.activeReport;
      if (!report) throw new Error("Generate a market report for this campaign first.");
      const projectDir = safeProject(project);
      const transcript = transcriptText(jsonOrNull(path.join(projectDir, "analysis", "transcript.json")));
      const generated = await generateUgcScript({
        title: `${project} UGC Script`,
        transcript,
        scriptwriterInput: report.scriptwriterInput,
        marketReportId: report.id,
        reportStatus: report.status,
        role: requestUser?.role,
        isAdmin: requestUser?.role === "admin",
        overrideReason: body.overrideReason
      });
      const now = new Date().toISOString();
      let script = selectHook({
        ...generated,
        id: `script-${project}`,
        projectName: project,
        campaignId: meta.campaignId,
        currentVersionNumber: 0,
        createdAt: now,
        updatedAt: now
      }, generated.hooks[0].id);
      const bundle = projectScriptBundle(project, { importLegacy: false });
      const created = createScriptVersion({
        script,
        versions: bundle.versions,
        content: script,
        changeNote: "Generated from approved market intelligence",
        createdBy: requestUser?.id || "local",
        now
      });
      const version = { ...created.version, id: `${script.id}-v${created.version.versionNumber}` };
      script = { ...created.script, currentVersionId: version.id };
      bundle.script = script;
      bundle.versions = [...bundle.versions, version];
      writeProjectScriptBundle(bundle);
      writeJson(path.join(projectDir, "analysis", "market-report.json"), report);
      const supabaseWarning = await trySupabaseWrite(async () => {
        await upsertSupabaseUgcScript({ ...script, marketReportId: report.id, campaignId: meta.campaignId, projectName: project, createdBy: requestUser?.id || null });
        await upsertSupabaseUgcScriptVersion(version);
      });
      return sendJson(res, 200, { ok: true, result: script, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "ugc-script" && req.method === "PUT" && parts.length === 4) {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      const bundle = projectScriptBundle(project);
      if (!bundle.script) throw new Error("Generate a UGC script before editing it.");
      if (body.baseVersionId && body.baseVersionId !== bundle.script.currentVersionId) {
        throw new Error("This script changed since it was opened. Reload the latest version before saving.");
      }
      let script = {
        ...bundle.script,
        hooks: Array.isArray(body.hooks) ? body.hooks : bundle.script.hooks,
        scenes: Array.isArray(body.scenes) ? body.scenes : bundle.script.scenes,
        status: "draft",
        updatedAt: new Date().toISOString()
      };
      script = selectHook(script, body.selectedHookId || script.selectedHookId || script.hooks[0]?.id);
      const created = createScriptVersion({
        script,
        versions: bundle.versions,
        content: script,
        changeNote: body.changeNote || "Edited in UGC Script Studio",
        createdBy: requestUser?.id || "local"
      });
      const version = { ...created.version, id: `${script.id}-v${created.version.versionNumber}` };
      bundle.script = { ...created.script, currentVersionId: version.id };
      bundle.versions = [...bundle.versions, version];
      writeProjectScriptBundle(bundle);
      const supabaseWarning = await trySupabaseWrite(async () => {
        await upsertSupabaseUgcScript({ ...bundle.script, projectName: project, updatedBy: requestUser?.id || null });
        await upsertSupabaseUgcScriptVersion(version);
      });
      return sendJson(res, 200, { ok: true, result: bundle.script, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "ugc-script" && req.method === "POST" && parts[4] === "review") {
      requireProjectAccess(project);
      const body = await readJsonBody(req);
      const bundle = projectScriptBundle(project);
      if (!bundle.script) throw new Error("Generate a UGC script before reviewing it.");
      assertScriptReviewRole(bundle.script.status, body.status, requestUser);
      const transitioned = transitionScriptStatus(bundle.script, body.status, {
        versionId: bundle.script.currentVersionId,
        actorId: requestUser?.id || "local",
        feedback: body.feedback
      });
      const event = { ...transitioned.event, id: `${bundle.script.id}-review-${bundle.reviewEvents.length + 1}` };
      bundle.script = transitioned.script;
      bundle.reviewEvents = [...bundle.reviewEvents, event];
      writeProjectScriptBundle(bundle);
      const supabaseWarning = await trySupabaseWrite(async () => {
        await upsertSupabaseUgcScript({ ...bundle.script, projectName: project, updatedBy: requestUser?.id || null });
        await recordSupabaseScriptReviewEvent(event);
      });
      return sendJson(res, 200, { ok: true, result: bundle.script, event, data: projectData(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "generate-ugc-video") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      const projectDir = safeProject(project);
      const scriptBundle = projectScriptBundle(project);
      if (!scriptBundle.script) throw new Error("Generate and approve a UGC script before video generation.");
      const eligibility = assertVideoGenerationEligible(scriptBundle.script, {
        role: requestUser?.role,
        isAdmin: requestUser?.role === "admin",
        overrideReason: body.overrideReason,
        versionId: scriptBundle.script.currentVersionId,
        actorId: requestUser?.id || "local"
      });
      if (eligibility.auditEvent) {
        scriptBundle.reviewEvents = [...scriptBundle.reviewEvents, { ...eligibility.auditEvent, id: `${scriptBundle.script.id}-override-${scriptBundle.reviewEvents.length + 1}` }];
        writeProjectScriptBundle(scriptBundle);
      }
      const meta = getProjectMeta(project);
      const campaign = meta.campaignId ? localIntelligence.getCampaign(meta.campaignId) : null;
      const payload = {
        ...body,
        marketReportId: scriptBundle.script.marketReportId || campaign?.activeReportId || "",
        scriptId: scriptBundle.script.id,
        scriptVersionId: scriptBundle.script.currentVersionId,
        selectedHookId: scriptBundle.script.selectedHookId,
        override: eligibility.overridden ? eligibility.auditEvent : null
      };
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-ugc-video", payload));
      const blueprint = jsonOrNull(path.join(projectDir, "analysis", "reference-blueprint.json"))
        || jsonOrNull(path.join(projectDir, "analysis", "style-analysis.json"));
      if (!blueprint) throw new Error("Missing reference blueprint. Analyze reference first.");
      const result = await generateLibTvUgcVideo({
        projectDir,
        blueprint,
        script: scriptBundle.script,
        campaignBrief: campaign?.brief || null,
        maxSeconds: body.maxSeconds || 300
      });
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "transcribe-generated-video") {
      requireEditorAccess(project);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "transcribe-generated-video", {}));
      const result = await transcribeGeneratedVideo({ projectDir: safeProject(project) });
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "voiceover") {
      requireEditorAccess(project);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-voiceover", {}));
      const projectDir = safeProject(project);
      const scriptPlan = readJson(path.join(projectDir, "generated", "script-plan.json"));
      const result = await generateElevenLabsVoiceover({ projectDir, scriptPlan });
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "POST" && parts[3] === "render") {
      requireEditorAccess(project);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "render-final-video", {}));
      const result = await renderFinalVideo({ project, port, cwd: rootDir });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectRendersToSupabase(project));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "source-link") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "clipper-source-link", body));
      const result = await downloadClipperSource({ projectDir: safeProject(project), url: body.url });
      recordActivity("asset.uploaded", project, "Clipper source uploaded", { assetKind: "clipper-source" });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "reaction") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "clipper", "reaction");
      await saveReactionAsset(buffer, dir, req.headers["x-file-name"] || "");
      recordActivity("asset.uploaded", project, "Reaction asset uploaded", { assetKind: "reaction-character" });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, project: getProjectSummary(project), data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "analyze") {
      requireEditorAccess(project);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "clipper-analyze", {}));
      const result = await analyzeClipperSource({ projectDir: safeProject(project) });
      const supabaseWarning = await trySupabaseWrite(() => upsertSupabaseClipCandidates(project, result.candidates || []));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "select-highlight") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      const result = selectClipperHighlight({ projectDir: safeProject(project), highlightId: body.highlightId });
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "render") {
      requireEditorAccess(project);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "clipper-render", {}));
      const result = await renderClipperVideo({ project, port, cwd: rootDir });
      const supabaseWarning = await trySupabaseWrite(() => syncProjectRendersToSupabase(project));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "render-variations") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "clipper-render-variations", body));
      const projectDir = safeProject(project);
      const selected = jsonOrNull(path.join(projectDir, "clipper", "generated", "selected-highlight.json"));
      if (!selected) throw new Error("Make one highlight active before rendering character variations.");
      const reactionIds = Array.isArray(body.reactionIds) ? body.reactionIds : [];
      const reactions = listClipperReaction(projectDir, project);
      const reactionMap = new Map(reactions.map((reaction) => [reaction.id, reaction]));
      const selectedReactions = reactionIds.map((id) => reactionMap.get(id)).filter(Boolean);
      if (!selectedReactions.length) throw new Error("Select one or more reaction characters before rendering variations.");

      const outputs = [];
      for (let index = 0; index < selectedReactions.length; index += 1) {
        const reaction = selectedReactions[index];
        const rank = String(index + 1).padStart(2, "0");
        const outputName = `char-${rank}-${slugify(reaction.name || reaction.id)}__clip-${slugify(selected.title || selected.id)}.mp4`;
        try {
          const render = await renderClipperVideo({
            project,
            port,
            cwd: rootDir,
            outputName,
            outputDir: "renders/clips",
            reactionAsset: reaction
          });
          outputs.push({
            reactionId: reaction.id,
            reactionName: reaction.name,
            highlightId: selected.id,
            title: selected.title,
            output: render.output,
            status: "completed",
            clipStart: render.clipStart,
            clipEnd: render.clipEnd
          });
        } catch (error) {
          outputs.push({
            reactionId: reaction.id,
            reactionName: reaction.name,
            highlightId: selected.id,
            title: selected.title,
            output: path.join("renders", "clips", outputName).replace(/\\/g, "/"),
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
      writeJson(path.join(projectDir, "clipper", "generated", "clipper-character-variations-manifest.json"), result);
      const supabaseWarning = await trySupabaseWrite(() => syncProjectRendersToSupabase(project));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "render-bulk") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "clipper-render-bulk", body));
      const projectDir = safeProject(project);
      const candidatesManifest = readJson(path.join(projectDir, "clipper", "generated", "highlight-candidates.json"));
      const candidateMap = new Map((candidatesManifest.candidates || []).map((candidate) => [candidate.id, candidate]));
      const highlightIds = Array.isArray(body.highlightIds) ? body.highlightIds : [];
      const selections = highlightIds.map((id) => candidateMap.get(id)).filter(Boolean);
      if (!selections.length) throw new Error("Select at least one highlight candidate before bulk rendering.");
      const outputs = [];
      for (let index = 0; index < selections.length; index += 1) {
        const selection = selections[index];
        const rank = String(index + 1).padStart(2, "0");
        const outputName = `clip-${rank}-${slugify(selection.title || selection.id)}.mp4`;
        try {
          selectClipperHighlight({ projectDir, highlightId: selection.id });
          const render = await renderClipperVideo({ project, port, cwd: rootDir, outputName, outputDir: "renders/clips" });
          outputs.push({
            highlightId: selection.id,
            title: selection.title,
            output: render.output,
            status: "completed",
            clipStart: render.clipStart,
            clipEnd: render.clipEnd
          });
        } catch (error) {
          outputs.push({
            highlightId: selection.id,
            title: selection.title,
            output: path.join("renders", "clips", outputName),
            status: "failed",
            error: error.message
          });
        }
      }
      const result = {
        renderedAt: new Date().toISOString(),
        mode: "clipper-bulk",
        count: outputs.length,
        completed: outputs.filter((output) => output.status === "completed").length,
        failed: outputs.filter((output) => output.status === "failed").length,
        outputs
      };
      writeJson(path.join(projectDir, "clipper", "generated", "clipper-bulk-render-manifest.json"), result);
      const supabaseWarning = await trySupabaseWrite(() => syncProjectRendersToSupabase(project));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "pipeline") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "pipeline", body));
      await analyze(project, body.frames || 10);
      const result = await generate(project, body.topic);
      return sendJson(res, 200, { ok: true, result, data: projectData(project) });
    }

    if (req.method === "PUT" && parts[3] === "json") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      const target = editableFiles[body.key];
      if (!target) throw new Error("Unknown editable JSON key.");
      const filePath = path.join(safeProject(project), ...target);
      writeJson(filePath, body.data);
      return sendJson(res, 200, { ok: true, data: projectData(project) });
    }
  }

  return sendJson(res, 404, { error: "Not found" });
}

function serveMedia(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const project = decodeURIComponent(parts[1] || "");
  const rest = parts.slice(2).map(decodeURIComponent);
  const base = safeProject(project);
  const filePath = path.resolve(base, ...rest);
  if (!filePath.startsWith(path.resolve(base)) || !fileExists(filePath)) {
    return sendJson(res, 404, { error: "Media not found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".mp4"
    ? "video/mp4"
    : ext === ".webm"
      ? "video/webm"
    : ext === ".mov"
      ? "video/quicktime"
    : ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".mp3"
            ? "audio/mpeg"
            : ext === ".wav"
              ? "audio/wav"
          : "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Cross-Origin-Resource-Policy": "cross-origin"
  });
  fs.createReadStream(filePath).pipe(res);
}

const spaReservedPaths = ["/api", "/assets", "/mobile"];

function shouldServeSpaFallback(req, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (path.extname(pathname)) return false;
  return !spaReservedPaths.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : url.pathname === "/mobile" ? "mobile.html" : url.pathname.slice(1);
  const publicRoot = path.resolve(publicDir);
  let filePath = path.resolve(publicDir, requested);
  const relativePath = path.relative(publicRoot, filePath);
  const isInsidePublic = relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  if ((!isInsidePublic || !fileExists(filePath)) && shouldServeSpaFallback(req, url.pathname)) {
    filePath = path.join(publicDir, "index.html");
  } else if (!isInsidePublic || !fileExists(filePath)) {
    return sendJson(res, 404, { error: "Not found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (url.pathname.startsWith("/media/")) return serveMedia(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    console.log(`Content Machine dashboard: http://localhost:${port}`);
  });
}
