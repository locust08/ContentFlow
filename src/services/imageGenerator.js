import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJson } from "../utils/files.js";

function normalizePrompts(imagePrompts) {
  const prompts = Array.isArray(imagePrompts?.prompts)
    ? imagePrompts.prompts
    : Array.isArray(imagePrompts?.imagePrompts)
      ? imagePrompts.imagePrompts
      : Array.isArray(imagePrompts?.image_prompts)
        ? imagePrompts.image_prompts
    : Array.isArray(imagePrompts)
      ? imagePrompts
      : [];

  return prompts.map((item, index) => ({
    scene: Number(item.scene ?? index + 1),
    prompt: String(item.prompt ?? item.imagePrompt ?? item.image_prompt ?? "").trim()
  })).filter((item) => item.prompt);
}

async function downloadUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function generateSceneImages({ projectDir, imagePrompts, limit }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env, then restart the dashboard.");
  }

  const prompts = normalizePrompts(imagePrompts);
  if (!prompts.length) throw new Error("No image prompts found. Generate prompts first.");

  const selected = Number(limit) > 0 ? prompts.slice(0, Number(limit)) : prompts;
  const imagesDir = path.join(projectDir, "assets", "images");
  ensureDir(imagesDir);

  const manifest = {
    generatedAt: new Date().toISOString(),
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    size: process.env.OPENAI_IMAGE_SIZE || "1024x1536",
    quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
    images: []
  };

  for (const item of selected) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: manifest.model,
        prompt: item.prompt,
        size: manifest.size,
        quality: manifest.quality,
        output_format: "png",
        n: 1
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI image generation failed for scene ${item.scene}: ${response.status} ${text}`);
    }

    const data = await response.json();
    const image = data.data?.[0];
    if (!image?.b64_json && !image?.url) {
      throw new Error(`OpenAI did not return image data for scene ${item.scene}.`);
    }

    const bytes = image.b64_json
      ? Buffer.from(image.b64_json, "base64")
      : await downloadUrl(image.url);

    const fileName = `scene-${String(item.scene).padStart(2, "0")}.png`;
    const filePath = path.join(imagesDir, fileName);
    fs.writeFileSync(filePath, bytes);

    manifest.images.push({
      scene: item.scene,
      file: `assets/images/${fileName}`,
      prompt: item.prompt,
      revisedPrompt: image.revised_prompt ?? null,
      usage: data.usage ?? null
    });
  }

  writeJson(path.join(projectDir, "generated", "image-assets.json"), manifest);
  return manifest;
}
