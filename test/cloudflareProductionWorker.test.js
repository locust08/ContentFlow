import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const originalCwd = process.cwd();
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-production-worker-"));
process.chdir(testRoot);
const {
  canonicalHostedAssetPath,
  createProductionJobProcessor,
  createProductionWorkerTick,
  ensureHostedSourceAssets
} = await import("../src/worker/productionWorker.js");
process.chdir(originalCwd);

test.after(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

async function projectDirectory(name) {
  const directory = path.join(testRoot, "projects", name);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

function hostedContext(overrides = {}) {
  return {
    project: { name: "hosted-project", campaignId: "campaign-1" },
    assets: [],
    campaignIntelligence: {
      campaignBrief: { id: "brief-1", campaignId: "campaign-1", brief: { product: "Bee Phone" } },
      researchSources: [{ id: "source-1", content: "Fast setup" }],
      marketReport: {
        id: "report-1",
        status: "approved",
        scriptwriterInput: { campaignBrief: { product: "Bee Phone" } }
      }
    },
    scriptBundle: { ugcScript: null, scriptVersions: [], scriptReviewEvents: [] },
    ...overrides
  };
}

function forbiddenSupabase() {
  const fail = async () => {
    throw new Error("Supabase must not be called in Cloudflare mode");
  };
  return {
    campaignIntelligence: fail,
    projectScriptBundle: fail,
    upsertClipCandidates: fail,
    upsertMarketReport: fail,
    upsertUgcScript: fail,
    upsertUgcScriptVersion: fail
  };
}

function generatedScript() {
  return {
    title: "Hosted script",
    status: "draft",
    hooks: [
      { id: "hook-1", text: "One" },
      { id: "hook-2", text: "Two" },
      { id: "hook-3", text: "Three" }
    ],
    scenes: [{ id: "scene-1", visualAction: "Show product", audioSpokenWord: "Try it" }]
  };
}

test("hosted assets atomically replace stale canonical files and ignore remote localPath", async () => {
  const projectDir = await projectDirectory("hydrate-assets");
  const existingReference = path.join(projectDir, "reference", "reference.mp4");
  await fs.mkdir(path.dirname(existingReference), { recursive: true });
  await fs.writeFile(existingReference, "existing");
  const assets = [
    { id: "reference-1", kind: "reference-video", name: "../../outside.mp4", localPath: "../../stolen.mp4" },
    { id: "product-1", kind: "product-image", name: "../Product Hero.PNG", localPath: "C:\\private\\product.png" },
    { id: "character-1", kind: "character-reference", name: "folder\\Presenter.JPG", localPath: "/private/presenter.jpg" },
    { id: "source-1", kind: "clipper-source", name: "remote.mov", localPath: "../../source.mov" },
    { id: "reaction-1", kind: "reaction-character", name: "../Reaction One.WEBM", localPath: "../../reaction.webm" },
    { id: "reaction-2", kind: "reaction-character", name: "nested/reaction-two.png", localPath: "../../reaction.png" },
    { id: "output-1", kind: "final-render", name: "final.mp4", localPath: "../../final.mp4" }
  ];
  const downloads = [];
  const cloudflareClient = {
    async downloadAsset({ assetId, localPath }) {
      downloads.push({ assetId, localPath });
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, assetId);
    }
  };

  await ensureHostedSourceAssets({ projectDir, assets, cloudflareClient });

  assert.deepEqual(downloads.map((item) => item.assetId), ["reference-1", "product-1", "character-1", "source-1", "reaction-1", "reaction-2"]);
  assert.ok(downloads.every((item) => item.localPath.endsWith(".download")));
  assert.ok(downloads.every((item) => item.localPath.startsWith(`${path.resolve(projectDir)}${path.sep}`)));
  assert.equal(canonicalHostedAssetPath(projectDir, assets[6]), null);
  assert.equal(await fs.readFile(existingReference, "utf8"), "reference-1");
  assert.equal(await fs.readFile(path.join(projectDir, "product", "product-hero.png"), "utf8"), "product-1");
  assert.equal(await fs.readFile(path.join(projectDir, "character", "presenter.jpg"), "utf8"), "character-1");
  assert.equal(await fs.readFile(path.join(projectDir, "clipper", "source", "source-video.mp4"), "utf8"), "source-1");
  assert.equal(await fs.readFile(canonicalHostedAssetPath(projectDir, assets[4]), "utf8"), "reaction-1");
  assert.equal(await fs.readFile(canonicalHostedAssetPath(projectDir, assets[5]), "utf8"), "reaction-2");
  assert.deepEqual((await fs.readdir(path.join(projectDir, "reference"))).filter((name) => name.endsWith(".download")), []);
});

test("hosted hydration keeps the newest singleton source asset", async () => {
  const projectDir = await projectDirectory("hydrate-latest-source");
  const assets = [
    { id: "reference-new", kind: "reference-video", name: "new.mp4" },
    { id: "reference-old", kind: "reference-video", name: "old.mp4" }
  ];
  const downloads = [];
  const cloudflareClient = {
    async downloadAsset({ assetId, localPath }) {
      downloads.push(assetId);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, assetId);
    }
  };

  await ensureHostedSourceAssets({ projectDir, assets, cloudflareClient });

  assert.deepEqual(downloads, ["reference-new"]);
  assert.equal(await fs.readFile(path.join(projectDir, "reference", "reference.mp4"), "utf8"), "reference-new");
});

