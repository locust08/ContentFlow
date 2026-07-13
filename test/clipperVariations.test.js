import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { listClipperReactions, renderClipperVariations } from "../src/services/clipperVariations.js";

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contentflow-variations-"));
  const projectDir = path.join(root, "demo");
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(reactionDir, { recursive: true });
  fs.writeFileSync(path.join(reactionDir, "maya.png"), "maya");
  fs.writeFileSync(path.join(reactionDir, "zoe.mp4"), "zoe");
  fs.writeFileSync(path.join(generatedDir, "reaction-characters.json"), JSON.stringify({
    characters: [
      { id: "r-1", name: "Maya", path: "clipper/reaction/maya.png", type: "image" },
      { id: "r-2", name: "Zoe", path: "clipper/reaction/zoe.mp4", type: "video" }
    ]
  }));
  fs.writeFileSync(path.join(generatedDir, "selected-highlight.json"), JSON.stringify({
    id: "highlight-1",
    title: "How To Build Momentum",
    start: 4,
    end: 34
  }));
  return { root, projectDir };
}

test("discovers manifest characters and unlisted legacy reaction assets", (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projectDir, "clipper", "reaction", "legacy.webp"), "legacy");

  const reactions = listClipperReactions(projectDir, "demo");

  assert.deepEqual(reactions.map((reaction) => reaction.id), ["r-1", "r-2", "legacy-legacy"]);
  assert.equal(reactions[2].path, "clipper/reaction/legacy.webp");
  assert.equal(reactions[2].type, "image");
  assert.match(reactions[0].url, /^\/media\/demo\/clipper\/reaction\/maya\.png\?v=/);
});

test("renders character variations independently and records partial failures", async (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];

  const result = await renderClipperVariations({
    project: "demo",
    projectDir,
    port: 4173,
    cwd: root,
    reactionIds: ["r-1", "r-2"],
    renderClip: async ({ outputName, reactionAsset }) => {
      calls.push({ outputName, reactionAsset });
      if (reactionAsset.id === "r-2") throw new Error("render failed");
      return { output: `renders/clips/${outputName}`, clipStart: 4, clipEnd: 34 };
    }
  });

  assert.deepEqual(result.selectedHighlight, {
    id: "highlight-1",
    title: "How To Build Momentum",
    start: 4,
    end: 34
  });
  assert.equal(result.count, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.outputs[0].reactionId, "r-1");
  assert.match(result.outputs[0].output, /^renders\/clips\/char-01-/);
  assert.equal(result.outputs[1].status, "failed");
  assert.equal(result.outputs[1].error, "render failed");
  assert.equal(calls[0].outputName, "char-01-maya__clip-how-to-build-momentum.mp4");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(projectDir, "clipper", "generated", "clipper-character-variations-manifest.json"), "utf8")),
    result
  );
});

test("rejects rendering without an active highlight or matching reaction", async (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(projectDir, "clipper", "generated", "selected-highlight.json"));

  await assert.rejects(
    renderClipperVariations({ project: "demo", projectDir, reactionIds: ["r-1"] }),
    /Make one highlight active/
  );

  fs.writeFileSync(path.join(projectDir, "clipper", "generated", "selected-highlight.json"), JSON.stringify({ id: "highlight-1" }));
  await assert.rejects(
    renderClipperVariations({ project: "demo", projectDir, reactionIds: ["missing"] }),
    /Select at least one reaction character/
  );
});
