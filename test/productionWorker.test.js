import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProductionWorker, deliverVariationOutputs, runWorker, runWorkerTick } from "../src/worker/productionWorker.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(condition) {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  assert.fail("Timed out waiting for asynchronous worker state.");
}

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

test("constructs the default worker identity without shadowing the Node process", () => {
  const worker = createProductionWorker();

  assert.equal(typeof worker.workerId, "string");
  assert.notEqual(worker.workerId, "");
  assert.equal(typeof worker.workerName, "string");
  assert.notEqual(worker.workerName, "");
});

test("persists a completed variation output URL when the runtime marks a partial result failed", async () => {
  const updates = [];
  const result = variationResult();
  result.outputs[0].status = "failed";
  result.outputs[0].error = "render failed";
  result.outputs[1].outputUrl = "https://storage/two.mp4";
  result.completed = 1;
  result.failed = 1;
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "clipper-render-variations" }),
    updateJob: async (id, patch) => updates.push({ id, patch }),
    updateHeartbeat: async () => {},
    processJob: async () => result
  });

  await worker.tick();

  assert.deepEqual(updates.at(-1), {
    id: "job-1",
    patch: {
      status: "failed",
      progress: 25,
      outputUrl: "https://storage/two.mp4",
      error: "1 variation output failed.",
      result
    }
  });
});

test("serializes a deferred busy heartbeat before the final idle heartbeat", async () => {
  const heartbeatWrites = [];
  let persistedStatus = "";
  const processing = deferred();
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "pipeline" }),
    updateJob: async () => {},
    updateHeartbeat: (heartbeat) => {
      const write = deferred();
      heartbeatWrites.push({ heartbeat, write });
      return write.promise.then(() => {
        persistedStatus = heartbeat.status;
      });
    },
    processJob: async () => processing.promise
  });

  const tick = worker.tick();
  await waitFor(() => heartbeatWrites.length === 1);
  heartbeatWrites[0].write.resolve();
  await waitFor(() => heartbeatWrites[0].heartbeat.status === "busy");
  const staleBusy = worker.heartbeat();
  await waitFor(() => heartbeatWrites.length === 2);
  processing.resolve({ outputUrl: "https://example.test/final.mp4" });
  await new Promise(setImmediate);

  assert.equal(heartbeatWrites.length, 2);
  heartbeatWrites[1].write.resolve();
  await waitFor(() => heartbeatWrites.length === 3);
  heartbeatWrites[2].write.resolve();
  await Promise.all([staleBusy, tick]);

  assert.equal(heartbeatWrites.at(-1).heartbeat.status, "online");
  assert.equal(persistedStatus, "online");
});

test("records the last persisted progress when a later milestone update rejects", async () => {
  const updates = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "pipeline" }),
    updateJob: async (_id, patch) => {
      updates.push(patch);
      if (patch.progress === 75) throw new Error("persistence failed");
    },
    updateHeartbeat: async () => {},
    processJob: async () => ({ outputUrl: "https://example.test/final.mp4" })
  });

  await worker.tick();

  assert.equal(updates.at(-1).status, "failed");
  assert.equal(updates.at(-1).progress, 25);
  assert.equal(updates.at(-1).error, "persistence failed");
});

test("retains claimed progress when the first worker milestone update rejects", async () => {
  const updates = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "pipeline", progress: 10 }),
    updateJob: async (_id, patch) => {
      updates.push(patch);
      if (patch.progress === 25) throw new Error("persistence failed");
    },
    updateHeartbeat: async () => {},
    processJob: async () => {
      assert.fail("The worker must not process a job whose initial milestone was not persisted.");
    }
  });

  await worker.tick();

  assert.equal(updates.at(-1).status, "failed");
  assert.equal(updates.at(-1).progress, 10);
  assert.equal(updates.at(-1).error, "persistence failed");
});

test("coalesces concurrent starts into one initial heartbeat and timer", async () => {
  const timers = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    updateHeartbeat: async () => {},
    setIntervalFn: (...args) => {
      timers.push(args);
      return timers.length;
    }
  });

  await Promise.all([worker.start(), worker.start()]);

  assert.equal(timers.length, 1);
});

test("does not schedule a timer when shutdown races an initial heartbeat", async () => {
  const pendingHeartbeat = deferred();
  const timers = [];
  const worker = createProductionWorker({
    workerId: "test-worker",
    workerName: "Test Worker",
    updateHeartbeat: async () => pendingHeartbeat.promise,
    setIntervalFn: (...args) => {
      timers.push(args);
      return timers.length;
    }
  });

  const start = worker.start();
  worker.shutdown();
  pendingHeartbeat.resolve();
  await start;

  assert.equal(timers.length, 0);
});

test("retries a transient startup heartbeat before scheduling the worker timer", async () => {
  let heartbeatWrites = 0;
  let scheduled = 0;
  const worker = createProductionWorker({
    workerId: "retry-worker",
    updateHeartbeat: async () => {
      heartbeatWrites += 1;
      if (heartbeatWrites < 3) throw new Error("temporary Supabase outage");
    },
    sleepFn: async () => {},
    setIntervalFn: () => {
      scheduled += 1;
      return 1;
    },
    clearIntervalFn: () => {}
  });

  await worker.start();

  assert.equal(heartbeatWrites, 3);
  assert.equal(scheduled, 1);
  worker.shutdown();
});

test("heartbeat exhaustion does not fail an otherwise successful production job", async () => {
  const updates = [];
  let processed = 0;
  const worker = createProductionWorker({
    workerId: "resilient-worker",
    claimJob: async () => ({ id: "job-heartbeat", projectName: "demo", jobType: "pipeline", progress: 10 }),
    updateJob: async (id, patch) => updates.push({ id, patch }),
    updateHeartbeat: async () => { throw new Error("Supabase heartbeat unavailable"); },
    processJob: async () => {
      processed += 1;
      return { outputUrl: "https://example.test/final.mp4" };
    },
    sleepFn: async () => {}
  });

  assert.equal(await worker.tick(), true);
  assert.equal(processed, 1);
  assert.equal(updates.at(-1).patch.status, "completed");
  assert.equal(updates.at(-1).patch.progress, 100);
});

test("records one worker-online event when the worker runtime starts", async () => {
  const events = [];
  const runtime = {
    workerId: "worker-audit",
    workerName: "Audit Worker",
    hostname: "audit-host",
    capabilities: ["pipeline"],
    start: async () => {},
    tick: async () => false,
    shutdown: () => {}
  };

  await runWorker({
    once: true,
    worker: runtime,
    recordActivity: async (event) => events.push(event)
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "production.worker.online");
  assert.equal(events[0].metadata.workerId, "worker-audit");
});

test("continuous worker recovers after a transient tick failure", async () => {
  let ticks = 0;
  let sleeps = 0;
  let shutdowns = 0;
  const stop = new Error("stop test loop");
  const runtime = {
    workerId: "recover-worker",
    workerName: "Recover Worker",
    hostname: "recover-host",
    capabilities: ["pipeline"],
    start: async () => {},
    tick: async () => {
      ticks += 1;
      if (ticks === 1) throw new Error("temporary claim failure");
      return false;
    },
    shutdown: () => { shutdowns += 1; }
  };

  await assert.rejects(
    runWorker({
      worker: runtime,
      recordActivity: async () => {},
      pollSleepFn: async () => {
        sleeps += 1;
        if (sleeps === 2) throw stop;
      }
    }),
    /stop test loop/
  );

  assert.equal(ticks, 2);
  assert.equal(sleeps, 2);
  assert.equal(shutdowns, 1);
});