test("reaction characters with the same display filename hydrate to distinct paths", async () => {
  const projectDir = await projectDirectory("hydrate-reaction-collisions");
  const assets = [
    { id: "reaction-a", kind: "reaction-character", name: "Presenter.mp4" },
    { id: "reaction-b", kind: "reaction-character", name: "Presenter.mp4" }
  ];
  const destinations = assets.map((asset) => canonicalHostedAssetPath(projectDir, asset));
  const cloudflareClient = {
    async downloadAsset({ assetId, localPath }) {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, assetId);
    }
  };

  await ensureHostedSourceAssets({ projectDir, assets, cloudflareClient });

  assert.notEqual(destinations[0], destinations[1]);
  assert.equal(await fs.readFile(destinations[0], "utf8"), "reaction-a");
  assert.equal(await fs.readFile(destinations[1], "utf8"), "reaction-b");
});

test("Cloudflare media generation jobs upload every generated output and return stable hosted metadata", async (t) => {
  const cases = [
    {
      jobType: "generate-images",
      project: "hosted-images",
      prepare: async (projectDir) => {
        await fs.mkdir(path.join(projectDir, "generated"), { recursive: true });
        await fs.writeFile(path.join(projectDir, "generated", "image-prompts.json"), JSON.stringify({ prompts: [{ prompt: "One" }] }));
      },
      service: "generateSceneImages",
      files: ["assets/images/scene-01.png", "assets/images/scene-02.png"],
      result: { images: [{ file: "assets/images/scene-01.png" }, { file: "assets/images/scene-02.png" }] },
      kinds: ["generated-image", "generated-image"],
      contentTypes: ["image/png", "image/png"]
    },
    {
      jobType: "generate-videos",
      project: "hosted-videos",
      prepare: async (projectDir) => {
        await fs.mkdir(path.join(projectDir, "generated"), { recursive: true });
        await fs.writeFile(path.join(projectDir, "generated", "video-prompts.json"), JSON.stringify({ prompts: [{ prompt: "One" }] }));
      },
      service: "generateLibTvVideos",
      files: ["assets/videos/scene-01.mp4", "assets/videos/scene-01-alt.webm"],
      result: { videos: [{ downloaded: [{ file: "assets/videos/scene-01.mp4" }, { file: "assets/videos/scene-01-alt.webm" }] }] },
      kinds: ["generated-video", "generated-video"],
      contentTypes: ["video/mp4", "video/webm"]
    },
    {
      jobType: "generate-ugc-video",
      project: "hosted-ugc",
      prepare: async (projectDir) => {
        await fs.mkdir(path.join(projectDir, "analysis"), { recursive: true });
        await fs.writeFile(path.join(projectDir, "analysis", "reference-blueprint.json"), "{}");
      },
      service: "generateLibTvUgcVideo",
      files: ["assets/videos/ugc-output.mp4", "assets/videos/ugc-candidate-01.mp4"],
      result: {
        output: "assets/videos/ugc-output.mp4",
        downloaded: [
          { file: "assets/videos/ugc-output.mp4" },
          { file: "assets/videos/ugc-candidate-01.mp4" }
        ]
      },
      kinds: ["generated-video", "generated-video"],
      contentTypes: ["video/mp4", "video/mp4"],
      script: { ...generatedScript(), id: "script-ugc", campaignId: "campaign-1", status: "approved", versionId: "version-1" },
      payload: { scriptVersionId: "version-1" }
    },
    {
      jobType: "generate-voiceover",
      project: "hosted-voiceover",
      prepare: async (projectDir) => {
        await fs.mkdir(path.join(projectDir, "generated"), { recursive: true });
        await fs.writeFile(path.join(projectDir, "generated", "script-plan.json"), JSON.stringify({ scenes: [{ voiceover: "Hello" }] }));
      },
      service: "generateElevenLabsVoiceover",
      files: ["assets/audio/voiceover.mp3"],
      result: { file: "assets/audio/voiceover.mp3" },
      kinds: ["generated-audio"],
      contentTypes: ["audio/mpeg"]
    }
  ];

  for (const definition of cases) {
    await t.test(definition.jobType, async () => {
      const projectDir = await projectDirectory(definition.project);
      await definition.prepare(projectDir);
      for (const file of definition.files) {
        const localPath = path.join(projectDir, file);
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, file);
      }
      const uploads = [];
      const context = hostedContext({
        project: { name: definition.project, campaignId: "campaign-1" },
        scriptBundle: {
          ugcScript: definition.script || null,
          scriptVersions: [],
          scriptReviewEvents: []
        }
      });
      const cloudflareClient = {
        getProjectContext: async () => context,
        downloadAsset: async () => {},
        uploadProjectAsset: async (input) => {
          uploads.push(input);
          return { id: `asset-${uploads.length}`, url: `https://media.example/${encodeURIComponent(input.assetPath)}` };
        }
      };
      const processor = createProductionJobProcessor({
        cloudflareClient,
        supabase: forbiddenSupabase(),
        services: {
          [definition.service]: async () => definition.result
        }
      });

      const result = await processor({
        projectName: definition.project,
        jobType: definition.jobType,
        payload: definition.payload || {}
      });

      assert.deepEqual(uploads.map((upload) => upload.assetPath), definition.files);
      assert.deepEqual(uploads.map((upload) => upload.kind), definition.kinds);
      assert.deepEqual(uploads.map((upload) => upload.contentType), definition.contentTypes);
      assert.deepEqual(result.hostedOutputs, definition.files.map((file, index) => ({
        assetId: `asset-${index + 1}`,
        file,
        kind: definition.kinds[index],
        contentType: definition.contentTypes[index],
        url: `https://media.example/${encodeURIComponent(file)}`
      })));
    });
  }
});

