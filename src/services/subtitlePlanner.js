import path from "node:path";
import { extractAudio, probeVideo } from "./video.js";
import { transcribeAudioWithTimestamps } from "./openaiClient.js";
import { writeJson } from "../utils/files.js";

function splitTranscriptEvenly(text, durationSeconds) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const chunkSize = 7;
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  const chunkDuration = durationSeconds / Math.max(chunks.length, 1);
  return chunks.map((caption, index) => ({
    start: Number((index * chunkDuration).toFixed(2)),
    end: Number(Math.min(durationSeconds, (index + 1) * chunkDuration).toFixed(2)),
    text: caption,
    highlightWords: pickHighlights(caption)
  }));
}

function pickHighlights(text) {
  return String(text)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length >= 5 || /^[A-Z0-9]+$/.test(word))
    .slice(0, 2);
}

function normalizeSegments(segments, durationSeconds, fallbackText) {
  if (!segments?.length) return splitTranscriptEvenly(fallbackText, durationSeconds);
  return segments.map((segment) => ({
    start: Math.max(0, Number(segment.start || 0)),
    end: Math.min(durationSeconds, Number(segment.end || segment.start + 2)),
    text: String(segment.text || "").trim(),
    highlightWords: pickHighlights(segment.text)
  })).filter((segment) => segment.text && segment.end > segment.start);
}

export async function transcribeGeneratedVideo({ projectDir }) {
  const videoPath = path.join(projectDir, "assets", "videos", "ugc-output.mp4");
  const audioPath = path.join(projectDir, "analysis", "generated-audio.wav");
  const metadata = await probeVideo(videoPath);
  await extractAudio(videoPath, audioPath);
  const transcript = await transcribeAudioWithTimestamps(audioPath);
  const subtitles = normalizeSegments(transcript.segments, metadata.durationSeconds, transcript.text);

  const transcriptOut = {
    ...transcript,
    video: "assets/videos/ugc-output.mp4",
    durationSeconds: metadata.durationSeconds
  };
  const subtitlePlan = {
    generatedAt: new Date().toISOString(),
    source: "analysis/generated-transcript.json",
    video: "assets/videos/ugc-output.mp4",
    durationSeconds: metadata.durationSeconds,
    style: {
      placement: "bottom-third",
      preset: "bold-ugc-pop",
      highlightColor: "#ffd43b"
    },
    subtitles
  };

  writeJson(path.join(projectDir, "analysis", "generated-transcript.json"), transcriptOut);
  writeJson(path.join(projectDir, "generated", "subtitle-plan.json"), subtitlePlan);
  return { transcript: transcriptOut, subtitlePlan };
}
