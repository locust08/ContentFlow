import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MARKET_PILLARS,
  buildScriptwriterInputBlock,
  deduplicatePassages,
  generateMarketReport,
  normalizeResearchText,
  prepareResearchSource,
  readMarketReportMirror,
  writeMarketReportMirror
} from "../src/services/marketIntelligence.js";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

test("schema defines the market intelligence and UGC domain with relationships and indexes", () => {
  const sql = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
  const tables = [
    "cf_campaign_briefs",
    "cf_research_sources",
    "cf_market_reports",
    "cf_ugc_scripts",
    "cf_ugc_script_versions",
    "cf_script_review_events"
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists ${table} \\(`, "i"));
    assert.match(sql, new RegExp(`create index if not exists idx_${table.slice(3)}`, "i"));
  }
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists ${table} \\([\\s\\S]*?id text primary key`, "i"));
  }
  assert.match(sql, /campaign_id text not null references cf_campaigns\(id\) on delete restrict/i);
  assert.match(sql, /brief_id text not null references cf_campaign_briefs\(id\) on delete cascade/i);
  assert.match(sql, /market_report_id text references cf_market_reports\(id\) on delete restrict/i);
  assert.match(sql, /alter table cf_ugc_scripts alter column market_report_id drop not null/i);
  assert.match(sql, /script_id text not null references cf_ugc_scripts\(id\) on delete cascade/i);
  assert.match(sql, /version_id text not null references cf_ugc_script_versions\(id\) on delete restrict/i);
  assert.match(sql, /status in \('draft', 'ready', 'approved', 'archived'\)/i);
  assert.match(sql, /selected_hook_id text/i);
  assert.match(sql, /current_version_number integer not null default 0/i);
  assert.match(sql, /unique \(script_id, version_number\)/i);
});

test("normalizes UTF-8-ish punctuation and deduplicates equivalent passages", () => {
  assert.equal(
    normalizeResearchText("\uFEFF  Itâ€™s\u00a0â€œfastâ€ â€” really.  \r\n\r\nNext\tline "),
    "It's \"fast\" - really.\n\nNext line"
  );
  assert.deepEqual(
    deduplicatePassages([" Easy setup. ", "easy   setup.", "Different result.", ""]),
    ["Easy setup.", "Different result."]
  );
});

test("prepares text, txt, markdown, and CSV sources while rejecting empty or unsupported input", () => {
  for (const input of [
    { id: "text", type: "text", content: "A useful passage." },
    { id: "txt", fileName: "notes.txt", content: "Plain notes." },
    { id: "md", fileName: "notes.md", content: "# Heading\n\nMarkdown notes." },
    { id: "csv", fileName: "reviews.csv", content: "review,rating\nEasy setup,5" }
  ]) {
    const source = prepareResearchSource(input);
    assert.ok(source.passages.length > 0);
    assert.ok(["text", "txt", "md", "csv"].includes(source.type));
  }

  assert.throws(() => prepareResearchSource({ fileName: "notes.pdf", content: "data" }), /unsupported/i);
  assert.throws(() => prepareResearchSource({ type: "text", content: " \n\t " }), /empty/i);
});

