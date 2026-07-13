import path from "node:path";
import { loadEnv, projectPath } from "../config.js";
import { parseArgs, requireArg } from "../utils/args.js";
import { readJson, writeJson } from "../utils/files.js";
import { generateContentIdeas, generateScriptPlan } from "../services/contentReplicator.js";
import { generateImagePrompts, generateVideoPrompts } from "../services/promptGenerator.js";
import { buildEditPlan } from "../services/editPlanBuilder.js";

loadEnv();

const args = parseArgs();
const project = requireArg(args, "project");
const topic = requireArg(args, "topic");
const projectDir = projectPath(project);

const metadata = readJson(path.join(projectDir, "analysis", "metadata.json"));
const styleAnalysis = readJson(path.join(projectDir, "analysis", "style-analysis.json"));

console.log("Generating content ideas...");
const contentIdeas = await generateContentIdeas({ topic, styleAnalysis });
writeJson(path.join(projectDir, "generated", "content-ideas.json"), contentIdeas);

console.log("Generating script plan...");
const scriptPlan = await generateScriptPlan({ topic, styleAnalysis, contentIdeas });
writeJson(path.join(projectDir, "generated", "script-plan.json"), scriptPlan);

console.log("Generating image prompts...");
const imagePrompts = await generateImagePrompts({ styleAnalysis, scriptPlan });
writeJson(path.join(projectDir, "generated", "image-prompts.json"), imagePrompts);

console.log("Generating video prompts...");
const videoPrompts = await generateVideoPrompts({ styleAnalysis, scriptPlan, imagePrompts });
writeJson(path.join(projectDir, "generated", "video-prompts.json"), videoPrompts);

console.log("Building Remotion edit plan...");
const editPlan = buildEditPlan({ metadata, styleAnalysis, scriptPlan });
writeJson(path.join(projectDir, "generated", "edit-plan.json"), editPlan);

console.log(`Done: ${path.join(projectDir, "generated")}`);
