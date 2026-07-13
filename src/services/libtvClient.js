import fs from "node:fs";
import path from "node:path";
import { File } from "node:buffer";
import { run } from "../utils/exec.js";
import { ensureDir, writeJson } from "../utils/files.js";
import { probeVideo } from "./video.js";

const canvasBase = "https://www.liblib.tv/canvas?projectId=";

function libtvKey() {
  return process.env.LIBTV_API_KEY || process.env.LIBTV_ACCESS_KEY || "";
}

function baseUrl() {
  return process.env.OPENAPI_IM_BASE || process.env.IM_BASE_URL || "https://im.liblib.tv";
}

function authHeaders(extra = {}) {
  const key = libtvKey();
  if (!key) throw new Error("LIBTV_API_KEY is missing. Add it to .env, then restart the dashboard.");
  return {
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

function detectUploadType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const ascii = buffer.subarray(0, 32).toString("latin1");
  const brand = buffer.subarray(4, 16).toString("latin1");

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: ".png", mime: "image/png", buffer };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: ".jpg", mime: "image/jpeg", buffer };
  }
  if (ascii.startsWith("RIFF") && ascii.includes("WEBP")) {
    return { ext: ".webp", mime: "image/webp", buffer };
  }
  if (brand.includes("avif") || brand.includes("avis")) {
    return { ext: ".avif", mime: "image/avif", buffer };
  }

  const mimeByExt = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm"
  };
  return { ext, mime: mimeByExt[ext], buffer };
}

