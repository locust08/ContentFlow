import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJson } from "../utils/files.js";

function getKey() {
  return process.env.ELEVENLABS_API_KEY || "";
}

function getVoiceId() {
  return process.env.ELEVENLABS_VOICE_ID || "";
}

function scriptToVoiceoverText(scriptPlan) {
  const scenes = Array.isArray(scriptPlan?.scenes) ? scriptPlan.scenes : [];
  return scenes
    .map((scene) => String(scene.voiceover || scene.caption || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function listAudio(projectDir, project) {
  const audioDir = path.join(projectDir, "assets", "audio");
  if (!fs.existsSync(audioDir)) return [];
  return fs.readdirSync(audioDir)
    .filter((file) => /\.(mp3|wav|m4a)$/i.test(file))
    .sort()
    .map((file) => ({
      name: file,
      url: `/media/${encodeURIComponent(project)}/assets/audio/${encodeURIComponent(file)}?v=${fs.statSync(path.join(audioDir, file)).mtimeMs}`
    }));
}

export async function generateElevenLabsVoiceover({ projectDir, scriptPlan }) {
  const apiKey = getKey();
  const voiceId = getVoiceId();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is missing. Add it to .env, then restart the dashboard.");
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID is missing. Add a voice ID to .env, then restart the dashboard.");

  const text = scriptToVoiceoverText(scriptPlan);
  if (!text) throw new Error("No voiceover text found in script-plan.json.");

  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: Number(process.env.ELEVENLABS_STABILITY || 0.45),
        similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || 0.75),
        style: Number(process.env.ELEVENLABS_STYLE || 0.35),
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${body}`);
  }

  const audioDir = path.join(projectDir, "assets", "audio");
  ensureDir(audioDir);
  const filePath = path.join(audioDir, "voiceover.mp3");
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));

  const manifest = {
    generatedAt: new Date().toISOString(),
    file: "assets/audio/voiceover.mp3",
    modelId,
    voiceId,
    outputFormat,
    text
  };
  writeJson(path.join(projectDir, "generated", "voiceover-manifest.json"), manifest);
  return manifest;
}
