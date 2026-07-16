import fs from "node:fs";
import path from "node:path";
import { generateJson } from "./openaiClient.js";
import { MARKET_PILLARS, normalizeResearchText } from "./marketIntelligence.js";

export const SCRIPT_STATUSES = Object.freeze([
  "draft",
  "internal-review",
  "client-review",
  "approved",
  "changes-requested"
]);

export const SCRIPT_STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["internal-review"]),
  "internal-review": Object.freeze(["client-review", "changes-requested"]),
  "client-review": Object.freeze(["approved", "changes-requested"]),
  approved: Object.freeze([]),
  "changes-requested": Object.freeze(["draft"])
});

function transcriptSentences(transcript) {
  return normalizeResearchText(transcript)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordsIn(text) {
  return normalizeResearchText(text).match(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g) ?? [];
}

function syllablesIn(word) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return 1;
  if (clean.length <= 3) return 1;
  const withoutSilentEnd = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  return Math.max(1, withoutSilentEnd.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

function readingGrade(text, sentenceCount = transcriptSentences(text).length || 1) {
  const words = wordsIn(text);
  if (!words.length) return 0;
  const syllables = words.reduce((total, word) => total + syllablesIn(word), 0);
  const grade = 0.39 * (words.length / Math.max(1, sentenceCount))
    + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

function padHookTexts(hooks, subject = "this") {
  const clean = [];
  for (const hook of hooks) {
    const value = normalizeResearchText(typeof hook === "string" ? hook : hook?.text ?? hook?.hook);
    if (value && !clean.some((entry) => entry.toLowerCase() === value.toLowerCase())) clean.push(value);
    if (clean.length === 3) break;
  }
  const defaults = [
    `Still dealing with ${subject}?`,
    `There is a simpler way to handle ${subject}.`,
    `Try this before you lose more time to ${subject}.`
  ];
  for (const value of defaults) {
    if (clean.length === 3) break;
    if (!clean.some((entry) => entry.toLowerCase() === value.toLowerCase())) clean.push(value);
  }
  return clean.slice(0, 3);
}

export function analyzeTranscript(transcript) {
  const text = normalizeResearchText(transcript);
  if (!text) throw new Error("Transcript is empty.");
  const sentences = transcriptSentences(text);
  const words = wordsIn(text);
  const claimCandidates = sentences.filter((sentence) => /\b(\d|percent|can|will|cut|save|increase|reduce|faster|more|less)\b/i.test(sentence));
  return {
    text,
    sentences,
    wordCount: words.length,
    estimatedDurationSeconds: Math.max(1, Math.ceil(words.length / 2.5)),
    readingGradeLevel: readingGrade(text, sentences.length),
    gradeLevelTarget: 5,
    hookCandidates: padHookTexts(sentences.slice(0, 3), "the old way"),
    claimCandidates
  };
}

export async function analyzeUgcInspiration({ transcript, generate = generateJson } = {}) {
  const metrics = analyzeTranscript(transcript);
  let generated = null;
  try {
    generated = await generate({
      schemaName: "ugc_inspiration_analysis",
      system: [
        "You analyze winning UGC ad scripts without copying their wording.",
        "Identify the marketing angle, video format, psychological pacing, persuasion sequence, and CTA.",
        "Return only valid JSON."
      ].join(" "),
      user: JSON.stringify({ transcript: metrics.text }, null, 2)
    });
  } catch {
    generated = null;
  }
  const valid = generated && typeof generated === "object"
    && normalizeResearchText(generated.angle)
    && normalizeResearchText(generated.format)
    && normalizeResearchText(generated.psychologicalPacing)
    && Array.isArray(generated.persuasionSequence);
  const sentences = metrics.sentences;
  return {
    ...metrics,
    source: valid ? "openai" : "fallback",
    angle: valid ? normalizeResearchText(generated.angle) : "Problem-Solution",
    format: valid ? normalizeResearchText(generated.format) : (/\b(i|my|me|we|our)\b/i.test(metrics.text) ? "Testimonial UGC" : "Direct response UGC"),
    psychologicalPacing: valid
      ? normalizeResearchText(generated.psychologicalPacing)
      : "Hook to problem to solution to benefit to CTA",
    persuasionSequence: valid
      ? generated.persuasionSequence.map(normalizeResearchText).filter(Boolean)
      : ["hook", "problem", "solution", "benefit", "cta"],
    cta: normalizeResearchText(valid ? generated.cta : sentences.at(-1))
  };
}

function pillarEntries(scriptwriterInput) {
  const pillars = scriptwriterInput?.sevenPillars ?? scriptwriterInput?.pillars ?? {};
  return MARKET_PILLARS.flatMap((pillar) => (Array.isArray(pillars[pillar]) ? pillars[pillar] : [])
    .map((entry) => ({ pillar, ...entry })));
}

function inputEvidence(scriptwriterInput) {
  const seen = new Set();
  const evidence = [];
  for (const entry of pillarEntries(scriptwriterInput)) {
    for (const item of Array.isArray(entry.evidence) ? entry.evidence : []) {
      const quote = normalizeResearchText(item?.quote);
      const sourceId = String(item?.sourceId ?? "");
      const key = `${sourceId}\u0000${quote}`;
      if (!quote || !sourceId || seen.has(key)) continue;
      seen.add(key);
      evidence.push({ quote, sourceId });
    }
  }
  return evidence;
}

function evidenceKey(item) {
  return `${String(item?.sourceId ?? "")}\u0000${normalizeResearchText(item?.quote).toLocaleLowerCase("en")}`;
}

function sanitizeEvidence(value, allowedEvidence) {
  const allowedKeys = new Set(allowedEvidence.map(evidenceKey));
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((item) => ({
    quote: normalizeResearchText(item?.quote),
    sourceId: String(item?.sourceId ?? "")
  })).filter((item) => {
    const key = evidenceKey(item);
    if (!item.quote || !item.sourceId || !allowedKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeClaims(value, entries, allowedEvidence) {
  const allowedSourceIds = new Set(allowedEvidence.map((item) => item.sourceId));
  const claims = (Array.isArray(value) ? value : []).map((item) => {
    const evidenceSourceIds = [...new Set((Array.isArray(item?.evidenceSourceIds) ? item.evidenceSourceIds : [])
      .map(String).filter((sourceId) => allowedSourceIds.has(sourceId)))];
    return {
      claim: normalizeResearchText(typeof item === "string" ? item : item?.claim),
      evidenceSourceIds,
      status: evidenceSourceIds.length && item?.status !== "unsupported" ? "supported" : "unsupported"
    };
  }).filter((item) => item.claim);
  if (claims.length) return claims;
  return entries.slice(0, 3).map((entry) => ({
    claim: normalizeResearchText(entry.insight),
    evidenceSourceIds: [...new Set((entry.evidence ?? []).map((item) => String(item.sourceId ?? ""))
      .filter((sourceId) => allowedSourceIds.has(sourceId)))],
    status: (entry.evidence ?? []).some((item) => allowedSourceIds.has(String(item.sourceId ?? ""))) ? "supported" : "unsupported"
  })).filter((item) => item.claim).concat(entries.length ? [] : [{
    claim: "The script presents the product as a simpler next step.",
    evidenceSourceIds: [...allowedSourceIds],
    status: allowedSourceIds.size ? "supported" : "unsupported"
  }]);
}

function canonicalHooks(value, allowedEvidence, subject = "this") {
  const rawHooks = [];
  for (const hook of Array.isArray(value) ? value : []) {
    const text = normalizeResearchText(typeof hook === "string" ? hook : hook?.text ?? hook?.hook);
    if (!text || rawHooks.some((entry) => entry.text.toLowerCase() === text.toLowerCase())) continue;
    rawHooks.push({ text, evidence: sanitizeEvidence(hook?.evidence, allowedEvidence) });
    if (rawHooks.length === 3) break;
  }
  const texts = padHookTexts(rawHooks.map((hook) => hook.text), subject);
  return texts.map((text, index) => ({
    id: `hook-${index + 1}`,
    text,
    evidence: rawHooks.find((hook) => hook.text === text)?.evidence ?? []
  }));
}

function sceneDuration(scene) {
  const explicit = Number(scene?.durationSeconds);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const start = Number(scene?.startSeconds);
  const end = Number(scene?.endSeconds);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
  return Math.max(1.5, Math.ceil(wordsIn(scene?.audioSpokenWord ?? scene?.voiceover).length / 2.5));
}

function timedScenes(value, allowedEvidence = []) {
  const scenes = Array.isArray(value) ? value : [];
  let cursor = 0;
  const timedScenes = [];
  for (const scene of scenes) {
    const audioSpokenWord = normalizeResearchText(scene?.audioSpokenWord ?? scene?.voiceover ?? scene?.caption);
    if (!audioSpokenWord) continue;
    const duration = sceneDuration(scene);
    const sceneNumber = timedScenes.length + 1;
    const timed = {
      id: `scene-${sceneNumber}`,
      title: normalizeResearchText(scene?.title) || `Scene ${sceneNumber}`,
      visualAction: normalizeResearchText(scene?.visualAction ?? scene?.visualPurpose ?? scene?.cameraInstruction) || "Show the speaker delivering this line.",
      audioSpokenWord,
      startSeconds: cursor,
      endSeconds: cursor + duration,
      durationSeconds: duration,
      evidence: sanitizeEvidence(scene?.evidence, allowedEvidence)
    };
    cursor = timed.endSeconds;
    timedScenes.push(timed);
  }
  return timedScenes;
}

function fallbackScript({ title, transcript, scriptwriterInput }) {
  const entries = pillarEntries(scriptwriterInput);
  const pain = entries.find((entry) => entry.pillar === "painPoints")?.insight
    ?? transcriptSentences(transcript)[0]
    ?? "slow work";
  const benefit = entries.find((entry) => entry.pillar === "benefits")?.insight
    ?? "move from feedback to approval in one clear flow";
  const product = normalizeResearchText(scriptwriterInput?.campaignBrief?.product ?? scriptwriterInput?.campaignBrief?.productName) || "this solution";
  const allowedEvidence = inputEvidence(scriptwriterInput);
  const hooks = canonicalHooks([
    `Still stuck with ${pain}?`,
    `Here is a simple way to fix ${pain}.`,
    `What if ${pain} did not slow you down?`
  ], allowedEvidence, pain);
  const scenes = timedScenes([
    { visualAction: "Show the problem in a real work moment.", audioSpokenWord: hooks[0].text, durationSeconds: 3 },
    { visualAction: "Show the old process taking too many steps.", audioSpokenWord: `The old way makes a simple task feel hard. ${pain}`, durationSeconds: 5 },
    { visualAction: `Show ${product} solving the task in one clear flow.`, audioSpokenWord: `${product} gives your team one clear place to work. You can ${benefit}.`, durationSeconds: 7 },
    { visualAction: "End on the finished result and product name.", audioSpokenWord: `Try ${product} for your next project.`, durationSeconds: 4 }
  ], allowedEvidence);
  return { title, hooks, scenes, evidence: allowedEvidence, claims: sanitizeClaims([], entries, allowedEvidence) };
}

function validModelScript(generated, allowedEvidence) {
  if (!generated || typeof generated !== "object") return false;
  const hookTexts = (Array.isArray(generated.hooks) ? generated.hooks : [])
    .map((hook) => normalizeResearchText(typeof hook === "string" ? hook : hook?.text ?? hook?.hook))
    .filter(Boolean);
  return new Set(hookTexts.map((hook) => hook.toLowerCase())).size >= 3
    && timedScenes(generated.scenes, allowedEvidence).length > 0;
}

function sanitizedScript({ generated, fallback, title, transcript, scriptwriterInput, marketReportId, reportStatus, approvalOverride }) {
  const allowedEvidence = inputEvidence(scriptwriterInput);
  const hooks = generated
    ? canonicalHooks(generated.hooks, allowedEvidence, fallback.hooks[0].text)
    : fallback.hooks;
  const scenes = generated ? timedScenes(generated.scenes, allowedEvidence) : [];
  const finalScenes = scenes.length ? scenes : fallback.scenes;
  const evidence = generated ? sanitizeEvidence(generated.evidence, allowedEvidence) : fallback.evidence;
  const claims = generated ? sanitizeClaims(generated.claims, [], allowedEvidence) : fallback.claims;
  const spokenText = finalScenes.map((scene) => scene.audioSpokenWord).join(" ");
  return {
    source: generated ? "openai" : "fallback",
    title: normalizeResearchText(generated?.title ?? title) || "UGC Script",
    status: "draft",
    marketReportId,
    reportStatus,
    approvalOverride,
    hooks,
    selectedHookId: null,
    selectedHookIndex: null,
    scenes: finalScenes,
    estimatedDurationSeconds: finalScenes.at(-1)?.endSeconds ?? 0,
    gradeLevelTarget: 5,
    readingGradeLevel: readingGrade(spokenText),
    transcriptAnalysis: transcript ? analyzeTranscript(transcript) : null,
    evidence,
    claims: generated?.claims ? claims : fallback.claims
  };
}

export async function generateUgcScript({
  title = "UGC Script",
  transcript = "",
  scriptwriterInput = {},
  marketReportId = "",
  reportStatus = "",
  isAdmin = false,
  role = "",
  overrideReason = "",
  adminOverride = {},
  generate = generateJson
} = {}) {
  if (!marketReportId) throw new Error("An approved market report id is required.");
  if (!scriptwriterInput || typeof scriptwriterInput !== "object" || !Object.keys(scriptwriterInput).length) {
    throw new Error("Market report scriptwriter input is required.");
  }
  const admin = isAdmin || role === "admin" || adminOverride.isAdmin === true || adminOverride.role === "admin";
  const reason = normalizeResearchText(overrideReason || adminOverride.reason || adminOverride.overrideReason);
  if (reportStatus !== "approved" && !(admin && reason)) {
    throw new Error(admin ? "Admin market report override requires a non-empty reason." : "Market report must be approved before script generation.");
  }
  const approvalOverride = reportStatus === "approved" ? null : {
    marketReportId: String(marketReportId),
    reportStatus: String(reportStatus),
    reason
  };
  const fallback = fallbackScript({ title, transcript, scriptwriterInput });
  let generated = null;
  try {
    generated = await generate({
      schemaName: "ugc_script",
      system: [
        "You write one complete short-form UGC script at a grade 5 reading target.",
        "Return exactly three distinct hook objects with text and evidence, plus scenes with title, visualAction, audioSpokenWord, durationSeconds, and evidence.",
        "Return evidence as quote/sourceId pairs and claims with evidenceSourceIds. Never invent proof or guarantees.",
        "Output only valid JSON."
      ].join(" "),
      user: JSON.stringify({ title, transcript, marketReportId, reportStatus, scriptwriterInput, requiredGradeLevel: 5 }, null, 2)
    });
  } catch {
    generated = null;
  }
  const validGenerated = validModelScript(generated, inputEvidence(scriptwriterInput)) ? generated : null;
  return sanitizedScript({
    generated: validGenerated,
    fallback,
    title,
    transcript,
    scriptwriterInput,
    marketReportId: String(marketReportId),
    reportStatus: String(reportStatus),
    approvalOverride
  });
}

export function transitionScriptStatus(script, nextStatus, { versionId = "", actorId = "", feedback = "", now } = {}) {
  const currentStatus = String(script?.status ?? "");
  if (!versionId) throw new Error("Script version id is required for a review transition.");
  if (!SCRIPT_STATUSES.includes(currentStatus) || !SCRIPT_STATUSES.includes(nextStatus)
    || !SCRIPT_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new Error(`Invalid script status transition: ${currentStatus || "unknown"} -> ${nextStatus}.`);
  }
  const createdAt = now ?? new Date().toISOString();
  return {
    script: { ...script, status: nextStatus, updatedAt: createdAt },
    event: {
      scriptId: String(script.id ?? ""),
      versionId: String(versionId),
      fromStatus: currentStatus,
      toStatus: nextStatus,
      feedback: normalizeResearchText(feedback),
      actorId: String(actorId),
      createdAt
    }
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function latestScriptVersion(versions = []) {
  return [...versions].sort((left, right) => Number(right.versionNumber) - Number(left.versionNumber))[0] ?? null;
}

export function createScriptVersion({ script, versions = [], content, changeNote = "", createdBy = "", now } = {}) {
  if (!script?.id) throw new Error("Script id is required to create a version.");
  if (!content || typeof content !== "object") throw new Error("Script version content is required.");
  const latestNumber = Math.max(Number(script.currentVersionNumber) || 0, ...versions.map((item) => Number(item.versionNumber) || 0));
  const createdAt = now ?? new Date().toISOString();
  const version = {
    scriptId: String(script.id),
    versionNumber: latestNumber + 1,
    content: cloneJson(content),
    changeNote: normalizeResearchText(changeNote),
    createdBy: String(createdBy),
    createdAt
  };
  return {
    script: { ...script, currentVersionNumber: version.versionNumber, updatedAt: createdAt },
    version
  };
}

export function selectHook(script, hookIdOrIndex) {
  const hooks = Array.isArray(script?.hooks) ? script.hooks : [];
  const hookIndex = Number.isInteger(hookIdOrIndex)
    ? hookIdOrIndex
    : hooks.findIndex((hook, index) => (hook?.id ?? `hook-${index + 1}`) === hookIdOrIndex);
  if (!Number.isInteger(hookIndex) || hookIndex < 0 || hookIndex >= hooks.length || hooks.length !== 3) {
    throw new Error("Hook selection requires a valid id from a three-hook script.");
  }
  const selectedHook = cloneJson(hooks[hookIndex]);
  return {
    ...script,
    selectedHookId: selectedHook?.id ?? `hook-${hookIndex + 1}`,
    selectedHookIndex: hookIndex,
    selectedHook
  };
}

export function checkVideoGenerationEligibility(script, {
  isAdmin = false,
  role = "",
  overrideReason = "",
  versionId = "",
  actorId = "",
  now
} = {}) {
  if (script?.status === "approved") return { eligible: true, overridden: false, reason: "approved", auditEvent: null };
  const reason = normalizeResearchText(overrideReason);
  if ((isAdmin || role === "admin") && reason && versionId) return {
    eligible: true,
    overridden: true,
    reason,
    auditEvent: {
      eventType: "admin-generation-override",
      scriptId: String(script?.id ?? ""),
      versionId: String(versionId),
      actorId: String(actorId),
      overrideReason: reason,
      createdAt: now ?? new Date().toISOString()
    }
  };
  return {
    eligible: false,
    overridden: false,
    reason: (isAdmin || role === "admin")
      ? reason ? "Admin override requires a version id." : "Admin override requires a reason."
      : "Script must be approved before video generation.",
    auditEvent: null
  };
}

export function assertVideoGenerationEligible(script, options) {
  const result = checkVideoGenerationEligibility(script, options);
  if (!result.eligible) throw new Error(result.reason);
  return result;
}

export function importLegacyScriptPlan(plan = {}) {
  if (!Array.isArray(plan.scenes) || !plan.scenes.length) throw new Error("Legacy script plan must include scenes.");
  const scenes = timedScenes(plan.scenes);
  if (!scenes.length) throw new Error("Legacy script plan must include at least one scene with dialogue.");
  const firstLine = scenes[0]?.audioSpokenWord ?? "Watch this";
  const hooks = canonicalHooks([
    firstLine,
    `Here is what most people miss: ${firstLine}`,
    `Try this simple fix: ${firstLine}`
  ], [], "this problem");
  const spokenText = scenes.map((scene) => scene.audioSpokenWord).join(" ");
  return {
    source: "legacy-script-plan",
    title: normalizeResearchText(plan.title) || "Imported UGC Script",
    status: "draft",
    hooks,
    selectedHookId: null,
    selectedHookIndex: null,
    scenes,
    estimatedDurationSeconds: scenes.at(-1)?.endSeconds ?? (Number(plan.totalDurationSeconds) || 0),
    gradeLevelTarget: 5,
    readingGradeLevel: readingGrade(spokenText),
    evidence: [],
    claims: []
  };
}

function mirrorPath(directory, fileName) {
  if (!directory || typeof directory !== "string") throw new Error("A mirror directory must be supplied.");
  if (!fileName || path.basename(fileName) !== fileName || path.extname(fileName).toLowerCase() !== ".json") {
    throw new Error("Mirror filename must be a JSON file inside the supplied directory.");
  }
  const base = path.resolve(directory);
  const target = path.resolve(base, fileName);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Mirror file must remain inside the supplied directory.");
  return { base, target };
}

export function writeUgcScriptMirror(directory, script, fileName = "ugc-script.json") {
  const { base, target } = mirrorPath(directory, fileName);
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(script, null, 2)}\n`, "utf8");
  return target;
}

export function readUgcScriptMirror(directory, fileName = "ugc-script.json") {
  const { target } = mirrorPath(directory, fileName);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export const generateUGCScript = generateUgcScript;
export const transitionStatus = transitionScriptStatus;
export const canGenerateVideo = checkVideoGenerationEligibility;
export const importLegacyScript = importLegacyScriptPlan;
export const saveUgcScriptMirror = writeUgcScriptMirror;
