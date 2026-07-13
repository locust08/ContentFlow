import path from "node:path";
import { loadEnv, projectPath } from "../config.js";
import { parseArgs, requireArg } from "../utils/args.js";
import { fileExists, readJson, writeJson } from "../utils/files.js";
import { extractAudio, extractFrames } from "../services/video.js";
import { analyzeReference } from "../services/referenceAnalyzer.js";
import { transcribeAudio } from "../services/openaiClient.js";
import { generateContentIdeas, generateScriptPlan } from "../services/contentReplicator.js";
import { generateImagePrompts, generateVideoPrompts } from "../services/promptGenerator.js";
import { buildEditPlan } from "../services/editPlanBuilder.js";

loadEnv();

const args = parseArgs();
const project = requireArg(args, "project");
const topic = requireArg(args, "topic");
const projectDir = projectPath(project);
const referenceVideo = path.join(projectDir, "reference", "reference.mp4");

if (!fileExists(referenceVideo)) {
  throw new Error(`Missing reference video: ${referenceVideo}`);
}

console.log("1/7 Extracting reference metadata and frames...");
const metadata = await extractFrames(referenceVideo, path.join(projectDir, "analysis", "frames"), Number(args.frames ?? 10));
writeJson(path.join(projectDir, "analysis", "metadata.json"), metadata);

console.log("2/7 Extracting and transcribing audio...");
const audioPath = await extractAudio(referenceVideo, path.join(projectDir, "analysis", "audio.wav"));
const transcript = await transcribeAudio(audioPath);
writeJson(path.join(projectDir, "analysis", "transcript.json"), transcript);

console.log("3/7 Analyzing style...");
const styleAnalysis = await analyzeReference({ projectDir, metadata, transcript });
writeJson(path.join(projectDir, "analysis", "style-analysis.json"), styleAnalysis);

console.log("4/7 Generating content ideas...");
const contentIdeas = await generateContentIdeas({ topic, styleAnalysis });
writeJson(path.join(projectDir, "generated", "content-ideas.json"), contentIdeas);

console.log("5/7 Creating script plan...");
const scriptPlan = await generateScriptPlan({ topic, styleAnalysis, contentIdeas });
writeJson(path.join(projectDir, "generated", "script-plan.json"), scriptPlan);

console.log("6/7 Creating asset prompts...");
const imagePrompts = await generateImagePrompts({ styleAnalysis, scriptPlan });
const videoPrompts = await generateVideoPrompts({ styleAnalysis, scriptPlan, imagePrompts });
writeJson(path.join(projectDir, "generated", "image-prompts.json"), imagePrompts);
writeJson(path.join(projectDir, "generated", "video-prompts.json"), videoPrompts);

console.log("7/7 Creating edit plan...");
const editPlan = buildEditPlan({ metadata, styleAnalysis, scriptPlan });
writeJson(path.join(projectDir, "generated", "edit-plan.json"), editPlan);

console.log(`Pipeline complete: ${path.join(projectDir, "generated")}`);
