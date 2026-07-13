import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductionJob,
  canCancelProductionJob,
  canRetryProductionJob,
  productionJobDuration,
  productionJobSummary,
  workerHealth,
  jobTypeForAction
} from "../src/services/productionJobs.js";

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

test("enforces retry and cancellation transitions", () => {
  assert.equal(canCancelProductionJob({ status: "queued" }), true);
  assert.equal(canCancelProductionJob({ status: "processing" }), false);
  assert.equal(canRetryProductionJob({ status: "failed" }), true);
  assert.equal(canRetryProductionJob({ status: "cancelled" }), true);
  assert.equal(canRetryProductionJob({ status: "completed" }), false);
});

test("summarizes queue state and duration", () => {
  const jobs = [
    { status: "queued" },
    { status: "failed" },
    { status: "failed" }
  ];
  assert.deepEqual(productionJobSummary(jobs), {
    queued: 1,
    processing: 0,
    completed: 0,
    failed: 2,
    cancelled: 0,
    total: 3
  });
  assert.equal(productionJobDuration({ startedAt: "2026-07-14T00:00:00.000Z", completedAt: "2026-07-14T00:00:05.000Z" }), 5000);
});

test("computes worker online, busy, and offline health", () => {
  const now = Date.parse("2026-07-14T00:00:30.000Z");
  assert.equal(workerHealth({ lastSeenAt: "2026-07-14T00:00:20.000Z", currentJobId: "job-1" }, now).status, "busy");
  assert.equal(workerHealth({ lastSeenAt: "2026-07-14T00:00:20.000Z", currentJobId: "" }, now).status, "online");
  assert.equal(workerHealth({ lastSeenAt: "2026-07-14T00:00:00.000Z", currentJobId: "" }, now).status, "offline");
});
