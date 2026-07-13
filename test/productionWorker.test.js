import assert from "node:assert/strict";
import test from "node:test";
import { deliverVariationOutputs, runWorkerTick } from "../src/worker/productionWorker.js";

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
