import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { listClipperReactions, renderClipperVariations } from "../src/services/clipperVariations.js";
import { projectPath } from "../src/config.js";
import { handleRequest } from "../src/server.js";

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

test("assigns unique IDs to legacy reaction files with colliding stems", (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  fs.writeFileSync(path.join(reactionDir, "twin.png"), "png");
  fs.writeFileSync(path.join(reactionDir, "twin.webp"), "webp");

  const reactions = listClipperReactions(projectDir, "demo");

  assert.deepEqual(
    reactions.filter((reaction) => reaction.name === "twin").map((reaction) => reaction.id),
    ["legacy-twin", "legacy-twin-2"]
  );
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

test("freezes highlight and subtitle inputs before rendering every variation", async (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const subtitlePlan = { selectedHighlightId: "highlight-1", subtitles: [{ start: 0, end: 1, text: "Frozen" }] };
  fs.writeFileSync(path.join(generatedDir, "clip-subtitle-plan.json"), JSON.stringify(subtitlePlan));
  const snapshots = [];

  await renderClipperVariations({
    project: "demo",
    projectDir,
    reactionIds: ["r-1", "r-2"],
    renderClip: async (options) => {
      snapshots.push({ selectedHighlight: options.selectedHighlight, subtitlePlan: options.subtitlePlan });
      fs.writeFileSync(path.join(generatedDir, "selected-highlight.json"), JSON.stringify({ id: "changed", title: "Changed", start: 99, end: 100 }));
      fs.writeFileSync(path.join(generatedDir, "clip-subtitle-plan.json"), JSON.stringify({ subtitles: [{ text: "Changed" }] }));
      return { output: `renders/clips/${options.outputName}`, clipStart: 4, clipEnd: 34 };
    }
  });

  assert.deepEqual(snapshots, [
    {
      selectedHighlight: { id: "highlight-1", title: "How To Build Momentum", start: 4, end: 34 },
      subtitlePlan
    },
    {
      selectedHighlight: { id: "highlight-1", title: "How To Build Momentum", start: 4, end: 34 },
      subtitlePlan
    }
  ]);
});

test("uses the highlight carried by a queued variation job instead of stale local selection", async (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const analysisDir = path.join(projectDir, "clipper", "analysis");
  fs.mkdirSync(analysisDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "highlight-candidates.json"), JSON.stringify({
    candidates: [
      { id: "highlight-1", title: "Stale", start: 0, end: 10 },
      { id: "highlight-2", title: "Exact hosted choice", start: 12, end: 42 }
    ]
  }));
  fs.writeFileSync(path.join(analysisDir, "source-transcript.json"), JSON.stringify({
    segments: [{ start: 12, end: 14, text: "Exact hosted choice" }]
  }));

  const result = await renderClipperVariations({
    project: "demo",
    projectDir,
    highlightId: "highlight-2",
    reactionIds: ["r-1"],
    renderClip: async ({ outputName, selectedHighlight }) => ({
      output: `renders/clips/${outputName}`,
      clipStart: selectedHighlight.start,
      clipEnd: selectedHighlight.end
    })
  });

  assert.equal(result.selectedHighlight.id, "highlight-2");
  assert.equal(result.outputs[0].highlightId, "highlight-2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(generatedDir, "selected-highlight.json"), "utf8")).id, "highlight-2");
});

test("downloads a hosted reaction reference when the worker has no local copy", async (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await renderClipperVariations({
    project: "demo",
    projectDir,
    reactionIds: ["hosted-r-1"],
    reactionAssets: [{
      id: "hosted-r-1",
      name: "Hosted Maya",
      localPath: "clipper/reaction/hosted-maya.png",
      url: "https://media.example.test/hosted-maya.png",
      mediaType: "image"
    }],
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } }),
    renderClip: async ({ outputName, reactionAsset }) => {
      assert.equal(reactionAsset.id, "hosted-r-1");
      assert.equal(fs.existsSync(path.join(projectDir, reactionAsset.path)), true);
      return { output: `renders/clips/${outputName}`, clipStart: 4, clipEnd: 34 };
    }
  });

  assert.equal(result.completed, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, "clipper", "generated", "reaction-characters.json"), "utf8"));
  assert.equal(manifest.characters.some((character) => character.id === "hosted-r-1"), true);
});

test("repairs a stale reaction manifest when its local file is missing", async (t) => {
  const { root, projectDir } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(projectDir, "clipper", "reaction", "maya.png"));

  const result = await renderClipperVariations({
    project: "demo",
    projectDir,
    reactionIds: ["r-1"],
    reactionAssets: [{
      id: "r-1",
      name: "Maya",
      localPath: "clipper/reaction/maya.png",
      url: "https://media.example.test/maya.png",
      mediaType: "image"
    }],
    fetchImpl: async () => new Response(new Uint8Array([4, 5, 6]), { status: 200 }),
    renderClip: async ({ outputName, reactionAsset }) => {
      assert.equal(fs.existsSync(path.join(projectDir, reactionAsset.path)), true);
      return { output: `renders/clips/${outputName}`, clipStart: 4, clipEnd: 34 };
    }
  });

  assert.equal(result.completed, 1);
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

test("returns 207 for local variation partial success", async (t) => {
  const project = `variation-local-207-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const projectDir = projectPath(project);
  const generatedDir = path.join(projectDir, "clipper", "generated");
  const reactionDir = path.join(projectDir, "clipper", "reaction");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(reactionDir, { recursive: true });
  fs.writeFileSync(path.join(reactionDir, "local.png"), "local");
  fs.writeFileSync(path.join(generatedDir, "reaction-characters.json"), JSON.stringify({
    characters: [{ id: "r-local", name: "Local", path: "clipper/reaction/local.png", type: "image" }]
  }));
  fs.writeFileSync(path.join(generatedDir, "selected-highlight.json"), JSON.stringify({ id: "highlight-local", title: "Local highlight", start: 0, end: 10 }));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  const server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`http://127.0.0.1:${port}/api/projects/${project}/clipper/render-variations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reactionIds: ["r-local"] })
  });
  const body = await response.json();

  assert.equal(response.status, 207);
  assert.equal(body.ok, false);
  assert.equal(body.result.failed, 1);
});