test("lease abort after generation prevents subsequent R2 uploads", async () => {
  const projectDir = await projectDirectory("aborted-images");
  await fs.mkdir(path.join(projectDir, "generated"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "generated", "image-prompts.json"), JSON.stringify({ prompts: [{ prompt: "One" }] }));
  const controller = new AbortController();
  let uploads = 0;
  let receivedSignal;
  const processor = createProductionJobProcessor({
    cloudflareClient: {
      getProjectContext: async () => hostedContext({ project: { name: "aborted-images", campaignId: "campaign-1" } }),
      downloadAsset: async () => {},
      uploadProjectAsset: async () => {
        uploads += 1;
        return { id: "should-not-upload" };
      }
    },
    supabase: forbiddenSupabase(),
    services: {
      generateSceneImages: async ({ signal }) => {
        receivedSignal = signal;
        controller.abort(new Error("lease lost during image generation"));
        return { images: [{ file: "assets/images/scene-01.png" }] };
      }
    }
  });

  await assert.rejects(
    () => processor({ projectName: "aborted-images", jobType: "generate-images", payload: {} }, { signal: controller.signal }),
    /lease lost during image generation/i
  );
  assert.equal(receivedSignal, controller.signal);
  assert.equal(uploads, 0);
});

test("final and bulk clip renders forward the lease signal through R2 publication", async (t) => {
  await t.test("final render", async () => {
    await projectDirectory("signal-final");
    const controller = new AbortController();
    const renderSignals = [];
    const uploadSignals = [];
    const processor = createProductionJobProcessor({
      cloudflareClient: {
        getProjectContext: async () => hostedContext({ project: { name: "signal-final" } }),
        downloadAsset: async () => {},
        uploadProjectAsset: async (input) => {
          uploadSignals.push(input.signal);
          return { id: "asset-final", url: "https://media.example/final.mp4" };
        }
      },
      services: {
        renderFinalVideo: async ({ signal }) => {
          renderSignals.push(signal);
          return { output: "renders/final.mp4", mode: "ugc" };
        }
      },
      supabase: forbiddenSupabase()
    });

    const result = await processor(
      { projectName: "signal-final", jobType: "render-final-video", payload: {} },
      { signal: controller.signal }
    );

    assert.deepEqual(renderSignals, [controller.signal]);
    assert.deepEqual(uploadSignals, [controller.signal]);
    assert.equal(result.outputUrl, "https://media.example/final.mp4");
  });

  await t.test("bulk clip render", async () => {
    const projectDir = await projectDirectory("signal-bulk");
    await fs.mkdir(path.join(projectDir, "clipper", "generated"), { recursive: true });
    await fs.mkdir(path.join(projectDir, "clipper", "analysis"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "clipper", "generated", "highlight-candidates.json"), JSON.stringify({
      candidates: [
        { id: "moment-1", title: "Moment one", start: 0, end: 30, durationSeconds: 30 },
        { id: "moment-2", title: "Moment two", start: 30, end: 60, durationSeconds: 30 }
      ]
    }));
    await fs.writeFile(path.join(projectDir, "clipper", "analysis", "source-transcript.json"), JSON.stringify({
      segments: [{ start: 0, end: 60, text: "A complete test transcript" }]
    }));
    const controller = new AbortController();
    const renderSignals = [];
    const uploadSignals = [];
    const processor = createProductionJobProcessor({
      cloudflareClient: {
        getProjectContext: async () => hostedContext({ project: { name: "signal-bulk" } }),
        downloadAsset: async () => {},
        uploadProjectAsset: async (input) => {
          uploadSignals.push(input.signal);
          return { id: `asset-${uploadSignals.length}`, url: `https://media.example/${input.assetPath}` };
        }
      },
      services: {
        renderClipperVideo: async ({ outputName, signal }) => {
          renderSignals.push(signal);
          return { output: `renders/clips/${outputName}`, mode: "clipper" };
        }
      },
      supabase: forbiddenSupabase()
    });

    const result = await processor({
      projectName: "signal-bulk",
      jobType: "clipper-render-bulk",
      payload: { highlightIds: ["moment-1", "moment-2"] }
    }, { signal: controller.signal });

    assert.deepEqual(renderSignals, [controller.signal, controller.signal]);
    assert.deepEqual(uploadSignals, [controller.signal, controller.signal]);
    assert.equal(result.outputs.length, 2);
  });
});

