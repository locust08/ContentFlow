import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalIntelligenceStore } from "../src/services/localIntelligenceStore.js";

test("persists campaign briefs, research sources, and report approval", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contentflow-intelligence-"));
  const store = createLocalIntelligenceStore(path.join(directory, "intelligence.json"));

  store.saveBrief("campaign-1", { brand: "GlowSkin", product: "Barrier Serum" });
  const source = store.addSource("campaign-1", { id: "reviews", name: "Reviews", type: "text", content: "My skin feels dry." });
  const report = store.saveReport("campaign-1", { id: "report-1", pillars: { painPoints: [] }, status: "draft" });
  const approved = store.approveReport("campaign-1", report.id, "admin");

  assert.equal(source.id, "reviews");
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedBy, "admin");
  assert.deepEqual(store.getCampaign("campaign-1").brief, { brand: "GlowSkin", product: "Barrier Serum" });
  assert.equal(store.getCampaign("campaign-1").sources.length, 1);

  const reloaded = createLocalIntelligenceStore(path.join(directory, "intelligence.json"));
  assert.equal(reloaded.getCampaign("campaign-1").activeReport.id, "report-1");
});

test("updates reports without changing their identity and deletes only requested sources", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contentflow-intelligence-"));
  const store = createLocalIntelligenceStore(path.join(directory, "intelligence.json"));
  store.addSource("campaign-1", { id: "a", name: "A", type: "text", content: "A" });
  store.addSource("campaign-1", { id: "b", name: "B", type: "text", content: "B" });
  store.saveReport("campaign-1", { id: "report-1", status: "draft", pillars: {} });

  const updated = store.updateReport("campaign-1", "report-1", { audienceProfile: { primaryAudience: "Parents" } });
  store.deleteSource("campaign-1", "a");

  assert.equal(updated.id, "report-1");
  assert.equal(updated.audienceProfile.primaryAudience, "Parents");
  assert.deepEqual(store.getCampaign("campaign-1").sources.map((source) => source.id), ["b"]);
});