test("generates and sanitizes an evidence-backed report through generateJson", async () => {
  const calls = [];
  const report = await generateMarketReport({
    brief: { product: "ContentFlow", objective: "Create high-converting UGC" },
    sources: [{ id: "source-1", fileName: "reviews.txt", content: "Teams struggle with slow approvals. Easy setup saves hours." }],
    generate: async (request) => {
      calls.push(request);
      return {
        pillars: {
          features: [{ insight: "Easy setup", evidence: [{ quote: "Easy setup saves hours.", sourceId: "source-1" }], frequency: 1, confidence: 0.91 }]
        },
        audienceProfile: { primaryAudience: "Busy content teams", awarenessLevel: "problem-aware" },
        contentOpportunities: [{ angle: "Replace slow approvals", rationale: "Repeated pain", pillar: "painPoints" }]
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].schemaName, "market_intelligence_report");
  assert.deepEqual(Object.keys(report.pillars), MARKET_PILLARS);
  assert.deepEqual(report.pillars.features[0].evidence[0], {
    quote: "Easy setup saves hours.",
    sourceId: "source-1"
  });
  assert.equal(report.pillars.features[0].frequency, 1);
  assert.equal(report.pillars.features[0].confidence, 0.91);
  assert.equal(report.audienceProfile.primaryAudience, "Busy content teams");
  assert.equal(report.contentOpportunities[0].pillar, "painPoints");
  assert.equal(report.scriptwriterInputBlock, buildScriptwriterInputBlock(report));
  assert.match(report.scriptwriterInputBlock, /Brand: ContentFlow/i);
  assert.match(report.scriptwriterInputBlock, /Product: ContentFlow/i);
  assert.match(report.scriptwriterInputBlock, /Target Audience: Busy content teams/i);
  assert.match(report.scriptwriterInputBlock, /Top Pain Points:/i);
  assert.match(report.scriptwriterInputBlock, /Customer Objections:/i);
  assert.match(report.scriptwriterInputBlock, /Real Customer Phrases:/i);
  assert.equal(report.scriptwriterInput.campaignBrief.product, "ContentFlow");
});

test("accepts only evidence quotes present in their referenced prepared source", async () => {
  const report = await generateMarketReport({
    brief: { brand: "Digital Bee", product: "ContentFlow", targetAudience: "Content teams" },
    sources: [
      { id: "source-a", type: "text", content: "One board keeps every approval in view." },
      { id: "source-b", type: "text", content: "Teams want fewer status meetings." }
    ],
    generate: async () => ({
      pillars: {
        features: [{
          insight: "One approval board",
          evidence: [
            { quote: "One board keeps every approval in view.", sourceId: "source-a" },
            { quote: "A made-up quote.", sourceId: "source-a" },
            { quote: "One board keeps every approval in view.", sourceId: "source-b" }
          ],
          frequency: 3,
          confidence: 0.9
        }]
      },
      audienceProfile: { primaryAudience: "Content teams" },
      contentOpportunities: []
    })
  });

  assert.equal(report.source, "openai");
  assert.deepEqual(report.pillars.features[0].evidence, [{
    quote: "One board keeps every approval in view.",
    sourceId: "source-a"
  }]);
  assert.equal(report.pillars.features[0].frequency, 1);
});

test("treats malformed or wholly unsupported model reports as deterministic fallback", async () => {
  const input = {
    brief: { product: "ContentFlow", audience: "content teams" },
    sources: [{ id: "source-1", type: "text", content: "Teams struggle with slow reviews." }]
  };

  const malformed = await generateMarketReport({ ...input, generate: async () => ({ audienceProfile: {} }) });
  const invented = await generateMarketReport({
    ...input,
    generate: async () => ({
      pillars: { painPoints: [{ insight: "Invented", evidence: [{ quote: "Not in source", sourceId: "source-1" }] }] },
      audienceProfile: {},
      contentOpportunities: []
    })
  });
  const incomplete = await generateMarketReport({
    ...input,
    generate: async () => ({
      pillars: {
        painPoints: [{
          insight: "Slow reviews",
          evidence: [{ quote: "Teams struggle with slow reviews.", sourceId: "source-1" }]
        }]
      }
    })
  });

  assert.equal(malformed.source, "fallback");
  assert.equal(invented.source, "fallback");
  assert.equal(incomplete.source, "fallback");
  assert.deepEqual(malformed.pillars, invented.pillars);
});

test("uses a deterministic seven-pillar fallback when generation is unavailable", async () => {
  const input = {
    brief: { product: "ContentFlow", audience: "social teams" },
    sources: [{
      id: "reviews",
      type: "text",
      content: [
        "It includes a fast approval board that helps teams save hours.",
        "Creators struggle with scattered feedback and feel frustrated.",
        "Some worry it is too expensive.",
        "They tried spreadsheets before campaigns suddenly grew."
      ].join("\n\n")
    }],
    generate: async () => null
  };

  const first = await generateMarketReport(input);
  const second = await generateMarketReport(input);

  assert.deepEqual(first, second);
  assert.equal(first.source, "fallback");
  assert.deepEqual(Object.keys(first.pillars), MARKET_PILLARS);
  for (const pillar of MARKET_PILLARS) assert.ok(Array.isArray(first.pillars[pillar]));
  assert.ok(first.pillars.painPoints[0].evidence[0].quote.includes("struggle"));
  assert.ok(first.contentOpportunities.length > 0);
});

test("mirrors reports only inside a supplied directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cf-market-"));
  const report = { id: "report-1", pillars: {}, scriptwriterInput: {} };

  const filePath = writeMarketReportMirror(directory, report, "report-1.json");
  assert.equal(filePath, path.join(directory, "report-1.json"));
  assert.deepEqual(readMarketReportMirror(directory, "report-1.json"), report);
  assert.throws(() => writeMarketReportMirror(directory, report, "../outside.json"), /inside|filename/i);
  assert.throws(() => readMarketReportMirror(directory, "../outside.json"), /inside|filename/i);
});