test("hosted character variations render and upload one output per selected reaction", async () => {
  const projectDir = await projectDirectory("hosted-variations");
  await fs.mkdir(path.join(projectDir, "clipper", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "clipper", "generated", "selected-highlight.json"), JSON.stringify({
    id: "highlight-1",
    title: "Best reveal"
  }));
  const controller = new AbortController();
  const renders = [];
  const uploads = [];
  const context = hostedContext({
    project: { name: "hosted-variations" },
    assets: [
      { id: "reaction-a", kind: "reaction-character", name: "Levi Smile.mp4", contentType: "video/mp4" },
      { id: "reaction-b", kind: "reaction-character", name: "Maya.png", contentType: "image/png" }
    ]
  });
  const processor = createProductionJobProcessor({
    cloudflareClient: {
      getProjectContext: async () => context,
      async downloadAsset({ assetId, localPath }) {
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, assetId);
      },
      async uploadProjectAsset(input) {
        uploads.push(input);
        return { id: `output-${uploads.length}`, url: `https://media.example/${input.assetPath}` };
      }
    },
    services: {
      async renderClipperVideo(input) {
        renders.push(input);
        return {
          output: `renders/clips/${input.outputName}`,
          clipStart: 12,
          clipEnd: 48,
          mode: "clipper"
        };
      }
    },
    supabase: forbiddenSupabase()
  });

  const result = await processor({
    projectName: "hosted-variations",
    jobType: "clipper-render-variations",
    payload: { reactionIds: ["reaction-a", "reaction-b"] }
  }, { signal: controller.signal });

  assert.equal(result.mode, "clipper-character-variations");
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(renders.map((item) => item.reactionAsset.id), ["reaction-a", "reaction-b"]);
  assert.deepEqual(renders.map((item) => item.signal), [controller.signal, controller.signal]);
  assert.deepEqual(uploads.map((item) => item.signal), [controller.signal, controller.signal]);
  assert.deepEqual(uploads.map((item) => item.assetPath), result.outputs.map((item) => item.output));
  assert.match(result.outputs[0].output, /^renders\/clips\/char-01-levi-smile__clip-best-reveal\.mp4$/);
  assert.match(result.outputs[1].output, /^renders\/clips\/char-02-maya__clip-best-reveal\.mp4$/);
  assert.ok(result.outputs.every((item) => item.outputUrl.startsWith("https://media.example/")));

  const saved = JSON.parse(await fs.readFile(path.join(
    projectDir,
    "clipper",
    "generated",
    "clipper-character-variations-manifest.json"
  ), "utf8"));
  assert.equal(saved.completed, 2);
});