async function prepareLibTvUpload(filePath) {
  const detected = detectUploadType(filePath);
  if (detected.ext !== ".avif") return { filePath, mime: detected.mime };

  const convertedPath = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.libtv-upload.png`);
  await run("ffmpeg", [
    "-y",
    "-i", filePath,
    "-frames:v", "1",
    "-update", "1",
    convertedPath
  ]);
  return { filePath: convertedPath, mime: "image/png", temporary: true };
}

async function apiJson(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl().replace(/\/$/, "")}${pathname}`, {
    method,
    headers: authHeaders(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LibTV API failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function uploadLibTvFile(filePath) {
  const key = libtvKey();
  if (!key) throw new Error("LIBTV_API_KEY is missing. Add it to .env, then restart the dashboard.");
  if (!fs.existsSync(filePath)) throw new Error(`Missing file for LibTV upload: ${filePath}`);

  const prepared = await prepareLibTvUpload(filePath);
  const mime = prepared.mime;
  if (!mime) throw new Error(`Unsupported LibTV upload type for ${path.basename(filePath)}. Use PNG, JPG, WEBP, MP4, MOV, or WEBM.`);

  const form = new FormData();
  form.append("accessKey", key);
  form.append("file", new File([fs.readFileSync(prepared.filePath)], path.basename(prepared.filePath), { type: mime }));

  let response;
  try {
    response = await fetch(`${baseUrl().replace(/\/$/, "")}/openapi/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form
    });
  } finally {
    if (prepared.temporary && fs.existsSync(prepared.filePath)) fs.unlinkSync(prepared.filePath);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LibTV upload failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const url = data.data?.url;
  if (!url) throw new Error("LibTV upload did not return a URL.");
  return url;
}

export async function createLibTvSession(message, sessionId = "") {
  const body = {};
  if (sessionId) body.sessionId = sessionId;
  if (message) body.message = message;
  const response = await apiJson("/openapi/session", { method: "POST", body });
  const data = response.data ?? {};
  return {
    projectUuid: data.projectUuid ?? "",
    sessionId: data.sessionId ?? "",
    projectUrl: data.projectUuid ? `${canvasBase}${data.projectUuid}` : ""
  };
}

export async function queryLibTvSession(sessionId, afterSeq = 0) {
  const suffix = afterSeq > 0 ? `?afterSeq=${afterSeq}` : "";
  const response = await apiJson(`/openapi/session/${encodeURIComponent(sessionId)}${suffix}`);
  return response.data ?? {};
}

export function extractResultUrls(messages) {
  const urls = [];
  const urlPattern = /https:\/\/libtv-res\.liblib\.art\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|mp4|mov|webm)/gi;

  for (const msg of messages || []) {
    const content = msg?.content;
    if (!content || typeof content !== "string") continue;

    if (msg.role === "tool") {
      try {
        const data = JSON.parse(content);
        const taskResult = data.task_result ?? {};
        for (const image of taskResult.images ?? []) {
          if (image.previewPath) urls.push(image.previewPath);
          if (image.url) urls.push(image.url);
        }
        for (const video of taskResult.videos ?? []) {
          if (video.previewPath) urls.push(video.previewPath);
          if (video.url) urls.push(video.url);
        }
      } catch {
        // Some tool messages are plain text; regex extraction below handles those.
      }
    }

    if (msg.role === "assistant" || msg.role === "tool") {
      urls.push(...content.match(urlPattern) ?? []);
    }
  }

  return [...new Set(urls)];
}

async function downloadFile(url, filePath) {
  const response = await fetch(url, { headers: { "User-Agent": "Content-Machine/0.1" } });
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
}

function normalizeVideoPrompts(videoPrompts) {
  const prompts = Array.isArray(videoPrompts?.prompts)
    ? videoPrompts.prompts
    : Array.isArray(videoPrompts?.videoPrompts)
      ? videoPrompts.videoPrompts
      : Array.isArray(videoPrompts?.video_prompts)
        ? videoPrompts.video_prompts
    : Array.isArray(videoPrompts)
      ? videoPrompts
      : [];

  return prompts.map((item, index) => ({
    scene: Number(item.scene ?? index + 1),
    prompt: String(item.prompt ?? item.videoPrompt ?? item.video_prompt ?? "").trim(),
    durationSeconds: Number(item.durationSeconds ?? item.duration ?? 5)
  })).filter((item) => item.prompt);
}

function buildMessage({ prompt, uploadedImageUrl, durationSeconds }) {
  return [
    "请严格使用参考图做图生视频。",
    "重要要求：参考图必须作为视频第一帧。请保持参考图中的人物/产品/场景/服装/光线/构图一致，不要换人，不要换产品，不要换背景，不要重新设计画面。",
    `参考图：${uploadedImageUrl}`,
    `视频时长：约 ${durationSeconds} 秒。`,
    `创作要求：${prompt}`,
    "只允许添加轻微、真实、可控的动作和镜头运动。不要生成无关人物、无关产品、科技展示、广告棚拍或与参考图不一致的新画面。",
    "请只输出一个最终视频结果，并在完成后返回可下载的视频链接。"
  ].join("\n");
}

function chooseFinalVideoUrls(videoUrls) {
  if (!videoUrls.length) return [];
  const finalLike = videoUrls.filter((url) => /\/output\/|result\.mp4/i.test(url));
  if (finalLike.length) return [finalLike[finalLike.length - 1]];
  return [videoUrls[videoUrls.length - 1]];
}

async function downloadAndRankUgcCandidates(videoUrls, videosDir, referenceUrl) {
  for (const existing of fs.readdirSync(videosDir).filter((file) => /^ugc-(output|candidate-).*\.(mp4|mov|webm)$/i.test(file))) {
    fs.unlinkSync(path.join(videosDir, existing));
  }

  const candidateUrls = videoUrls
    .filter((url) => url !== referenceUrl)
    .filter((url) => !/\/claw\//i.test(url));
  const urlsToCheck = (candidateUrls.length ? candidateUrls : chooseFinalVideoUrls(videoUrls)).slice(-8);
  const candidates = [];

  for (let i = 0; i < urlsToCheck.length; i += 1) {
    const url = urlsToCheck[i];
    const fileName = `ugc-candidate-${String(i + 1).padStart(2, "0")}.mp4`;
    const filePath = path.join(videosDir, fileName);
    await downloadFile(url, filePath);
    const metadata = await probeVideo(filePath);
    candidates.push({
      index: i,
      url,
      fileName,
      file: `assets/videos/${fileName}`,
      metadata,
      isVertical: metadata.height > metadata.width,
      isGeneratedNode: /\/sd-gen-save-img\/.*\/video\//i.test(url),
      isFinalOutputNode: /\/output\/|result\.mp4/i.test(url)
    });
  }

  const ranked = [...candidates].sort((a, b) => {
    if (a.isVertical !== b.isVertical) return a.isVertical ? -1 : 1;
    if (a.isGeneratedNode !== b.isGeneratedNode) return a.isGeneratedNode ? -1 : 1;
    return b.index - a.index;
  });
  return {
    candidates,
    primary: ranked[0] ?? null
  };
}

function buildUgcReplicationMessage({ referenceUrl, productUrl, characterUrl, blueprint }) {
  const scriptStyle = blueprint?.scriptStyle ? JSON.stringify(blueprint.scriptStyle, null, 2) : "";
  const visualStyle = blueprint?.visualStyle ? JSON.stringify(blueprint.visualStyle, null, 2) : "";
  const editingStyle = blueprint?.editingStyle ? JSON.stringify(blueprint.editingStyle, null, 2) : "";
  const sceneRhythm = blueprint?.sceneRhythm ? JSON.stringify(blueprint.sceneRhythm, null, 2) : "";

  return [
    "IMPORTANT OUTPUT FORMAT / 重要格式要求:",
    "Generate ONE complete vertical short video only: 9:16 portrait, 1080x1920 if possible. Do NOT generate landscape, wide 16:9, presentation, studio ad, or generic spokesperson video.",
    "",
    "MODEL:",
    "Use Kling O3 as the generation model. Prioritize motion duplication, reference motion following, and low-credit efficient generation.",
    "",
    "TEXT/SUBTITLE RESTRICTION:",
    "Do NOT add subtitles, captions, burned-in text, labels, stickers, titles, lower thirds, watermarks, UI text overlays, or floating words.",
    "Generate clean video only. Subtitles and text will be added later in Remotion.",
    "只生成一个完整竖屏短视频：9:16，人像竖屏，尽量 1080x1920。不要生成横屏 16:9，不要生成棚拍广告，不要生成普通男主持介绍产品。",
    "",
    "TASK / 任务:",
    "Create one complete AI UGC product demo video that follows the reference video's content flow and visual behavior.",
    "创作一个完整 AI UGC 产品演示视频，严格参考原视频的内容流程、镜头行为、节奏和演示方式。",
    "",
    "REFERENCE VIDEO:",
    referenceUrl,
    "",
    "PRODUCT IMAGE:",
    productUrl,
    "",
    "CHARACTER REFERENCE IMAGE:",
    characterUrl,
    "",
    "Main goal:",
    "Use the reference video as the proven content flow, delivery style, pacing, framing, and editing direction. Use the product image as the product being promoted.",
    "Use the character reference image as the presenter identity. Do not generate a random presenter.",
    "The product in the video must visually match the attached product image. Keep the product visible in hand and near camera.",
    "The presenter must follow the attached character reference: same general face identity, age range, gender presentation, hairstyle/hijab/clothing cues if visible.",
    "视频里的产品必须参考并接近上传的产品图。产品需要一直在手上展示，并靠近镜头。",
    "",
    "Mandatory shot structure / 必须复制的结构:",
    "1. Vertical close-up selfie/UGC framing, presenter centered, plain home background.",
    "2. Presenter holds the product case in one hand and a smartphone in the other hand, both close to camera.",
    "3. Open or reveal the product case clearly.",
    "4. Show a phone pairing / connection / proof UI moment as the climax.",
    "5. End with a smiling reaction while both phone and product remain visible.",
    "6. Use one continuous take or very minimal cuts with a subtle push-in near the proof moment.",
    "",
    "Match from the reference:",
    "- Hook structure and emotional delivery",
    "- Message flow and persuasion sequence",
    "- UGC creator vibe, camera style, scene rhythm, pacing, and CTA",
    "- Similar caption-safe framing and social-media vertical composition",
    "",
    "Change for originality and safety:",
    "- Do not copy competitor brand names, logos, exact lines, exact location, exact creator identity, or protected assets",
    "- Replace the competitor product with the attached product image",
    "- Replace the competitor creator with the attached character reference",
    "- Create a new original UGC video that feels structurally similar but is not a duplicate",
    "- Keep the reference's close-up product-in-hand composition, but use a different performer identity",
    "- No copied subtitles, no generated subtitles, no fake language captions, no on-screen text",
    "",
    "Reference analysis blueprint:",
    `Script style:\n${scriptStyle}`,
    `Visual style:\n${visualStyle}`,
    `Editing style:\n${editingStyle}`,
    `Scene rhythm:\n${sceneRhythm}`,
    "",
    "Output requirements:",
    "- One finished 9:16 vertical UGC video, portrait orientation only",
    "- Product must be visible, close to camera, and visually based on the product image",
    "- Presenter must be based on the character reference image",
    "- Natural social-media creator delivery",
    "- No unrelated products or unrelated characters",
    "- No wide horizontal video",
    "- No subtitles, no captions, no text overlays",
    "- Return a downloadable final video link"
  ].join("\n");
}

async function waitForResults(sessionId, { maxSeconds = 180, intervalSeconds = 8, requireFinalLike = false } = {}) {
  const started = Date.now();
  let afterSeq = 0;
  let allMessages = [];

  while ((Date.now() - started) / 1000 < maxSeconds) {
    const data = await queryLibTvSession(sessionId, afterSeq);
    const messages = data.messages ?? [];
    if (messages.length) {
      allMessages = [...allMessages, ...messages];
      afterSeq = Math.max(afterSeq, ...messages.map((msg) => Number(msg.seq ?? 0)));
    }

    const urls = extractResultUrls(allMessages);
    const videoUrls = urls.filter((url) => /\.(mp4|mov|webm)(?:$|\?)/i.test(url));
    const hasFinalLike = videoUrls.some((url) => /\/output\/|result\.mp4/i.test(url));
    if (videoUrls.length && (!requireFinalLike || hasFinalLike)) {
      return { status: "completed", urls, videoUrls, messages: allMessages };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }

  return {
    status: "processing",
    urls: extractResultUrls(allMessages),
    videoUrls: extractResultUrls(allMessages).filter((url) => /\.(mp4|mov|webm)(?:$|\?)/i.test(url)),
    messages: allMessages
  };
}

export async function generateLibTvVideos({ projectDir, videoPrompts, limit = 1, maxSeconds = 180 }) {
  const prompts = normalizeVideoPrompts(videoPrompts);
  if (!prompts.length) throw new Error("No video prompts found. Generate prompts first.");

  const selected = Number(limit) > 0 ? prompts.slice(0, Number(limit)) : prompts;
  const videosDir = path.join(projectDir, "assets", "videos");
  ensureDir(videosDir);

  const manifest = {
    generatedAt: new Date().toISOString(),
    status: "started",
    videos: []
  };

  for (const item of selected) {
    const sceneName = `scene-${String(item.scene).padStart(2, "0")}`;
    const imagePath = path.join(projectDir, "assets", "images", `${sceneName}.png`);
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Missing source image for scene ${item.scene}: ${imagePath}`);
    }

    for (const existing of fs.readdirSync(videosDir).filter((file) => file.toLowerCase().startsWith(sceneName) && /\.(mp4|mov|webm)$/i.test(file))) {
      fs.unlinkSync(path.join(videosDir, existing));
    }

    const uploadedImageUrl = await uploadLibTvFile(imagePath);
    const message = buildMessage({
      prompt: item.prompt,
      uploadedImageUrl,
      durationSeconds: item.durationSeconds
    });
    const session = await createLibTvSession(message);
    const result = await waitForResults(session.sessionId, { maxSeconds });

    const finalVideoUrls = chooseFinalVideoUrls(result.videoUrls);
    const downloaded = [];
    for (let i = 0; i < finalVideoUrls.length; i += 1) {
      const url = finalVideoUrls[i];
      const ext = path.extname(url.split("?")[0]) || ".mp4";
      const fileName = finalVideoUrls.length === 1 ? `${sceneName}${ext}` : `${sceneName}-${i + 1}${ext}`;
      const filePath = path.join(videosDir, fileName);
      await downloadFile(url, filePath);
      downloaded.push({
        file: `assets/videos/${fileName}`,
        url
      });
    }

    manifest.videos.push({
      scene: item.scene,
      status: result.status,
      sessionId: session.sessionId,
      projectUuid: session.projectUuid,
      projectUrl: session.projectUrl,
      uploadedImageUrl,
      prompt: item.prompt,
      resultUrls: result.urls,
      videoUrls: result.videoUrls,
      selectedVideoUrls: finalVideoUrls,
      downloaded
    });
  }

  manifest.status = manifest.videos.every((video) => video.status === "completed") ? "completed" : "processing";
  writeJson(path.join(projectDir, "generated", "libtv-video-assets.json"), manifest);
  return manifest;
}

export async function generateLibTvUgcVideo({ projectDir, blueprint, maxSeconds = 300 }) {
  const referencePath = path.join(projectDir, "reference", "reference.mp4");
  const productDir = path.join(projectDir, "product");
  const characterDir = path.join(projectDir, "character");
  const productFile = fs.existsSync(productDir)
    ? fs.readdirSync(productDir).find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    : "";
  const characterFile = fs.existsSync(characterDir)
    ? fs.readdirSync(characterDir).find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    : "";
  if (!fs.existsSync(referencePath)) throw new Error("Missing reference video. Upload reference first.");
  if (!productFile) throw new Error("Missing product image. Upload product image first.");
  if (!characterFile) throw new Error("Missing character reference. Upload character reference first.");

  const productPath = path.join(productDir, productFile);
  const characterPath = path.join(characterDir, characterFile);
  const videosDir = path.join(projectDir, "assets", "videos");
  ensureDir(videosDir);

  const referenceUrl = await uploadLibTvFile(referencePath);
  const productUrl = await uploadLibTvFile(productPath);
  const characterUrl = await uploadLibTvFile(characterPath);
  const message = buildUgcReplicationMessage({ referenceUrl, productUrl, characterUrl, blueprint });
  const session = await createLibTvSession(message);
  const result = await waitForResults(session.sessionId, { maxSeconds, requireFinalLike: true });
  const { candidates, primary } = await downloadAndRankUgcCandidates(result.videoUrls, videosDir, referenceUrl);
  const selectedVideoUrls = primary ? [primary.url] : [];

  if (!selectedVideoUrls.length) {
    const manifest = {
      generatedAt: new Date().toISOString(),
      status: result.status,
      sessionId: session.sessionId,
      projectUuid: session.projectUuid,
      projectUrl: session.projectUrl,
      referenceUrl,
      productUrl,
      characterUrl,
      model: "Kling O3",
      resultUrls: result.urls,
      videoUrls: result.videoUrls,
      selectedVideoUrls: [],
      downloaded: []
    };
    writeJson(path.join(projectDir, "generated", "libtv-ugc-video.json"), manifest);
    return manifest;
  }

  const outputPath = path.join(videosDir, "ugc-output.mp4");
  fs.copyFileSync(path.join(videosDir, primary.fileName), outputPath);
  const outputMetadata = await probeVideo(outputPath);
  const qualityCheck = {
    isVertical: outputMetadata.height > outputMetadata.width,
    aspectRatio: outputMetadata.width && outputMetadata.height ? Number((outputMetadata.width / outputMetadata.height).toFixed(3)) : 0,
    expected: "9:16 portrait video",
    warnings: []
  };
  if (!qualityCheck.isVertical) {
    qualityCheck.warnings.push("Generated video is not vertical. This output does not meet the UGC reference replication requirement.");
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    status: qualityCheck.warnings.length ? "completed_needs_review" : "completed",
    sessionId: session.sessionId,
    projectUuid: session.projectUuid,
    projectUrl: session.projectUrl,
    referenceUrl,
    productUrl,
    characterUrl,
    model: "Kling O3",
    prompt: message,
    resultUrls: result.urls,
    videoUrls: result.videoUrls,
    selectedVideoUrls,
    candidateVideos: candidates,
    outputMetadata,
    qualityCheck,
    downloaded: [
      {
        file: "assets/videos/ugc-output.mp4",
        url: primary.url,
        sourceCandidate: primary.file
      },
      ...candidates.map((candidate) => ({
        file: candidate.file,
        url: candidate.url,
        metadata: candidate.metadata,
        selected: candidate.url === primary.url
      }))
    ]
  };
  writeJson(path.join(projectDir, "generated", "libtv-ugc-video.json"), manifest);
  return manifest;
}
