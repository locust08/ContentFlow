import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionJob, jobTypeForAction } from "../src/services/productionJobs.js";

test("maps hosted heavy actions to production job types", () => {
  assert.equal(jobTypeForAction("generate-ugc-video"), "generate-ugc-video");
  assert.equal(jobTypeForAction("clipper/render-bulk"), "clipper-render-bulk");
  assert.equal(jobTypeForAction("market-reports/generate"), "generate-market-report");
  assert.equal(jobTypeForAction("ugc-script/analyze"), "analyze-ugc-script");
  assert.equal(jobTypeForAction("ugc-script/generate"), "generate-ugc-script");
  assert.equal(jobTypeForAction("clipper/reaction"), "");
});

test("builds a queued production job payload", () => {
  const job = buildProductionJob({
    projectName: "demo",
    jobType: "clipper-render-bulk",
    payload: { highlightIds: ["a", "b"] },
    requestedBy: "editor"
  });

  assert.equal(job.projectName, "demo");
  assert.equal(job.jobType, "clipper-render-bulk");
  assert.deepEqual(job.payload, { highlightIds: ["a", "b"] });
  assert.equal(job.requestedBy, "editor");
  assert.equal(job.status, "queued");
});

test("keeps research and script identifiers in queued job payloads", () => {
  const job = buildProductionJob({
    projectName: "launch-video",
    jobType: "generate-ugc-script",
    payload: {
      marketReportId: "report-1",
      scriptId: "script-1",
      scriptVersionId: "version-2",
      selectedHookId: "hook-3"
    },
    requestedBy: "editor"
  });

  assert.deepEqual(job.payload, {
    marketReportId: "report-1",
    scriptId: "script-1",
    scriptVersionId: "version-2",
    selectedHookId: "hook-3"
  });
});
