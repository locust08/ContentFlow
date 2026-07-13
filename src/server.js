import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, URL } from "node:url";
import { loadEnv, projectPath, projectsDir, rootDir } from "./config.js";
import { createFolder, createProject, deleteFolder, deleteProject, getProjectMeta, readFolders, renameFolder, updateProjectMeta } from "./services/project.js";
import { createCampaign, createClient, readOrganization } from "./services/organization.js";
import { canAccessProject, filterMediaForUser, filterProjectsForUser } from "./services/access.js";
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
import {
  createSupabaseProductionJob,
  deleteSupabaseProject,
  initializeSupabaseSchema,
  listSupabaseMediaItems,
  listSupabaseOrganization,
  listSupabaseProjectSummaries,
  listSupabaseProductionJobs,
  recordSupabaseApprovalEvent,
  supabaseAnalytics,
  supabaseProjectData,
  supabaseStatus,
  syncLocalSnapshotToSupabase,
  upsertSupabaseAsset,
  upsertSupabaseCampaign,
  upsertSupabaseClipCandidates,
  upsertSupabaseClient,
  upsertSupabaseProject,
  upsertSupabaseRenderJob
} from "./services/supabaseDb.js";
import { ensureDir, fileExists, readJson, writeJson } from "./utils/files.js";
import { run } from "./utils/exec.js";

loadEnv();

const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 4173);

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
    files: {
      metadata: jsonOrNull(path.join(dir, "analysis", "metadata.json")),
      transcript: jsonOrNull(path.join(dir, "analysis", "transcript.json")),
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
    const data = hostedDemoMode() ? await supabaseProjectData(projectName) : projectData(projectName);
    return { ok: true, queued: true, job: created, project: summary, data };
  };

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
      return sendJson(res, 201, { project });
    }

    if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
      const project = decodeURIComponent(parts[2]);

      if (req.method === "GET" && parts.length === 3) {
        await requireHostedProjectAccess(project);
        const data = await supabaseProjectData(project);
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
        if (body.approvalStatus) {
          await recordSupabaseApprovalEvent({
            projectName: project,
            status: body.approvalStatus,
            feedback: body.approvalFeedback ?? next.approvalFeedback
          });
        }
        return sendJson(res, 200, {
          ok: true,
          project: next,
          data: await supabaseProjectData(project),
          projects: await hostedVisibleProjects(),
          folders: []
        });
      }

      const queueMap = {
        "analyze": "analyze-reference",
        "analyze-reference": "analyze-reference",
        "generate": "generate-content",
        "images": "generate-images",
        "videos": "generate-videos",
        "generate-ugc-video": "generate-ugc-video",
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
          return sendJson(res, 200, { ok: true, data: await supabaseProjectData(project) });
        }
      }
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
    const result = await syncLocalSnapshotToSupabase({
      organization: readOrganization(),
      projects: allProjects(),
      mediaItems: mediaLibrary()
    });
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
      return sendJson(res, 200, { ok: true, project: summary, data: projectData(project), projects: listProjects(), folders: readFolders(), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "reference") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "reference");
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "reference.mp4"), buffer);
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, project: getProjectSummary(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "product") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "product");
      await saveImageAsset(buffer, dir, "product-image");
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, project: getProjectSummary(project), data: projectData(project), supabaseWarning });
    }

    if (req.method === "POST" && parts[3] === "character") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "character");
      await saveImageAsset(buffer, dir, "character-reference");
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

    if (req.method === "POST" && parts[3] === "generate-ugc-video") {
      requireEditorAccess(project);
      const body = await readJsonBody(req);
      if (shouldQueueEngine()) return sendJson(res, 202, await createQueuedJob(project, "generate-ugc-video", body));
      const projectDir = safeProject(project);
      const blueprint = jsonOrNull(path.join(projectDir, "analysis", "reference-blueprint.json"))
        || jsonOrNull(path.join(projectDir, "analysis", "style-analysis.json"));
      if (!blueprint) throw new Error("Missing reference blueprint. Analyze reference first.");
      const result = await generateLibTvUgcVideo({ projectDir, blueprint, maxSeconds: body.maxSeconds || 300 });
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
      const supabaseWarning = await trySupabaseWrite(() => syncProjectAssetsToSupabase(project));
      return sendJson(res, 200, { ok: true, result, data: projectData(project), supabaseWarning });
    }

    if (parts[3] === "clipper" && req.method === "POST" && parts[4] === "reaction") {
      requireEditorAccess(project);
      const buffer = await readBody(req);
      const dir = path.join(safeProject(project), "clipper", "reaction");
      await saveReactionAsset(buffer, dir, req.headers["x-file-name"] || "");
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

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : url.pathname === "/mobile" ? "mobile.html" : url.pathname.slice(1);
  const filePath = path.resolve(publicDir, requested);
  if (!filePath.startsWith(path.resolve(publicDir)) || !fileExists(filePath)) {
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
