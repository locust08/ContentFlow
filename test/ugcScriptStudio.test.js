import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeUgcInspiration,
  analyzeTranscript,
  assertVideoGenerationEligible,
  checkVideoGenerationEligibility,
  createScriptVersion,
  generateUgcScript,
  importLegacyScriptPlan,
  latestScriptVersion,
  readUgcScriptMirror,
  selectHook,
  transitionScriptStatus,
  writeUgcScriptMirror
} from "../src/services/ugcScriptStudio.js";

const approvedReport = {
  marketReportId: "report-1",
  reportStatus: "approved"
};

test("analyzes transcript timing, readability, hooks, and claim candidates", () => {
  const analysis = analyzeTranscript("Stop wasting time. ContentFlow cuts review time by 30 percent. Teams can publish faster today.");

  assert.equal(analysis.wordCount, 15);
  assert.ok(analysis.estimatedDurationSeconds > 0);
  assert.ok(Number.isFinite(analysis.readingGradeLevel));
  assert.equal(analysis.gradeLevelTarget, 5);
  assert.equal(analysis.hookCandidates[0], "Stop wasting time.");
  assert.ok(analysis.claimCandidates.includes("ContentFlow cuts review time by 30 percent."));
});

test("analyzes the winning angle, format, psychological pacing, and CTA", async () => {
  const analysis = await analyzeUgcInspiration({
    transcript: "I tried everything for dry skin. Then this serum made my skin feel calm. Try it today.",
    generate: async () => ({
      angle: "Problem-Solution",
      format: "Testimonial UGC",
      psychologicalPacing: "Personal frustration to relief to action",
      persuasionSequence: ["hook", "problem", "solution", "benefit", "cta"],
      cta: "Try it today."
    })
  });

  assert.equal(analysis.angle, "Problem-Solution");
  assert.equal(analysis.format, "Testimonial UGC");
  assert.equal(analysis.psychologicalPacing, "Personal frustration to relief to action");
  assert.deepEqual(analysis.persuasionSequence, ["hook", "problem", "solution", "benefit", "cta"]);
  assert.equal(analysis.cta, "Try it today.");
  assert.ok(analysis.estimatedDurationSeconds > 0);
});

