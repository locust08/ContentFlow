import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionJob, jobTypeForAction } from "../src/services/productionJobs.js";

test("maps hosted heavy actions to production job types", () => {
  assert.equal(jobTypeForAction("generate-ugc-video"), "generate-ugc-video");
  assert.equal(jobTypeForAction("clipper/render-bulk"), "clipper-render-bulk");
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
