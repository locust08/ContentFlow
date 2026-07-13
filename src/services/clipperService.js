import fs from "node:fs";
import path from "node:path";
import { extractAudio, probeVideo } from "./video.js";
import { generateJson, transcribeAudioWithTimestamps } from "./openaiClient.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/files.js";
import { run } from "../utils/exec.js";

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv)$/i;

function cleanDir(dir, matcher = () => true) {
  ensureDir(dir);
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isFile() && matcher(file)) {
      fs.unlinkSync(filePath);
    }
  }
}

function pickHighlights(text) {
  return String(text || "")
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length >= 5 || /^[A-Z0-9]+$/.test(word))
    .slice(0, 3);
}

function normalizeUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Paste a valid YouTube or TikTok URL.");
  return url;
}

function findDownloadedVideo(sourceDir) {
  return fs.readdirSync(sourceDir)
    .filter((file) => VIDEO_EXTENSIONS.test(file))
    .sort((a, b) => {
      const aMp4 = a.toLowerCase().endsWith(".mp4") ? 0 : 1;
      const bMp4 = b.toLowerCase().endsWith(".mp4") ? 0 : 1;
      return aMp4 - bMp4 || a.localeCompare(b);
    })[0];
}

async function convertToMp4(inputPath, outputPath) {
  await run("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ]);
}

export async function downloadClipperSource({ projectDir, url }) {
  const sourceUrl = normalizeUrl(url);
  const sourceDir = path.join(projectDir, "clipper", "source");
  const analysisDir = path.join(projectDir, "clipper", "analysis");
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const rendersDir = path.join(projectDir, "renders");
  cleanDir(sourceDir, (file) => VIDEO_EXTENSIONS.test(file) || file.startsWith("source-video."));
  cleanDir(analysisDir, (file) => /\.(json|wav|mp3)$/i.test(file));
  cleanDir(generatedDir, (file) => /\.json$/i.test(file));
  if (fs.existsSync(path.join(rendersDir, "final-clip.mp4"))) {
    fs.unlinkSync(path.join(rendersDir, "final-clip.mp4"));
  }
  ensureDir(analysisDir);
  ensureDir(generatedDir);

  await run("yt-dlp", [
    "--no-playlist",
    "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "-o", path.join(sourceDir, "source-video.%(ext)s"),
    sourceUrl
  ]);

  const downloaded = findDownloadedVideo(sourceDir);
  if (!downloaded) throw new Error("yt-dlp did not return a downloadable video file.");

  const downloadedPath = path.join(sourceDir, downloaded);
  const finalPath = path.join(sourceDir, "source-video.mp4");
  if (path.resolve(downloadedPath) !== path.resolve(finalPath)) {
    if (downloaded.toLowerCase().endsWith(".mp4")) {
      fs.renameSync(downloadedPath, finalPath);
    } else {
      await convertToMp4(downloadedPath, finalPath);
      fs.unlinkSync(downloadedPath);
    }
  }

  const metadata = await probeVideo(finalPath);
  const sourceManifest = {
    url: sourceUrl,
    downloadedAt: new Date().toISOString(),
    file: "clipper/source/source-video.mp4",
    metadata
  };
  writeJson(path.join(sourceDir, "source-url.json"), sourceManifest);
  writeJson(path.join(analysisDir, "source-metadata.json"), metadata);
  return sourceManifest;
}

function clampCandidate(candidate, index, durationSeconds) {
  const rawStart = Number(candidate.start ?? candidate.startSeconds ?? 0);
  const rawEnd = Number(candidate.end ?? candidate.endSeconds ?? rawStart + 45);
  const start = Math.max(0, Math.min(durationSeconds - 1, rawStart));
  const maxEnd = Math.min(durationSeconds, start + 60);
  const targetEnd = Math.max(start + 15, Math.min(maxEnd, rawEnd));
  const end = Math.min(durationSeconds, targetEnd);
  const rawScore = Number(candidate.score || 70);
  const score = rawScore <= 10 ? rawScore * 10 : rawScore;
  return {
    id: candidate.id || `highlight-${String(index + 1).padStart(2, "0")}`,
    title: String(candidate.title || `Highlight ${index + 1}`).slice(0, 90),
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    durationSeconds: Number((end - start).toFixed(2)),
    score: Math.max(1, Math.min(100, score)),
    reason: String(candidate.reason || "Strong moment based on speech intensity and context."),
    hook: String(candidate.hook || candidate.summary || ""),
    highlightWords: Array.isArray(candidate.highlightWords) ? candidate.highlightWords.slice(0, 8) : []
  };
}

function fallbackCandidates(transcript, durationSeconds) {
  const segments = transcript.segments || [];
  if (!segments.length) {
    return [clampCandidate({
      title: "Best available moment",
      start: 0,
      end: Math.min(durationSeconds, 45),
      score: 55,
      reason: "No timestamped transcript was available, so the clipper selected the opening segment.",
      hook: "Opening segment"
    }, 0, durationSeconds)];
  }

  const windows = [];
  for (let i = 0; i < segments.length; i += 1) {
    const start = Number(segments[i].start || 0);
    let end = start;
    let text = "";
    for (let j = i; j < segments.length; j += 1) {
      end = Number(segments[j].end || segments[j].start || end);
      text = `${text} ${segments[j].text || ""}`.trim();
      if (end - start >= 30) break;
    }
    const duration = end - start;
    if (duration >= 15) {
      const energy = (text.match(/[!?]/g) || []).length * 8 + Math.min(35, text.split(/\s+/).length / 4);
      windows.push({
        title: text.split(/[.!?]/)[0]?.slice(0, 72) || "Highlight moment",
        start,
        end: Math.min(start + 60, Math.max(end, start + 30)),
        score: Math.round(55 + energy),
        reason: "Fallback score based on dense speech and emphasis marks.",
        hook: text.slice(0, 180),
        highlightWords: pickHighlights(text)
      });
    }
  }

  return windows
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((candidate, index) => clampCandidate(candidate, index, durationSeconds));
}

async function generateHighlightCandidates({ transcript, metadata }) {
  const segmentsForPrompt = (transcript.segments || []).slice(0, 260).map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text
  }));

  const aiResult = await generateJson({
    system: [
      "You are a viral short-form video editor for streamer, influencer, podcast, and entertainment clips.",
      "Find highlight moments that can become strong 9:16 social clips.",
      "Choose moments with a clear hook, payoff, emotion, surprise, conflict, joke, insight, or high-retention context.",
      "Return JSON only."
    ].join("\n"),
    user: JSON.stringify({
      task: "Pick the best 30-60 second highlight candidates from this timestamped transcript.",
      rules: [
        "Return 3 to 6 candidates.",
        "Prefer 30-60 seconds, but allow 20 seconds if the moment is very tight.",
        "Do not choose random filler.",
        "Each candidate must include id, title, start, end, score, reason, hook, and highlightWords."
      ],
      sourceDurationSeconds: metadata.durationSeconds,
      sourceFormat: `${metadata.width}x${metadata.height}`,
      transcriptText: transcript.text,
      segments: segmentsForPrompt
    }),
    schemaName: "clipper_highlight_candidates"
  });

  const candidates = Array.isArray(aiResult?.candidates) ? aiResult.candidates : [];
  return candidates
    .map((candidate, index) => clampCandidate(candidate, index, metadata.durationSeconds))
    .filter((candidate) => candidate.end > candidate.start)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function analyzeClipperSource({ projectDir }) {
  const sourcePath = path.join(projectDir, "clipper", "source", "source-video.mp4");
  if (!fileExists(sourcePath)) throw new Error("Download a clipper source link first.");

  const analysisDir = path.join(projectDir, "clipper", "analysis");
  const generatedDir = path.join(projectDir, "clipper", "generated");
  ensureDir(analysisDir);
  ensureDir(generatedDir);

  const metadata = await probeVideo(sourcePath);
  writeJson(path.join(analysisDir, "source-metadata.json"), metadata);

  const audioPath = path.join(analysisDir, "source-audio.mp3");
  await extractAudio(sourcePath, audioPath);
  const transcript = await transcribeAudioWithTimestamps(audioPath);
  const transcriptOut = {
    ...transcript,
    video: "clipper/source/source-video.mp4",
    durationSeconds: metadata.durationSeconds
  };
  writeJson(path.join(analysisDir, "source-transcript.json"), transcriptOut);

  let candidates = await generateHighlightCandidates({ transcript: transcriptOut, metadata });
  if (!candidates.length) candidates = fallbackCandidates(transcriptOut, metadata.durationSeconds);

  const manifest = {
    generatedAt: new Date().toISOString(),
    targetDuration: "30-60 seconds",
    source: "clipper/analysis/source-transcript.json",
    candidates
  };
  writeJson(path.join(generatedDir, "highlight-candidates.json"), manifest);
  return { metadata, transcript: transcriptOut, candidates: manifest };
}