test("completion reconciliation errors remain retryable while generation failures are terminal", async (t) => {
  await t.test("completion failure is not reported as a terminal job failure", async () => {
    const calls = [];
    const job = { id: "job-reconcile", projectName: "hosted-project", jobType: "generate-ugc-script" };
    const tick = createProductionWorkerTick({
      queue: {
        claim: async () => job,
        run: async (_job, work) => work(new AbortController().signal),
        complete: async () => {
          throw new Error("UGC script reconciliation did not persist a version");
        },
        fail: async () => calls.push("fail")
      },
      processJob: async () => ({ script: { id: "script-1" }, version: { id: "version-1" } }),
      log: () => {},
      logError: (message) => calls.push(message)
    });

    assert.equal(await tick(), true);
    assert.equal(calls.includes("fail"), false);
    assert.ok(calls.some((message) => /completion deferred for retry/i.test(message)));
  });

  await t.test("generation failure is still reported as terminal", async () => {
    const calls = [];
    const job = { id: "job-generation", projectName: "hosted-project", jobType: "generate-images" };
    const tick = createProductionWorkerTick({
      queue: {
        claim: async () => job,
        run: async (_job, work) => work(new AbortController().signal),
        complete: async () => calls.push("complete"),
        fail: async (_job, error) => calls.push(["fail", error.message])
      },
      processJob: async () => {
        throw new Error("image generation failed");
      },
      log: () => {},
      logError: () => {}
    });

    assert.equal(await tick(), true);
    assert.deepEqual(calls, [["fail", "image generation failed"]]);
  });
});

