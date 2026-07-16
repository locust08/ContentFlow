import fs from "node:fs";
import path from "node:path";
import { generateJson } from "./openaiClient.js";

export const MARKET_PILLARS = Object.freeze([
  "features",
  "benefits",
  "painPoints",
  "objections",
  "failedSolutions",
  "triggerEvents",
  "drivingEmotions"
]);

export const SUPPORTED_RESEARCH_TYPES = new Set(["text", "txt", "md", "csv"]);

const mojibakeReplacements = new Map([
  ["\u00e2\u20ac\u2122", "'"],
  ["\u00e2\u20ac\u02dc", "'"],
  ["\u00e2\u20ac\u0153", "\""],
  ["\u00e2\u20ac\u009d", "\""],
  ["\u00e2\u20ac\u201c", "-"],
  ["\u00e2\u20ac\u201d", "-"],
  ["\u00e2\u20ac\u00a6", "..."],
  ["\u00c2", ""]
]);

export function normalizeResearchText(value) {
  let text = String(value ?? "").replace(/^\uFEFF/, "");
  for (const [broken, replacement] of mojibakeReplacements) {
    text = text.split(broken).join(replacement);
  }
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function deduplicatePassages(passages) {
  const seen = new Set();
  const unique = [];
  for (const value of Array.isArray(passages) ? passages : []) {
    const passage = normalizeResearchText(value);
    const key = passage.toLocaleLowerCase("en").replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(passage);
  }
  return unique;
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\"" && quoted && content[index + 1] === "\"") {
      field += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function passagesFor(type, content) {
  if (type === "csv") {
    return deduplicatePassages(parseCsvRows(content).map((row) => row
      .map((field) => normalizeResearchText(field))
      .filter(Boolean)
      .join(" | ")));
  }
  return deduplicatePassages(content.split(/\n\s*\n|\n(?=[-*#]|\d+[.)]\s)/));
}

function sourceType(input) {
  const explicit = normalizeResearchText(input?.type).toLowerCase().replace(/^\./, "");
  if (explicit) return explicit === "markdown" ? "md" : explicit === "plain" ? "text" : explicit;
  const extension = path.extname(String(input?.fileName ?? input?.name ?? "")).slice(1).toLowerCase();
  return extension || "text";
}

function sourceId(input, type) {
  if (input?.id) return String(input.id);
  const base = path.basename(String(input?.fileName ?? input?.name ?? `source-${type}`), path.extname(String(input?.fileName ?? input?.name ?? "")));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `source-${type}`;
}

export function prepareResearchSource(input = {}) {
  const type = sourceType(input);
  if (!SUPPORTED_RESEARCH_TYPES.has(type)) throw new Error(`Unsupported research source type: ${type || "unknown"}.`);
  const content = normalizeResearchText(input.content ?? input.text);
  if (!content) throw new Error("Research source is empty.");
  const passages = passagesFor(type, content);
  if (!passages.length) throw new Error("Research source is empty.");
  return {
    id: sourceId(input, type),
    name: String(input.name ?? input.fileName ?? sourceId(input, type)),
    type,
    content,
    passages,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

const pillarPatterns = {
  features: /\b(include|includes|feature|with|built|board|offer|provide|integration|workflow)\b/i,
  benefits: /\b(help|helps|save|faster|improve|increase|reduce|result|so that|hours?)\b/i,
  painPoints: /\b(struggle|problem|pain|slow|scattered|difficult|hard|waste|stuck|manual)\b/i,
  objections: /\b(worry|concern|too expensive|costly|but|skeptic|risk|price)\b/i,
  failedSolutions: /\b(tried|used to|before|did not work|didn't work|failed|spreadsheet|workaround)\b/i,
  triggerEvents: /\b(when|after|suddenly|grew|growth|launch|deadline|campaign|urgent)\b/i,
  drivingEmotions: /\b(feel|feels|felt|frustrat|anxious|fear|excited|overwhelm|relief|confident)\b/i
};

function passageEvidence(sources) {
  const indexed = new Map();
  for (const source of sources) {
    for (const quote of source.passages) {
      const key = quote.toLocaleLowerCase("en").replace(/\s+/g, " ");
      const existing = indexed.get(key);
      if (existing) {
        existing.frequency += 1;
        if (!existing.sourceIds.includes(source.id)) existing.sourceIds.push(source.id);
      } else {
        indexed.set(key, { quote, sourceIds: [source.id], frequency: 1 });
      }
    }
  }
  return [...indexed.values()];
}

function fallbackPillars(sources) {
  const evidence = passageEvidence(sources);
  return Object.fromEntries(MARKET_PILLARS.map((pillar) => [
    pillar,
    evidence.filter((item) => pillarPatterns[pillar].test(item.quote)).map((item) => ({
      insight: item.quote,
      evidence: item.sourceIds.map((id) => ({ quote: item.quote, sourceId: id })),
      frequency: item.frequency,
      confidence: Math.min(0.95, 0.5 + (item.frequency - 1) * 0.1)
    }))
  ]));
}

function normalizedSearchText(value) {
  return normalizeResearchText(value).toLocaleLowerCase("en").replace(/\s+/g, " ");
}

function quoteFrequencyInSource(quote, source) {
  const needle = normalizedSearchText(quote);
  const haystack = normalizedSearchText(source?.content);
  if (!needle || !haystack.includes(needle)) return 0;
  let frequency = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    frequency += 1;
    cursor += needle.length;
  }
  return frequency;
}

function normalizeEvidence(item, sourcesById) {
  const seen = new Set();
  return (Array.isArray(item?.evidence) ? item.evidence : [])
    .map((entry) => {
      const evidence = {
        quote: normalizeResearchText(entry?.quote),
        sourceId: String(entry?.sourceId ?? "")
      };
      return { ...evidence, frequency: quoteFrequencyInSource(evidence.quote, sourcesById.get(evidence.sourceId)) };
    })
    .filter((entry) => {
      const key = `${entry.sourceId}\u0000${normalizedSearchText(entry.quote)}`;
      if (!entry.quote || !entry.sourceId || !entry.frequency || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sanitizePillars(value, sources) {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  return Object.fromEntries(MARKET_PILLARS.map((pillar) => [
    pillar,
    (Array.isArray(value?.[pillar]) ? value[pillar] : []).map((item) => {
      const verifiedEvidence = normalizeEvidence(item, sourcesById);
      const evidence = verifiedEvidence.map(({ quote, sourceId }) => ({ quote, sourceId }));
      return {
        insight: normalizeResearchText(item?.insight) || evidence[0]?.quote || "",
        evidence,
        frequency: verifiedEvidence.reduce((total, entry) => total + entry.frequency, 0),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0))
      };
    }).filter((item) => item.insight && item.evidence.length)
  ]));
}

function audienceProfile(value, brief) {
  const profile = value && typeof value === "object" ? value : {};
  return {
    primaryAudience: normalizeResearchText(profile.primaryAudience ?? brief.targetAudience ?? brief.audience) || "Prospective customers",
    awarenessLevel: normalizeResearchText(profile.awarenessLevel) || "problem-aware",
    needs: deduplicatePassages(profile.needs),
    language: deduplicatePassages(profile.language)
  };
}

function opportunities(value, pillars) {
  const supplied = Array.isArray(value) ? value.map((item) => ({
    angle: normalizeResearchText(item?.angle),
    rationale: normalizeResearchText(item?.rationale),
    pillar: MARKET_PILLARS.includes(item?.pillar) ? item.pillar : "painPoints"
  })).filter((item) => item.angle) : [];
  if (supplied.length) return supplied;
  return MARKET_PILLARS.flatMap((pillar) => pillars[pillar].slice(0, 1).map((item) => ({
    angle: item.insight,
    rationale: `Build content from ${pillar} evidence.`,
    pillar
  })));
}

function makeScriptwriterInput({ brief, pillars, profile, contentOpportunities }) {
  return {
    campaignBrief: brief,
    audienceProfile: profile,
    sevenPillars: pillars,
    contentOpportunities,
    evidenceRules: [
      "Use claims only when they are supported by an evidence quote and sourceId.",
      "Preserve the audience's language without inventing statistics or guarantees.",
      "Return three distinct hooks before the full scene-by-scene script."
    ]
  };
}

export function buildScriptwriterInputBlock(value = {}) {
  const input = value.scriptwriterInput ?? value;
  const brief = input.campaignBrief ?? {};
  const profile = input.audienceProfile ?? {};
  const pillars = input.sevenPillars ?? {};
  const list = (items) => items.length
    ? items.map((item) => `- ${normalizeResearchText(item?.insight ?? item)}`).join("\n")
    : "- Not enough evidence yet.";
  const phrases = deduplicatePassages(MARKET_PILLARS.flatMap((pillar) =>
    (pillars[pillar] ?? []).flatMap((item) => (item.evidence ?? []).map((entry) => entry.quote))));
  const product = normalizeResearchText(brief.product ?? brief.productName) || "Not specified";
  const brand = normalizeResearchText(brief.brand) || product;
  return [
    "UGC SCRIPTWRITER PERSONA",
    "Persona: Evidence-led customer-language scriptwriter",
    `Brand: ${brand}`,
    `Product: ${product}`,
    `Target Audience: ${normalizeResearchText(profile.primaryAudience ?? brief.targetAudience ?? brief.audience) || "Not specified"}`,
    "",
    "Top Pain Points:",
    list(pillars.painPoints ?? []),
    "",
    "Customer Objections:",
    list(pillars.objections ?? []),
    "",
    "Real Customer Phrases:",
    phrases.length ? phrases.map((phrase) => `- \"${phrase}\"`).join("\n") : "- Not enough evidence yet."
  ].join("\n");
}

export async function generateMarketReport({ brief = {}, sources = [], generate = generateJson } = {}) {
  if (!Array.isArray(sources) || !sources.length) throw new Error("At least one research source is required.");
  const preparedSources = sources.map((source, index) => prepareResearchSource({ id: source.id ?? `source-${index + 1}`, ...source }));
  let generated = null;
  try {
    generated = await generate({
      schemaName: "market_intelligence_report",
      system: [
        "You are a market intelligence analyst for evidence-led UGC advertising.",
        `Analyze exactly seven pillars: ${MARKET_PILLARS.join(", ")}.`,
        "Every insight must include evidence entries with quote and sourceId plus frequency and confidence from 0 to 1.",
        "Also return audienceProfile and contentOpportunities. Output only valid JSON."
      ].join(" "),
      user: JSON.stringify({ brief, sources: preparedSources, requiredPillars: MARKET_PILLARS }, null, 2)
    });
  } catch {
    generated = null;
  }

  const generatedPillars = generated?.pillars && typeof generated.pillars === "object"
    ? sanitizePillars(generated.pillars, preparedSources)
    : null;
  const validGenerated = generatedPillars
    && MARKET_PILLARS.some((pillar) => generatedPillars[pillar].length > 0)
    && generated.audienceProfile && typeof generated.audienceProfile === "object" && !Array.isArray(generated.audienceProfile)
    && Array.isArray(generated.contentOpportunities)
    ? generated
    : null;
  const pillars = validGenerated ? generatedPillars : fallbackPillars(preparedSources);
  const profile = audienceProfile(validGenerated?.audienceProfile, brief);
  const contentOpportunities = opportunities(validGenerated?.contentOpportunities, pillars);
  const scriptwriterInput = makeScriptwriterInput({ brief, pillars, profile, contentOpportunities });
  return {
    source: validGenerated ? "openai" : "fallback",
    pillars,
    audienceProfile: profile,
    contentOpportunities,
    scriptwriterInput,
    scriptwriterInputBlock: buildScriptwriterInputBlock(scriptwriterInput)
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

export function writeMarketReportMirror(directory, report, fileName = "market-report.json") {
  const { base, target } = mirrorPath(directory, fileName);
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

export function readMarketReportMirror(directory, fileName = "market-report.json") {
  const { target } = mirrorPath(directory, fileName);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export const ingestResearchSource = prepareResearchSource;
export const normalizeText = normalizeResearchText;
export const saveMarketReportMirror = writeMarketReportMirror;