test("generates one sanitized full script with exactly three hooks and timed scenes", async () => {
  const calls = [];
  const script = await generateUgcScript({
    ...approvedReport,
    title: "Faster approvals",
    transcript: "Teams waste time chasing approvals.",
    scriptwriterInput: {
      campaignBrief: { product: "ContentFlow" },
      sevenPillars: {
        benefits: [{ insight: "Save review time", evidence: [{ quote: "Save review time", sourceId: "source-1" }] }]
      }
    },
    generate: async (request) => {
      calls.push(request);
      return {
        hooks: ["Still chasing feedback?", "Your review process is too slow.", "Publish without the approval mess."],
        scenes: [
          { visualAction: "Show five chat windows", audioSpokenWord: "Still chasing feedback?", durationSeconds: 2 },
          { visualAction: "Open one approval board", audioSpokenWord: "Put every note in one clear approval board.", durationSeconds: 4 }
        ],
        evidence: [{ quote: "Save review time", sourceId: "source-1" }],
        claims: [{ claim: "ContentFlow can simplify review", evidenceSourceIds: ["source-1"] }]
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].schemaName, "ugc_script");
  assert.equal(script.hooks.length, 3);
  assert.deepEqual(script.hooks[0], { id: "hook-1", text: "Still chasing feedback?", evidence: [] });
  assert.deepEqual(script.scenes[0], {
    id: "scene-1",
    title: "Scene 1",
    visualAction: "Show five chat windows",
    audioSpokenWord: "Still chasing feedback?",
    startSeconds: 0,
    endSeconds: 2,
    durationSeconds: 2,
    evidence: []
  });
  assert.equal(script.scenes[1].startSeconds, 2);
  assert.equal(script.scenes[1].endSeconds, 6);
  assert.equal(script.estimatedDurationSeconds, 6);
  assert.equal(script.gradeLevelTarget, 5);
  assert.deepEqual(script.evidence[0], { quote: "Save review time", sourceId: "source-1" });
  assert.equal(script.claims[0].claim, "ContentFlow can simplify review");
  assert.equal(script.claims[0].status, "supported");
  assert.equal(script.status, "draft");
  assert.equal(script.marketReportId, "report-1");
  assert.equal(script.reportStatus, "approved");
  assert.equal(script.selectedHookId, null);
});

test("falls back deterministically to a complete grade-five-target script", async () => {
  const input = {
    ...approvedReport,
    title: "Approval flow",
    transcript: "Teams struggle with slow approval. One board helps them move faster.",
    scriptwriterInput: {
      campaignBrief: { product: "ContentFlow", objective: "Show a simpler review" },
      audienceProfile: { primaryAudience: "content teams" },
      sevenPillars: {
        painPoints: [{ insight: "Slow approval", evidence: [{ quote: "Teams struggle with slow approval.", sourceId: "source-1" }] }]
      }
    },
    generate: async () => null
  };

  const first = await generateUgcScript(input);
  const second = await generateUgcScript(input);
  assert.deepEqual(first, second);
  assert.equal(first.source, "fallback");
  assert.equal(first.hooks.length, 3);
  assert.deepEqual(first.hooks.map((hook) => hook.id), ["hook-1", "hook-2", "hook-3"]);
  assert.ok(first.scenes.length >= 3);
  assert.ok(first.scenes.every((scene) => scene.endSeconds > scene.startSeconds));
  assert.equal(first.gradeLevelTarget, 5);
  assert.ok(first.evidence.length > 0);
  assert.ok(first.claims.length > 0);
});

test("enforces the draft-to-approval review workflow and records events", () => {
  const base = { id: "script-1", status: "draft" };
  const internal = transitionScriptStatus(base, "internal-review", {
    versionId: "version-1",
    actorId: "editor-1",
    now: "2026-07-16T01:00:00.000Z"
  });
  assert.equal(internal.script.status, "internal-review");
  assert.deepEqual(internal.event, {
    scriptId: "script-1",
    versionId: "version-1",
    fromStatus: "draft",
    toStatus: "internal-review",
    feedback: "",
    actorId: "editor-1",
    createdAt: "2026-07-16T01:00:00.000Z"
  });

  const client = transitionScriptStatus(internal.script, "client-review", { versionId: "version-1" });
  const approved = transitionScriptStatus(client.script, "approved", { versionId: "version-1" });
  assert.equal(approved.script.status, "approved");
  assert.throws(() => transitionScriptStatus(base, "approved", { versionId: "version-1" }), /invalid.*transition/i);
  assert.throws(() => transitionScriptStatus(base, "internal-review"), /version/i);
  assert.equal(transitionScriptStatus(client.script, "changes-requested", {
    versionId: "version-1",
    feedback: "Shorten scene two"
  }).script.status, "changes-requested");
  assert.equal(transitionScriptStatus({ ...base, status: "changes-requested" }, "draft", {
    versionId: "version-2"
  }).script.status, "draft");
});

test("creates the first version as one and selects canonical hooks by stable id", () => {
  const hooks = ["A", "B", "C"].map((text, index) => ({ id: `hook-${index + 1}`, text, evidence: [] }));
  const newScript = { id: "new-script", currentVersionNumber: 0, hooks, selectedHookId: null, selectedHookIndex: null };
  const initial = createScriptVersion({ script: newScript, content: { hooks }, now: "2026-07-16T01:30:00.000Z" });
  assert.equal(initial.version.versionNumber, 1);

  const original = { id: "script-1", currentVersionNumber: 1, hooks, selectedHookId: null, selectedHookIndex: null };
  const firstVersion = { scriptId: "script-1", versionNumber: 1, content: { hooks: original.hooks } };
  const result = createScriptVersion({
    script: original,
    versions: [firstVersion],
    content: { hooks: ["A2", "B2", "C2"] },
    changeNote: "Tighter hooks",
    createdBy: "editor-1",
    now: "2026-07-16T02:00:00.000Z"
  });

  assert.equal(result.version.versionNumber, 2);
  assert.equal(result.script.currentVersionNumber, 2);
  assert.equal(original.currentVersionNumber, 1);
  assert.equal(latestScriptVersion([firstVersion, result.version]), result.version);
  assert.deepEqual(selectHook(original, "hook-2"), {
    ...original,
    selectedHookId: "hook-2",
    selectedHookIndex: 1,
    selectedHook: hooks[1]
  });
  assert.throws(() => selectHook(original, "hook-4"), /hook/i);
});

test("requires approval for video generation unless an admin gives an override reason", () => {
  const approved = checkVideoGenerationEligibility({ id: "script-1", status: "approved" });
  assert.equal(approved.eligible, true);
  assert.equal(approved.auditEvent, null);
  assert.equal(checkVideoGenerationEligibility({ status: "client-review" }).eligible, false);
  assert.equal(checkVideoGenerationEligibility({ status: "client-review" }, {
    isAdmin: true,
    overrideReason: "Urgent legal preview"
  }).eligible, false);
  const override = checkVideoGenerationEligibility({ id: "script-1", status: "client-review" }, {
    isAdmin: true,
    actorId: "admin-1",
    versionId: "version-2",
    overrideReason: "Urgent legal preview",
    now: "2026-07-16T03:00:00.000Z"
  });
  assert.equal(override.eligible, true);
  assert.equal(override.overridden, true);
  assert.deepEqual(override.auditEvent, {
    eventType: "admin-generation-override",
    scriptId: "script-1",
    versionId: "version-2",
    actorId: "admin-1",
    overrideReason: "Urgent legal preview",
    createdAt: "2026-07-16T03:00:00.000Z"
  });
  assert.equal(assertVideoGenerationEligible({ status: "approved" }).eligible, true);
  assert.throws(() => assertVideoGenerationEligible({ status: "draft" }), /approved/i);
});

test("imports legacy script plans and mirrors scripts only in supplied directories", () => {
  const imported = importLegacyScriptPlan({
    title: "Legacy demo",
    totalDurationSeconds: 5,
    scenes: [
      { scene: 1, durationSeconds: 2, voiceover: "Here is the problem.", visualPurpose: "Show the problem" },
      { scene: 2, durationSeconds: 3, voiceover: "Use one clear board.", visualPurpose: "Show the product" }
    ]
  });

  assert.equal(imported.source, "legacy-script-plan");
  assert.equal(imported.hooks.length, 3);
  assert.deepEqual(imported.scenes[1], {
    id: "scene-2",
    title: "Scene 2",
    visualAction: "Show the product",
    audioSpokenWord: "Use one clear board.",
    startSeconds: 2,
    endSeconds: 5,
    durationSeconds: 3,
    evidence: []
  });
  assert.equal(imported.estimatedDurationSeconds, 5);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cf-ugc-"));
  const filePath = writeUgcScriptMirror(directory, imported, "script-1.json");
  assert.equal(filePath, path.join(directory, "script-1.json"));
  assert.deepEqual(readUgcScriptMirror(directory, "script-1.json"), imported);
  assert.throws(() => writeUgcScriptMirror(directory, imported, "../outside.json"), /inside|filename/i);
  assert.throws(() => importLegacyScriptPlan({ scenes: [{ durationSeconds: 10, voiceover: "" }] }), /dialogue|scenes/i);
});

test("requires approved report context or an explicit audited admin override", async () => {
  const scriptwriterInput = { campaignBrief: { product: "ContentFlow" } };
  await assert.rejects(() => generateUgcScript({ marketReportId: "report-1", reportStatus: "draft", scriptwriterInput }), /approved/i);
  await assert.rejects(() => generateUgcScript({ ...approvedReport, scriptwriterInput: {} }), /scriptwriter input/i);
  await assert.rejects(() => generateUgcScript({
    marketReportId: "report-1",
    reportStatus: "draft",
    scriptwriterInput,
    isAdmin: true
  }), /reason/i);

  const overridden = await generateUgcScript({
    marketReportId: "report-1",
    reportStatus: "draft",
    scriptwriterInput,
    isAdmin: true,
    overrideReason: "Pre-approval internal prototype",
    generate: async () => null
  });
  assert.equal(overridden.marketReportId, "report-1");
  assert.equal(overridden.reportStatus, "draft");
  assert.equal(overridden.approvalOverride.reason, "Pre-approval internal prototype");
});

test("validates model evidence and marks claims without valid evidence IDs unsupported", async () => {
  const script = await generateUgcScript({
    ...approvedReport,
    scriptwriterInput: {
      campaignBrief: { product: "ContentFlow" },
      sevenPillars: {
        benefits: [{ insight: "Faster reviews", evidence: [{ quote: "Reviews take half the time.", sourceId: "source-1" }] }]
      }
    },
    generate: async () => ({
      hooks: [
        { text: "Hook one", evidence: [{ quote: "Reviews take half the time.", sourceId: "source-1" }] },
        { text: "Hook two", evidence: [{ quote: "Invented proof", sourceId: "source-1" }] },
        { text: "Hook three", evidence: [] }
      ],
      scenes: [{
        title: "Proof",
        visualAction: "Show the review board",
        audioSpokenWord: "Reviews take half the time.",
        durationSeconds: 3,
        evidence: [{ quote: "Reviews take half the time.", sourceId: "source-1" }]
      }],
      evidence: [
        { quote: "Reviews take half the time.", sourceId: "source-1" },
        { quote: "Invented proof", sourceId: "source-1" },
        { quote: "Reviews take half the time.", sourceId: "source-x" }
      ],
      claims: [
        { claim: "Supported claim", evidenceSourceIds: ["source-1", "source-x"] },
        { claim: "Unsupported claim", evidenceSourceIds: ["source-x"] }
      ]
    })
  });

  assert.deepEqual(script.evidence, [{ quote: "Reviews take half the time.", sourceId: "source-1" }]);
  assert.deepEqual(script.hooks[0].evidence, [{ quote: "Reviews take half the time.", sourceId: "source-1" }]);
  assert.deepEqual(script.hooks[1].evidence, []);
  assert.deepEqual(script.scenes[0].evidence, [{ quote: "Reviews take half the time.", sourceId: "source-1" }]);
  assert.deepEqual(script.claims[0].evidenceSourceIds, ["source-1"]);
  assert.equal(script.claims[0].status, "supported");
  assert.deepEqual(script.claims[1].evidenceSourceIds, []);
  assert.equal(script.claims[1].status, "unsupported");
});

test("uses fallback for malformed model output and does not advance timing for empty dialogue", async () => {
  const input = {
    ...approvedReport,
    scriptwriterInput: { campaignBrief: { product: "ContentFlow" } }
  };
  const malformed = await generateUgcScript({ ...input, generate: async () => ({ hooks: ["Only one"], scenes: [] }) });
  assert.equal(malformed.source, "fallback");

  const timed = await generateUgcScript({
    ...input,
    generate: async () => ({
      hooks: ["One", "Two", "Three"],
      scenes: [
        { visualAction: "Empty", audioSpokenWord: "", durationSeconds: 10 },
        { visualAction: "Speak", audioSpokenWord: "Start now.", durationSeconds: 2 }
      ]
    })
  });
  assert.equal(timed.source, "openai");
  assert.equal(timed.scenes.length, 1);
  assert.equal(timed.scenes[0].startSeconds, 0);
  assert.equal(timed.scenes[0].endSeconds, 2);
});
