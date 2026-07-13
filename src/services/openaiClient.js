import fs from "node:fs";
import path from "node:path";

export function hasOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function generateJson({ system, user, schemaName = "content_machine_output" }) {
  if (!hasOpenAI()) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;

  if (!text) throw new Error("OpenAI response did not include output text.");
  return JSON.parse(text);
}

export async function generateVisionJson({ system, text, imagePaths = [], schemaName = "vision_output" }) {
  if (!hasOpenAI()) return null;

  const content = [
    {
      type: "input_text",
      text
    },
    ...imagePaths.map((filePath) => ({
      type: "input_image",
      image_url: encodeImageDataUrl(filePath)
    }))
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-5.2",
      input: [
        { role: "system", content: system },
        { role: "user", content }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI vision request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const output = data.output_text ?? data.output?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;

  if (!output) throw new Error(`OpenAI ${schemaName} response did not include output text.`);
  return JSON.parse(output);
}

export function encodeImageDataUrl(filePath) {
  const ext = filePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  const data = fs.readFileSync(filePath).toString("base64");
  return `data:image/${ext};base64,${data}`;
}

export async function transcribeAudio(audioPath) {
  if (!hasOpenAI()) {
    return {
      source: "fallback",
      text: "",
      segments: [],
      notes: ["Add OPENAI_API_KEY to enable automatic transcription."]
    };
  }

  const form = new FormData();
  const audio = new Blob([fs.readFileSync(audioPath)], { type: "audio/wav" });
  form.append("file", audio, "audio.wav");
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI transcription failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    source: "openai",
    text: data.text ?? "",
    raw: data
  };
}

export async function transcribeAudioWithTimestamps(audioPath) {
  if (!hasOpenAI()) {
    return {
      source: "fallback",
      text: "",
      segments: [],
      notes: ["Add OPENAI_API_KEY to enable generated-video transcription."]
    };
  }

  const ext = path.extname(audioPath).toLowerCase();
  const mimeType = ext === ".mp3" ? "audio/mpeg" : "audio/wav";
  const fileName = ext === ".mp3" ? "audio.mp3" : "audio.wav";
  const form = new FormData();
  const audio = new Blob([fs.readFileSync(audioPath)], { type: mimeType });
  form.append("file", audio, fileName);
  form.append("model", process.env.OPENAI_SUBTITLE_MODEL || "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI timestamp transcription failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    source: "openai",
    text: data.text ?? "",
    segments: (data.segments ?? []).map((segment) => ({
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? 0),
      text: String(segment.text ?? "").trim()
    })).filter((segment) => segment.text),
    raw: data
  };
}
