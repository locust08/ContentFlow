import path from "node:path";
import { loadEnv, projectPath } from "../config.js";
import { parseArgs, requireArg } from "../utils/args.js";
import { fileExists, writeJson } from "../utils/files.js";
import { extractAudio, extractFrames } from "../services/video.js";
import { analyzeReference } from "../services/referenceAnalyzer.js";
import { transcribeAudio } from "../services/openaiClient.js";

loadEnv();

const args = parseArgs();
const project = requireArg(args, "project");
const projectDir = projectPath(project);
const referenceVideo = path.join(projectDir, "reference", "reference.mp4");
const framesDir = path.join(projectDir, "analysis", "frames");

if (!fileExists(referenceVideo)) {
  throw new Error(`Missing reference video: ${referenceVideo}`);
}

console.log("Extracting metadata and key frames...");
const metadata = await extractFrames(referenceVideo, framesDir, Number(args.frames ?? 10));
writeJson(path.join(projectDir, "analysis", "metadata.json"), metadata);

console.log("Extracting and transcribing audio...");
const audioPath = await extractAudio(referenceVideo, path.join(projectDir, "analysis", "audio.wav"));
const transcript = await transcribeAudio(audioPath);
writeJson(path.join(projectDir, "analysis", "transcript.json"), transcript);

console.log("Creating style analysis...");
const styleAnalysis = await analyzeReference({ projectDir, metadata, transcript });
writeJson(path.join(projectDir, "analysis", "style-analysis.json"), styleAnalysis);

console.log(`Done: ${path.join(projectDir, "analysis", "style-analysis.json")}`);
