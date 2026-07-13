import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProductionWorker, deliverVariationOutputs, runWorkerTick } from "../src/worker/productionWorker.js";

function variationResult() {
  return {
    mode: "clipper-character-variations",
    completed: 2,
    failed: 0,
    outputs: [
      { reactionId: "r-1", output: "renders/clips/one.mp4", status: "completed" },
      { reactionId: "r-2", output: "renders/clips/two.mp4", status: "completed" }
    ]
  };
}

test("continues variation delivery after a storage upload failure", async () => {
  const result = variationResult();
  const persisted = [];

  await deliverVariationOutputs({
    project: "demo",
    result,
    projectPathFor: () => "/tmp/demo",
    uploadFile: async (_localPath, storagePath) => {
      if (storagePath.endsWith("one.mp4")) throw new Error("storage offline");
      return "https://storage/two.mp4";
    },
    persistRender: async (render) => persisted.push(render)
  });

  assert.equal(result.failed, 1);
  assert.equal(result.completed, 1);
  assert.match(result.outputs[0].error, /upload failed: storage offline/i);
  assert.equal(result.outputs[1].outputUrl, "https://storage/two.mp4");
  assert.deepEqual(persisted.map((render) => render.name), ["clips/two.mp4"]);
});

test("continues variation delivery after a render-row persistence failure", async () => {
  const result = variationResult();
  const persisted = [];

  await deliverVariationOutputs({
    project: "demo",
    result,
    projectPathFor: () => "/tmp/demo",
    uploadFile: async (_localPath, storagePath) => `https://storage/${storagePath.split("/").at(-1)}`,
    persistRender: async (render) => {
      if (render.name === "clips/one.mp4") throw new Error("database offline");
      persisted.push(render);
    }
  });

  assert.equal(result.failed, 1);
  assert.equal(result.completed, 1);
  assert.match(result.outputs[0].error, /persistence failed: database offline/i);
  assert.equal(result.outputs[1].outputUrl, "https://storage/two.mp4");
  assert.deepEqual(persisted.map((render) => render.name), ["clips/two.mp4"]);
});

test("writes final delivery outcomes to the variation manifest", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contentflow-worker-manifest-"));
  const projectDir = path.join(root, "demo");
  const manifestPath = path.join(projectDir, "clipper", "generated", "clipper-character-variations-manifest.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = variationResult();
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(result));

  await deliverVariationOutputs({
    project: "demo",
    result,
    projectPathFor: () => projectDir,
    uploadFile: async (_localPath, storagePath) => {
      if (storagePath.endsWith("one.mp4")) throw new Error("storage offline");
      return "https://storage/two.mp4";
    },
    persistRender: async () => ({ skipped: false })
  });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.failed, 1);
  assert.match(manifest.outputs[0].error, /upload failed: storage offline/i);
  assert.equal(manifest.outputs[1].outputUrl, "https://storage/two.mp4");
});

test("marks a partial variation job failed and persists its complete result", async () => {
  const result = variationResult();
  result.outputs[0].status = "failed";
  result.outputs[0].error = "render failed";
  result.completed = 1;
  result.failed = 1;
  result.outputs[1].outputUrl = "https://storage/two.mp4";
  const updates = [];

  const processed = await runWorkerTick({
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "clipper-render-variations" }),
    processJob: async () => result,
    updateJob: async (_id, patch) => updates.push(patch)
  });

  assert.equal(processed, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "failed");
  assert.equal(updates[0].result, result);
  assert.equal(updates[0].result.outputs.length, 2);
  assert.match(updates[0].error, /1 variation output failed/i);
});

test("reports an idle heartbeat when no production job is available", async () => {
  const heartbeats = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    hostname: "test-host",
    claimJob: async () => null,
    updateHeartbeat: async (heartbeat) => heartbeats.push(heartbeat),
    now: () => new Date("2026-07-14T00:00:00.000Z")
  });

  assert.equal(await worker.tick(), false);
  assert.deepEqual(heartbeats, [{
    workerId: "test-worker",
    workerName: "Test Worker",
    hostname: "test-host",
    status: "online",
    currentJobId: "",
    capabilities: Array.from(worker.capabilities),
    lastSeenAt: "2026-07-14T00:00:00.000Z"
  }]);
});

test("reports busy then idle heartbeats and persists success milestones in order", async () => {
  const heartbeats = [];
  const updates = [];
  const result = { outputUrl: "https://example.test/final.mp4" };
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "pipeline", payload: {} }),
    updateJob: async (id, patch) => updates.push({ id, patch }),
    updateHeartbeat: async (heartbeat) => heartbeats.push(heartbeat),
    processJob: async () => result,
    now: () => new Date("2026-07-14T00:00:00.000Z")
  });

  assert.equal(await worker.tick(), true);
  assert.equal(heartbeats.some((item) => item.currentJobId === "job-1" && item.status === "busy"), true);
  assert.equal(heartbeats.at(-1).status, "online");
  assert.equal(heartbeats.at(-1).currentJobId, "");
  assert.deepEqual(updates.map((item) => item.patch.progress), [25, 75, 90, 100]);
  assert.deepEqual(updates.at(-1), {
    id: "job-1",
    patch: {
      status: "completed",
      progress: 100,
      progressMessage: "Completed",
      outputUrl: result.outputUrl,
      result
    }
  });
});

test("retains the last milestone, stores only the error message, and clears busy state after failure", async () => {
  const heartbeats = [];
  const updates = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "pipeline", payload: {} }),
    updateJob: async (id, patch) => updates.push({ id, patch }),
    updateHeartbeat: async (heartbeat) => heartbeats.push(heartbeat),
    processJob: async () => {
      throw new Error("provider request failed");
    },
    now: () => new Date("2026-07-14T00:00:00.000Z")
  });

  assert.equal(await worker.tick(), true);
  assert.deepEqual(updates.map((item) => item.patch.progress), [25, 25]);
  assert.deepEqual(updates.at(-1), {
    id: "job-1",
    patch: {
      status: "failed",
      progress: 25,
      error: "provider request failed"
    }
  });
  assert.equal(heartbeats.at(-1).status, "online");
  assert.equal(heartbeats.at(-1).currentJobId, "");
});

test("schedules five-second heartbeats and clears the timer during shutdown", async () => {
  const heartbeats = [];
  const timers = [];
  const cleared = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => null,
    updateHeartbeat: async (heartbeat) => heartbeats.push(heartbeat),
    setIntervalFn: (callback, ms) => {
      timers.push({ callback, ms });
      return 0;
    },
    clearIntervalFn: (timer) => cleared.push(timer)
  });

  await worker.start();
  await worker.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000);
  timers[0].callback();
  await Promise.resolve();
  worker.shutdown();
  worker.shutdown();

  assert.equal(heartbeats.length, 2);
  assert.deepEqual(cleared, [0]);
});
