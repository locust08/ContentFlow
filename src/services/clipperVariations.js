import fs from "node:fs";
import path from "node:path";
import { renderClipperVideo } from "./remotionRenderer.js";
import { selectClipperHighlight } from "./clipperService.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/files.js";

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

async function materializeHostedReactions({ projectDir, reactionAssets, fetchImpl }) {
  const references = Array.isArray(reactionAssets) ? reactionAssets : [];
  if (!references.length) return;
  const manifestPath = reactionManifestPath(projectDir);
  const manifest = fileExists(manifestPath) ? readJson(manifestPath) : { characters: [] };
  const characters = Array.isArray(manifest.characters) ? [...manifest.characters] : [];
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  ensureDir(reactionDir);

  for (const reference of references) {
    if (!reference?.id) continue;
    const existingIndex = characters.findIndex((character) => character.id === reference.id);
    const existing = existingIndex >= 0 ? characters[existingIndex] : null;
    if (existing?.path && fileExists(path.join(projectDir, existing.path))) continue;

    const remotePath = /^https?:\/\//i.test(reference.url || "") ? new URL(reference.url).pathname : "";
    const requestedName = path.basename(reference.localPath || remotePath || `${slugify(reference.id)}.bin`);
    const extension = path.extname(requestedName).toLowerCase();
    if (!/^\.(png|jpg|jpeg|webp|mp4|mov|webm)$/.test(extension)) throw new Error(`Unsupported hosted reaction type for ${reference.name || reference.id}.`);
    const localName = `hosted-${slugify(reference.id)}${extension}`;
    const localPath = `clipper/reaction/${localName}`;
    const absolutePath = path.join(reactionDir, localName);
    if (!fileExists(absolutePath)) {
      if (!/^https?:\/\//i.test(reference.url || "")) throw new Error(`Hosted reaction ${reference.name || reference.id} has no downloadable URL.`);
      const response = await fetchImpl(reference.url);
      if (!response.ok) throw new Error(`Could not download hosted reaction ${reference.name || reference.id} (${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 100 * 1024 * 1024) throw new Error(`Hosted reaction ${reference.name || reference.id} exceeds 100 MB.`);
      fs.writeFileSync(absolutePath, bytes);
    }
    const character = {
      id: reference.id,
      name: reference.name || path.parse(localName).name,
      originalName: requestedName,
      path: localPath,
      type: /\.(mp4|mov|webm)$/i.test(extension) ? "video" : "image",
      uploadedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) characters.splice(existingIndex, 1, character);
    else characters.push(character);
  }

  ensureDir(path.dirname(manifestPath));
  writeJson(manifestPath, { ...manifest, characters });
}

export function listClipperReactions(projectDir, project) {
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  if (!fs.existsSync(reactionDir)) return [];

  const manifestPath = reactionManifestPath(projectDir);
  const manifest = fileExists(manifestPath) ? readJson(manifestPath) : { characters: [] };
  const manifestCharacters = (Array.isArray(manifest.characters) ? manifest.characters : [])
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
  const usedIds = new Set(manifestCharacters.map((character) => character.id).filter(Boolean));

  const legacyCharacters = fs.readdirSync(reactionDir)
    .filter((file) => /\.(png|jpg|jpeg|webp|mp4|mov|webm)$/i.test(file))
    .filter((file) => !knownPaths.has(`clipper/reaction/${file}`))
    .sort()
    .map((file, index) => {
      const baseId = `legacy-${slugify(path.parse(file).name) || index + 1}`;
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
      usedIds.add(id);
      return {
        id,
        name: path.parse(file).name,
        originalName: file,
        path: `clipper/reaction/${file}`,
        type: /\.(mp4|mov|webm)$/i.test(file) ? "video" : "image",
        uploadedAt: "",
        url: reactionAssetUrl(project, `clipper/reaction/${file}`, path.join(reactionDir, file))
      };
    });

  return [...manifestCharacters, ...legacyCharacters];
}

export async function renderClipperVariations({
  project,
  projectDir,
  port,
  cwd,
  highlightId = "",
  reactionIds,
  reactionAssets = [],
  fetchImpl = globalThis.fetch,
  renderClip = renderClipperVideo
}) {
  const selectedPath = path.join(projectDir, "clipper", "generated", "selected-highlight.json");
  if (highlightId) selectClipperHighlight({ projectDir, highlightId });
  const selectedHighlight = fileExists(selectedPath) ? readJson(selectedPath) : null;
  if (!selectedHighlight) throw new Error("Make one highlight active before rendering character variations.");
  const subtitlePlanPath = path.join(projectDir, "clipper", "generated", "clip-subtitle-plan.json");
  const subtitlePlan = fileExists(subtitlePlanPath) ? readJson(subtitlePlanPath) : { subtitles: [] };

  await materializeHostedReactions({ projectDir, reactionAssets, fetchImpl });
  const reactionMap = new Map(listClipperReactions(projectDir, project).map((reaction) => [reaction.id, reaction]));
  const selectedReactions = (Array.isArray(reactionIds) ? reactionIds : [])
    .map((reactionId) => reactionMap.get(reactionId))
    .filter(Boolean);
  if (!selectedReactions.length) throw new Error("Select at least one reaction character before rendering variations.");

  const outputs = [];
  for (let index = 0; index < selectedReactions.length; index += 1) {
    const reactionAsset = selectedReactions[index];
    const rank = String(index + 1).padStart(2, "0");
    const outputName = `char-${rank}-${slugify(reactionAsset.name || reactionAsset.id)}__clip-${slugify(selectedHighlight.title || selectedHighlight.id)}.mp4`;
    try {
      const render = await renderClip({
        project,
        port,
        cwd,
        outputName,
        outputDir: "renders/clips",
        reactionAsset,
        selectedHighlight: structuredClone(selectedHighlight),
        subtitlePlan: structuredClone(subtitlePlan)
      });
      outputs.push({
        reactionId: reactionAsset.id,
        reactionName: reactionAsset.name,
        highlightId: selectedHighlight.id,
        title: selectedHighlight.title,
        output: render.output,
        status: "completed",
        clipStart: render.clipStart,
        clipEnd: render.clipEnd
      });
    } catch (error) {
      outputs.push({
        reactionId: reactionAsset.id,
        reactionName: reactionAsset.name,
        highlightId: selectedHighlight.id,
        title: selectedHighlight.title,
        output: path.posix.join("renders", "clips", outputName),
        status: "failed",
        error: error.message
      });
    }
  }

  const result = {
    renderedAt: new Date().toISOString(),
    mode: "clipper-character-variations",
    selectedHighlight,
    count: outputs.length,
    completed: outputs.filter((output) => output.status === "completed").length,
    failed: outputs.filter((output) => output.status === "failed").length,
    outputs
  };
  const generatedDir = path.join(projectDir, "clipper", "generated");
  ensureDir(generatedDir);
  writeJson(path.join(generatedDir, "clipper-character-variations-manifest.json"), result);
  return result;
}