function buildClipSubtitles({ transcript, selected }) {
  const start = Number(selected.start || 0);
  const end = Number(selected.end || start + 45);
  const selectedWords = new Set((selected.highlightWords || []).map((word) => String(word).toLowerCase()));
  return (transcript.segments || [])
    .filter((segment) => Number(segment.end || 0) > start && Number(segment.start || 0) < end)
    .map((segment) => {
      const localStart = Math.max(0, Number(segment.start || 0) - start);
      const localEnd = Math.min(end - start, Number(segment.end || segment.start || 0) - start);
      const fallbackHighlights = pickHighlights(segment.text);
      const highlightWords = fallbackHighlights.length ? fallbackHighlights : Array.from(selectedWords).slice(0, 3);
      return {
        start: Number(localStart.toFixed(2)),
        end: Number(Math.max(localStart + 0.4, localEnd).toFixed(2)),
        text: String(segment.text || "").trim(),
        highlightWords
      };
    })
    .filter((subtitle) => subtitle.text && subtitle.end > subtitle.start);
}

export function selectClipperHighlight({ projectDir, highlightId }) {
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const analysisDir = path.join(projectDir, "clipper", "analysis");
  const candidatesManifest = readJson(path.join(generatedDir, "highlight-candidates.json"));
  const candidates = candidatesManifest.candidates || [];
  const selected = candidates.find((candidate) => candidate.id === highlightId) || candidates[0];
  if (!selected) throw new Error("No highlight candidates found. Run clipper analysis first.");

  const transcript = readJson(path.join(analysisDir, "source-transcript.json"));
  const subtitles = buildClipSubtitles({ transcript, selected });
  const subtitlePlan = {
    generatedAt: new Date().toISOString(),
    source: "clipper/analysis/source-transcript.json",
    video: "clipper/source/source-video.mp4",
    selectedHighlightId: selected.id,
    clipStart: selected.start,
    clipEnd: selected.end,
    durationSeconds: selected.durationSeconds,
    style: {
      placement: "bottom-third",
      preset: "bold-ugc-pop",
      highlightColor: "#ffd43b"
    },
    subtitles
  };

  writeJson(path.join(generatedDir, "selected-highlight.json"), selected);
  writeJson(path.join(generatedDir, "clip-subtitle-plan.json"), subtitlePlan);
  return { selected, subtitlePlan };
}
