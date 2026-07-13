import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { projectPath } from "../config.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/files.js";
import { probeVideo } from "./video.js";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const isWindowsCmd = process.platform === "win32" && /\.cmd$/i.test(command);
    const child = spawn(isWindowsCmd ? "cmd.exe" : command, isWindowsCmd ? ["/d", "/s", "/c", command, ...args] : args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function mediaUrl({ port, project, localPath }) {
  return `http://localhost:${port}/media/${encodeURIComponent(project)}/${localPath.split("/").map(encodeURIComponent).join("/")}`;
}

function findSceneVideo(projectDir, sceneNumber) {
  const videosDir = path.join(projectDir, "assets", "videos");
  const stem = `scene-${String(sceneNumber).padStart(2, "0")}`;
  if (!fs.existsSync(videosDir)) return "";
  const match = fs.readdirSync(videosDir)
    .filter((file) => /\.(mp4|mov|webm)$/i.test(file))
    .sort()
    .sort((a, b) => {
      const exactA = path.parse(a).name.toLowerCase() === stem ? 0 : 1;
      const exactB = path.parse(b).name.toLowerCase() === stem ? 0 : 1;
      return exactA - exactB || a.localeCompare(b);
    })
    .find((file) => file.toLowerCase().startsWith(stem));
  return match ? `assets/videos/${match}` : "";
}

function findSceneImage(projectDir, sceneNumber) {
  const imagesDir = path.join(projectDir, "assets", "images");
  const stem = `scene-${String(sceneNumber).padStart(2, "0")}`;
  if (!fs.existsSync(imagesDir)) return "";
  const match = fs.readdirSync(imagesDir)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    .sort()
    .find((file) => file.toLowerCase().startsWith(stem));
  return match ? `assets/images/${match}` : "";
}

export function listRenders(projectDir, project) {
  const rendersDir = path.join(projectDir, "renders");
  if (!fs.existsSync(rendersDir)) return [];
  const directRenders = fs.readdirSync(rendersDir)
    .filter((file) => /\.(mp4|mov|webm)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/renders/${encodeURIComponent(file)}?v=${fs.statSync(path.join(rendersDir, file)).mtimeMs}`
    }));
  const clipsDir = path.join(rendersDir, "clips");
  const clipRenders = fs.existsSync(clipsDir)
    ? fs.readdirSync(clipsDir)
      .filter((file) => /\.(mp4|mov|webm)$/i.test(file))
      .sort()
      .map((file) => ({
        name: `clips/${file}`,
        url: `/media/${encodeURIComponent(project)}/renders/clips/${encodeURIComponent(file)}?v=${fs.statSync(path.join(clipsDir, file)).mtimeMs}`
      }))
    : [];
  return [...directRenders, ...clipRenders];
}

export async function buildRemotionProps({ project, port }) {
  const projectDir = projectPath(project);
  const ugcVideoPath = path.join(projectDir, "assets", "videos", "ugc-output.mp4");
  const subtitlePlanPath = path.join(projectDir, "generated", "subtitle-plan.json");
  if (fileExists(ugcVideoPath)) {
    const metadata = await probeVideo(ugcVideoPath);
    const subtitlePlan = fileExists(subtitlePlanPath) ? readJson(subtitlePlanPath) : { subtitles: [] };
    return {
      mode: "ugc",
      format: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: metadata.durationSeconds
      },
      ugcVideoUrl: mediaUrl({ port, project, localPath: "assets/videos/ugc-output.mp4" }),
      subtitles: subtitlePlan.subtitles || []
    };
  }

  const editPlanPath = path.join(projectDir, "generated", "edit-plan.json");
  if (!fileExists(editPlanPath)) throw new Error("Missing edit-plan.json. Generate content prompts first.");

  const editPlan = readJson(editPlanPath);
  const scenes = (editPlan.scenes || []).map((scene) => {
    const videoPath = findSceneVideo(projectDir, scene.scene);
    const imagePath = findSceneImage(projectDir, scene.scene);
    return {
      scene: scene.scene,
      durationSeconds: Number(scene.durationSeconds || scene.duration || 4),
      caption: scene.caption || "",
      highlightWords: scene.highlightWords || [],
      videoUrl: videoPath ? mediaUrl({ port, project, localPath: videoPath }) : "",
      imageUrl: imagePath ? mediaUrl({ port, project, localPath: imagePath }) : ""
    };
  });

  if (!scenes.some((scene) => scene.videoUrl || scene.imageUrl)) {
    throw new Error("No scene videos or images found. Generate images/videos before rendering.");
  }

  return {
    format: editPlan.format || { width: 1080, height: 1920, fps: 30 },
    audioUrl: fs.existsSync(path.join(projectDir, "assets", "audio", "voiceover.mp3"))
      ? mediaUrl({ port, project, localPath: "assets/audio/voiceover.mp3" })
      : "",
    scenes
  };
}

export async function buildClipperRemotionProps({ project, port, reactionAsset = null, selectedHighlight = null, subtitlePlan = null, sourceMetadata = null }) {
  const projectDir = projectPath(project);
  const sourceVideoPath = path.join(projectDir, "clipper", "source", "source-video.mp4");
  const selectedPath = path.join(projectDir, "clipper", "generated", "selected-highlight.json");
  const subtitlePlanPath = path.join(projectDir, "clipper", "generated", "clip-subtitle-plan.json");
  if (!fileExists(sourceVideoPath)) throw new Error("Missing clipper source video. Download a source link first.");
  if (!selectedHighlight && !fileExists(selectedPath)) throw new Error("Select a highlight candidate before rendering.");

  const metadata = sourceMetadata || await probeVideo(sourceVideoPath);
  const selected = selectedHighlight || readJson(selectedPath);
  const resolvedSubtitlePlan = subtitlePlan || (fileExists(subtitlePlanPath) ? readJson(subtitlePlanPath) : { subtitles: [] });
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  const reactionPath = reactionAsset?.path || (fs.existsSync(reactionDir)
    ? fs.readdirSync(reactionDir)
      .filter((file) => /\.(png|jpg|jpeg|webp|mp4|mov|webm)$/i.test(file))
      .sort()[0]
    : "");
  const normalizedReactionPath = reactionPath && !reactionPath.startsWith("clipper/")
    ? `clipper/reaction/${reactionPath}`
    : reactionPath;
  const reactionMetadata = normalizedReactionPath && /\.(mp4|mov|webm)$/i.test(normalizedReactionPath)
    ? await probeVideo(path.join(projectDir, normalizedReactionPath))
    : null;

  return {
    mode: "clipper",
    format: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: Number(selected.durationSeconds || selected.end - selected.start || 45)
    },
    clipper: {
      sourceVideoUrl: mediaUrl({ port, project, localPath: "clipper/source/source-video.mp4" }),
      start: Number(selected.start || 0),
      end: Number(selected.end || selected.start + 45),
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      reactionUrl: normalizedReactionPath ? mediaUrl({ port, project, localPath: normalizedReactionPath }) : "",
      reactionType: normalizedReactionPath && /\.(mp4|mov|webm)$/i.test(normalizedReactionPath) ? "video" : normalizedReactionPath ? "image" : "",
      reactionDurationSeconds: reactionMetadata?.durationSeconds || 0,
      reactionId: reactionAsset?.id || "",
      reactionName: reactionAsset?.name || "",
      title: selected.title || ""
    },
    subtitles: resolvedSubtitlePlan.subtitles || []
  };
}

export async function renderFinalVideo({ project, port, cwd }) {
  const projectDir = projectPath(project);
  const rendersDir = path.join(projectDir, "renders");
  const generatedDir = path.join(projectDir, "generated");
  ensureDir(rendersDir);

  const props = await buildRemotionProps({ project, port });
  const propsPath = path.join(generatedDir, "remotion-props.json");
  const outputPath = path.join(rendersDir, "final.mp4");
  writeJson(propsPath, props);

  await run("npx.cmd", [
    "remotion",
    "render",
    "src/remotion/index.jsx",
    "ContentMachine",
    outputPath,
    "--props",
    propsPath,
    "--overwrite",
    "--codec",
    "h264",
    "--pixel-format",
    "yuv420p"
  ], { cwd });

  const manifest = {
    renderedAt: new Date().toISOString(),
    output: "renders/final.mp4",
    props: "generated/remotion-props.json",
    scenes: (props.scenes || []).map((scene) => ({
      scene: scene.scene,
      hasVideo: Boolean(scene.videoUrl),
      hasImage: Boolean(scene.imageUrl),
      durationSeconds: scene.durationSeconds
    })),
    mode: props.mode || "legacy",
    subtitleCount: props.subtitles?.length || 0
  };
  writeJson(path.join(generatedDir, "render-manifest.json"), manifest);
  return manifest;
}

function slugify(text) {
  return String(text || "clip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "clip";
}

export async function renderClipperVideo({ project, port, cwd, outputName = "final-clip.mp4", outputDir = "renders", reactionAsset = null, selectedHighlight = null, subtitlePlan = null }) {
  const projectDir = projectPath(project);
  const rendersDir = path.join(projectDir, outputDir);
  const generatedDir = path.join(projectDir, "clipper", "generated");
  ensureDir(rendersDir);
  ensureDir(generatedDir);

  const props = await buildClipperRemotionProps({ project, port, reactionAsset, selectedHighlight, subtitlePlan });
  const propsPath = path.join(generatedDir, "clipper-remotion-props.json");
  const outputPath = path.join(rendersDir, outputName);
  writeJson(propsPath, props);

  await run("npx.cmd", [
    "remotion",
    "render",
    "src/remotion/index.jsx",
    "ContentMachine",
    outputPath,
    "--props",
    propsPath,
    "--overwrite",
    "--codec",
    "h264",
    "--pixel-format",
    "yuv420p"
  ], { cwd });

  const manifest = {
    renderedAt: new Date().toISOString(),
    output: `${outputDir}/${outputName}`.replace(/\\/g, "/"),
    props: "clipper/generated/clipper-remotion-props.json",
    mode: "clipper",
    selectedHighlight: props.clipper?.title || "",
    clipStart: props.clipper?.start || 0,
    clipEnd: props.clipper?.end || 0,
    subtitleCount: props.subtitles?.length || 0,
    hasReaction: Boolean(props.clipper?.reactionUrl),
    reactionId: props.clipper?.reactionId || "",
    reactionName: props.clipper?.reactionName || ""
  };
  writeJson(path.join(generatedDir, "clipper-render-manifest.json"), manifest);
  return manifest;
}

export async function renderClipperBulkVideos({ project, port, cwd, selections }) {
  const projectDir = projectPath(project);
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const clipsDir = path.join(projectDir, "renders", "clips");
  ensureDir(clipsDir);
  ensureDir(generatedDir);

  const outputs = [];
  for (let index = 0; index < selections.length; index += 1) {
    const selected = selections[index];
    const rank = String(index + 1).padStart(2, "0");
    const outputName = `clip-${rank}-${slugify(selected.title || selected.id)}.mp4`;
    const result = await renderClipperVideo({
      project,
      port,
      cwd,
      outputName,
      outputDir: "renders/clips"
    });
    outputs.push({
      highlightId: selected.id,
      title: selected.title,
      output: result.output,
      status: "completed",
      clipStart: result.clipStart,
      clipEnd: result.clipEnd
    });
  }

  const manifest = {
    renderedAt: new Date().toISOString(),
    mode: "clipper-bulk",
    count: outputs.length,
    outputs
  };
  writeJson(path.join(generatedDir, "clipper-bulk-render-manifest.json"), manifest);
  return manifest;
}
