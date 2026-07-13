import path from "node:path";
import { run } from "../utils/exec.js";
import { ensureDir } from "../utils/files.js";

export async function probeVideo(videoPath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=width,height,r_frame_rate,codec_type",
    "-of", "json",
    videoPath
  ]);
  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((stream) => stream.codec_type === "video") ?? {};
  const [fpsNum, fpsDen] = String(videoStream.r_frame_rate || "30/1").split("/").map(Number);

  return {
    path: videoPath,
    durationSeconds: Number(data.format?.duration ?? 0),
    width: Number(videoStream.width ?? 0),
    height: Number(videoStream.height ?? 0),
    fps: fpsDen ? fpsNum / fpsDen : fpsNum
  };
}

export async function extractFrames(videoPath, framesDir, count = 10) {
  ensureDir(framesDir);
  const metadata = await probeVideo(videoPath);
  const interval = Math.max(metadata.durationSeconds / count, 1);
  const pattern = path.join(framesDir, "frame-%03d.jpg");

  await run("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vf", `fps=1/${interval},scale=720:-1`,
    "-frames:v", String(count),
    pattern
  ]);

  return {
    ...metadata,
    frameCountRequested: count,
    framePattern: pattern
  };
}

export async function extractAudio(videoPath, audioPath) {
  ensureDir(path.dirname(audioPath));
  const ext = path.extname(audioPath).toLowerCase();
  const codecArgs = ext === ".mp3"
    ? ["-acodec", "libmp3lame", "-b:a", "48k"]
    : ["-acodec", "pcm_s16le"];

  await run("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    ...codecArgs,
    "-ar", "16000",
    "-ac", "1",
    audioPath
  ]);

  return audioPath;
}