test("Cloudflare structured jobs use one D1 context and never call Supabase", async () => {
  const projectDir = await projectDirectory("hosted-project");
  await fs.mkdir(path.join(projectDir, "analysis"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "analysis", "reference-blueprint.json"), JSON.stringify({ visualStyle: { pacing: "fast" } }));
  const activeScript = {
    id: "script-1",
    campaignId: "campaign-1",
    status: "approved",
    versionId: "version-2",
    currentVersionNumber: 2,
    hooks: generatedScript().hooks,
    scenes: generatedScript().scenes
  };
  let contextCalls = 0;
  const cloudflareClient = {
    async getProjectContext() {
      contextCalls += 1;
      return hostedContext({ scriptBundle: { ugcScript: activeScript, scriptVersions: [], scriptReviewEvents: [] } });
    },
    async downloadAsset() {},
    async uploadProjectAsset({ assetPath }) {
      return { id: "asset-video", url: `https://media.example/${encodeURIComponent(assetPath)}` };
    }
  };
  const calls = { market: 0, script: 0, video: 0, clipper: 0 };
  const processor = createProductionJobProcessor({
    cloudflareClient,
    supabase: forbiddenSupabase(),
    services: {
      generateMarketReport: async () => (calls.market += 1, { report: { angle: "simple" }, scriptwriterInput: { proof: "source" } }),
      generateUgcScript: async () => (calls.script += 1, generatedScript()),
      generateLibTvUgcVideo: async ({ script, campaignBrief }) => {
        calls.video += 1;
        assert.equal(script.versionId, "version-2");
        assert.equal(campaignBrief.product, "Bee Phone");
        await fs.mkdir(path.join(projectDir, "assets", "videos"), { recursive: true });
        await fs.writeFile(path.join(projectDir, "assets", "videos", "ugc-output.mp4"), "video");
        return { output: "assets/videos/ugc-output.mp4" };
      },
      analyzeClipperSource: async () => (calls.clipper += 1, { candidates: [{ id: "clip-1" }] })
    }
  });

  const market = await processor({ id: "job-market", projectName: "hosted-project", jobType: "generate-market-report", payload: { campaignId: "campaign-1" } });
  const script = await processor({ id: "job-script", projectName: "hosted-project", jobType: "generate-ugc-script", payload: { campaignId: "campaign-1", manualTranscript: "Hello" } });
  const video = await processor({ id: "job-video", projectName: "hosted-project", jobType: "generate-ugc-video", payload: { scriptVersionId: "version-2" } });
  const clipper = await processor({ id: "job-clipper", projectName: "hosted-project", jobType: "clipper-analyze", payload: {} });

  assert.equal(market.campaignId, "campaign-1");
  assert.equal(script.script.projectName, "hosted-project");
  assert.equal(script.version.scriptId, "script-1");
  assert.equal(video.output, "assets/videos/ugc-output.mp4");
  assert.deepEqual(clipper.candidates, [{ id: "clip-1" }]);
  assert.deepEqual(calls, { market: 1, script: 1, video: 1, clipper: 1 });
  assert.equal(contextCalls, 4);
});

test("Cloudflare video production rejects a queued version that is not the active D1 version", async () => {
  await projectDirectory("version-check");
  let generated = false;
  const processor = createProductionJobProcessor({
    cloudflareClient: {
      getProjectContext: async () => hostedContext({
        project: { name: "version-check", campaignId: "campaign-1" },
        scriptBundle: {
          ugcScript: { ...generatedScript(), id: "script-1", campaignId: "campaign-1", status: "approved", versionId: "active-version" },
          scriptVersions: []
        }
      }),
      downloadAsset: async () => {}
    },
    supabase: forbiddenSupabase(),
    services: {
      generateLibTvUgcVideo: async () => {
        generated = true;
      }
    }
  });

  await assert.rejects(
    () => processor({ projectName: "version-check", jobType: "generate-ugc-video", payload: { scriptVersionId: "queued-version" } }),
    /queued script version is no longer active/i
  );
  assert.equal(generated, false);
});

test("legacy market-report jobs retain Supabase reads and writes", async () => {
  await projectDirectory("legacy-project");
  let reads = 0;
  let writes = 0;
  const processor = createProductionJobProcessor({
    cloudflareClient: null,
    supabase: {
      campaignIntelligence: async () => {
        reads += 1;
        return hostedContext().campaignIntelligence;
      },
      upsertMarketReport: async (report) => {
        writes += 1;
        return { ...report, persisted: true };
      }
    },
    services: {
      generateMarketReport: async () => ({ report: { angle: "legacy" }, scriptwriterInput: { proof: "source" } })
    }
  });

  const result = await processor({
    projectName: "legacy-project",
    jobType: "generate-market-report",
    payload: { campaignId: "campaign-1" }
  });

  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(result.persisted, true);
});

test("legacy video jobs retain the prior missing-version behavior", async () => {
  const projectDir = await projectDirectory("legacy-video");
  await fs.mkdir(path.join(projectDir, "analysis"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "analysis", "reference-blueprint.json"), "{}");
  const processor = createProductionJobProcessor({
    cloudflareClient: null,
    supabase: {
      projectScriptBundle: async () => ({
        ugcScript: { ...generatedScript(), id: "legacy-script", campaignId: "campaign-1", status: "approved" },
        scriptVersions: []
      }),
      campaignIntelligence: async () => hostedContext().campaignIntelligence
    },
    services: {
      generateLibTvUgcVideo: async () => ({ output: "assets/videos/legacy.mp4" })
    }
  });

  const result = await processor({
    projectName: "legacy-video",
    jobType: "generate-ugc-video",
    payload: { scriptVersionId: "legacy-queued-version" }
  });

  assert.equal(result.output, "assets/videos/legacy.mp4");
});
