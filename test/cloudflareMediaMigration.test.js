import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inferAssetKind, migrateLocalMedia, planMediaFiles, resolveWranglerBindings, uploadObjectMultipart } from "../scripts/cloudflare/migrateLocalMedia.js";

async function createSmallMigrationFixture(prefix = "contentflow-r2-small-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const projectsDir = path.join(root, "projects");
  const mediaPath = path.join(projectsDir, "alpha", "reference", "reference.mp4");
  const wranglerPath = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const argsPath = path.join(root, "wrangler-args.json");
  await fs.mkdir(path.dirname(mediaPath), { recursive: true });
  await fs.mkdir(path.dirname(wranglerPath), { recursive: true });
  await fs.writeFile(mediaPath, "small-video");
  await fs.writeFile(path.join(root, ".env"), "");
  await fs.writeFile(wranglerPath, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`);
  return { root, projectsDir, mediaPath, argsPath };
}

function migrationQuery(projectName = "alpha", onProjectQuery = null) {
  return async (_config, batch) => {
    if (/SELECT name FROM cf_projects/i.test(batch[0].sql)) {
      await onProjectQuery?.();
      return [{ results: [{ name: projectName }] }];
    }
    return batch.map(() => ({ results: [] }));
  };
}

test("production media migration resolves top-level D1 and R2 bindings", () => {
  const config = {
    d1_databases: [{ binding: "DB", database_id: "production-db" }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: "production-media" }],
    env: {
      preview: {
        d1_databases: [{ binding: "DB", database_id: "preview-db" }],
        r2_buckets: [{ binding: "MEDIA", bucket_name: "preview-media" }]
      }
    }
  };

  assert.deepEqual(resolveWranglerBindings(config, "production"), {
    databaseId: "production-db",
    bucket: "production-media"
  });
  assert.deepEqual(resolveWranglerBindings(config, "preview"), {
    databaseId: "preview-db",
    bucket: "preview-media"
  });
});

test("production small-file upload uses top-level Wrangler bindings without a production env flag", async () => {
  const fixture = await createSmallMigrationFixture("contentflow-r2-production-args-");
  try {
    await migrateLocalMedia({
      cwd: fixture.root,
      environment: "production",
      envFile: path.join(fixture.root, ".env"),
      bucket: "production-media",
      projectsDir: fixture.projectsDir,
      stateFile: path.join(fixture.root, "checkpoint.json"),
      d1QueryImpl: migrationQuery()
    });

    const args = JSON.parse(await fs.readFile(fixture.argsPath, "utf8"));
    assert.equal(args.includes("--env"), false);
    assert.equal(args.includes("production"), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("preview small-file upload keeps the Wrangler preview env flag", async () => {
  const fixture = await createSmallMigrationFixture("contentflow-r2-preview-args-");
  try {
    await migrateLocalMedia({
      cwd: fixture.root,
      environment: "preview",
      envFile: path.join(fixture.root, ".env"),
      bucket: "preview-media",
      projectsDir: fixture.projectsDir,
      stateFile: path.join(fixture.root, "checkpoint.json"),
      d1QueryImpl: migrationQuery()
    });

    const args = JSON.parse(await fs.readFile(fixture.argsPath, "utf8"));
    const envIndex = args.indexOf("--env");
    assert.notEqual(envIndex, -1);
    assert.equal(args[envIndex + 1], "preview");
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("small-file upload rejects bytes changed after planning before invoking Wrangler", async () => {
  const fixture = await createSmallMigrationFixture("contentflow-r2-small-integrity-");
  try {
    await assert.rejects(migrateLocalMedia({
      cwd: fixture.root,
      environment: "preview",
      envFile: path.join(fixture.root, ".env"),
      bucket: "preview-media",
      projectsDir: fixture.projectsDir,
      stateFile: path.join(fixture.root, "checkpoint.json"),
      d1QueryImpl: migrationQuery("alpha", () => fs.writeFile(fixture.mediaPath, "mutated-video"))
    }), /integrity.*changed|checksum/i);

    await assert.rejects(fs.access(fixture.argsPath));
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("initial checkpoint metadata resumes a verified upload before D1 asset rows exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-initial-resume-"));
  const projectsDir = path.join(root, "projects");
  const mediaPath = path.join(projectsDir, "alpha", "reference", "reference.mp4");
  const stateFile = path.join(root, "checkpoint.json");
  const uploads = [];
  const queries = [];
  const heads = [];
  try {
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, "already-uploaded");
    const object = (await planMediaFiles(projectsDir)).objects[0];
    await fs.writeFile(stateFile, JSON.stringify({
      objects: {
        [object.objectKey]: {
          sizeBytes: object.sizeBytes,
          checksum: object.checksum,
          contentType: object.contentType
        }
      }
    }));

    await migrateLocalMedia({
      projectsDir,
      stateFile,
      workerUrl: "https://worker.example",
      productionToken: "internal-test-token",
      fetchImpl: async (url, options) => {
        heads.push({ url: String(url), method: options?.method });
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(object.sizeBytes), "content-type": object.contentType }
        });
      },
      d1QueryImpl: async (_config, batch) => {
        queries.push(...batch.map(({ sql }) => sql));
        if (/SELECT name FROM cf_projects/i.test(batch[0].sql)) return [{ results: [{ name: "alpha" }] }];
        return batch.map(() => ({ results: [] }));
      },
      uploadObjectImpl: async (_config, candidate) => uploads.push(candidate.objectKey)
    });

    assert.deepEqual(uploads, []);
    assert.equal(heads.length, 1);
    assert.match(heads[0].url, /\/internal\/r2\/object\?key=/);
    assert.equal(heads[0].method, "HEAD");
    assert.equal(queries.some((sql) => /FROM cf_assets WHERE object_key/i.test(sql)), false);
    assert.equal(queries.some((sql) => /INSERT INTO cf_assets/i.test(sql)), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("matching checkpoint metadata reuploads when the R2 object is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-missing-checkpoint-"));
  const projectsDir = path.join(root, "projects");
  const mediaPath = path.join(projectsDir, "alpha", "reference", "reference.mp4");
  const stateFile = path.join(root, "checkpoint.json");
  const uploads = [];
  try {
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, "missing-remotely");
    const object = (await planMediaFiles(projectsDir)).objects[0];
    await fs.writeFile(stateFile, JSON.stringify({ objects: { [object.objectKey]: {
      sizeBytes: object.sizeBytes,
      checksum: object.checksum,
      contentType: object.contentType
    } } }));

    await migrateLocalMedia({
      projectsDir,
      stateFile,
      workerUrl: "https://worker.example",
      productionToken: "internal-test-token",
      fetchImpl: async () => new Response(null, { status: 404 }),
      d1QueryImpl: migrationQuery(),
      uploadObjectImpl: async (_config, candidate) => uploads.push(candidate.objectKey)
    });

    assert.deepEqual(uploads, [object.objectKey]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("successful upload records integrity metadata that resumes before D1 asset reconciliation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-checkpoint-recording-"));
  const projectsDir = path.join(root, "projects");
  const mediaPath = path.join(projectsDir, "alpha", "reference", "reference.mp4");
  const stateFile = path.join(root, "checkpoint.json");
  let uploads = 0;
  try {
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, "checkpoint-me");
    const object = (await planMediaFiles(projectsDir)).objects[0];
    const config = {
      projectsDir,
      stateFile,
      d1QueryImpl: migrationQuery(),
      verifyObjectImpl: async () => true,
      uploadObjectImpl: async () => { uploads += 1; }
    };

    await migrateLocalMedia(config);
    const checkpoint = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.deepEqual(checkpoint.objects[object.objectKey], {
      sizeBytes: object.sizeBytes,
      checksum: object.checksum,
      contentType: object.contentType
    });

    await migrateLocalMedia(config);
    assert.equal(uploads, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("infers existing ContentFlow asset kinds from project-relative paths", () => {
  assert.equal(inferAssetKind("reference/reference.mp4"), "reference-video");
  assert.equal(inferAssetKind("product/product-image.png"), "product-image");
  assert.equal(inferAssetKind("character/character-reference.webp"), "character-reference");
  assert.equal(inferAssetKind("clipper/source/source-video.mp4"), "clipper-source");
  assert.equal(inferAssetKind("clipper/reaction/person.mp4"), "reaction-character");
  assert.equal(inferAssetKind("renders/clips/clip-01.mp4"), "final-render");
});

test("media planning deduplicates identical bytes while retaining per-project asset rows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-"));
  try {
    await fs.mkdir(path.join(root, "alpha", "reference"), { recursive: true });
    await fs.mkdir(path.join(root, "beta", "reference"), { recursive: true });
    await fs.writeFile(path.join(root, "alpha", "reference", "reference.mp4"), "same-video");
    await fs.writeFile(path.join(root, "beta", "reference", "reference.mp4"), "same-video");

    const plan = await planMediaFiles(root);

    assert.equal(plan.files.length, 2);
    assert.equal(plan.objects.length, 1);
    assert.equal(plan.files[0].objectKey, plan.files[1].objectKey);
    assert.notEqual(plan.files[0].assetId, plan.files[1].assetId);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("stale checkpoint entries are remotely inspected and reuploaded when R2 metadata differs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-checkpoint-"));
  const stateFile = path.join(root, "checkpoint.json");
  const projectsDir = path.join(root, "projects");
  const mediaPath = path.join(projectsDir, "alpha", "reference", "reference.mp4");
  const headRequests = [];
  const uploads = [];
  const originalFetch = globalThis.fetch;
  try {
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, "current-video-bytes");
    const planned = await planMediaFiles(projectsDir);
    const object = planned.objects[0];
    await fs.writeFile(stateFile, JSON.stringify({ uploaded: [object.objectKey] }));

    const d1QueryImpl = async (_config, batch) => {
      if (/SELECT name FROM cf_projects/i.test(batch[0].sql)) return [{ results: [{ name: "alpha" }] }];
      if (/FROM cf_assets/i.test(batch[0].sql)) {
        return [{ results: [{
          id: "asset-1",
          object_key: object.objectKey,
          size_bytes: object.sizeBytes,
          checksum: object.checksum,
          media_type: object.contentType
        }] }];
      }
      return batch.map(() => ({ results: [] }));
    };
    globalThis.fetch = async (_url, init) => Response.json({
      success: true,
      result: await d1QueryImpl({}, JSON.parse(init.body).batch)
    });

    await migrateLocalMedia({
      projectsDir,
      stateFile,
      workerUrl: "https://worker.example",
      productionToken: "secret",
      d1QueryImpl,
      uploadObjectImpl: async (_config, candidate) => uploads.push(candidate.objectKey),
      fetchImpl: async (url, init) => {
        headRequests.push({ url: String(url), method: init.method });
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(object.sizeBytes - 1), "content-type": object.contentType }
        });
      }
    });

    assert.deepEqual(headRequests, [{
      url: "https://worker.example/internal/assets/asset-1",
      method: "HEAD"
    }]);
    assert.deepEqual(uploads, [object.objectKey]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("large media uploads are split into ordered multipart requests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-multipart-"));
  const filePath = path.join(root, "large.mp4");
  const requests = [];
  try {
    await fs.writeFile(filePath, Buffer.from("0123456789"));
    const fetchImpl = async (url, init) => {
      requests.push({ url: String(url), method: init.method, body: init.body });
      if (String(url).endsWith("/start")) return new Response(JSON.stringify({ uploadId: "upload-1" }), { status: 201 });
      if (String(url).includes("/part?")) {
        const partNumber = Number(new URL(url).searchParams.get("partNumber"));
        const etag = crypto.createHash("md5").update(Buffer.from(init.body)).digest("hex");
        return new Response(JSON.stringify({ partNumber, etag: `\"${etag.toUpperCase()}\"` }), { status: 200 });
      }
      if (String(url).endsWith("/complete")) return new Response(JSON.stringify({ key: "stored" }), { status: 200 });
      return new Response("not found", { status: 404 });
    };

    await uploadObjectMultipart({
      workerUrl: "https://worker.example",
      productionToken: "secret"
    }, {
      filePath,
      checksum: crypto.createHash("sha256").update("0123456789").digest("hex"),
      sizeBytes: 10,
      objectKey: `objects/sha256/${crypto.createHash("sha256").update("0123456789").digest("hex")}.mp4`,
      contentType: "video/mp4"
    }, { fetchImpl, chunkSize: 4 });

    const partRequests = requests.filter((request) => request.url.includes("/part?"));
    assert.equal(partRequests.length, 3);
    assert.deepEqual(partRequests.map((request) => Buffer.from(request.body).toString()), ["0123", "4567", "89"]);
    const completed = JSON.parse(requests.find((request) => request.url.endsWith("/complete")).body);
    assert.deepEqual(completed.parts.map(({ partNumber }) => partNumber), [1, 2, 3]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("multipart migration rejects a file changed after planning before starting an upload", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-preflight-integrity-"));
  const filePath = path.join(root, "large.mp4");
  let requests = 0;
  try {
    await fs.writeFile(filePath, "original");
    const checksum = crypto.createHash("sha256").update("original").digest("hex");
    await fs.writeFile(filePath, "modified");

    await assert.rejects(uploadObjectMultipart({
      workerUrl: "https://worker.example",
      productionToken: "secret"
    }, {
      filePath,
      checksum,
      sizeBytes: 8,
      objectKey: `objects/sha256/${checksum}.mp4`,
      contentType: "video/mp4"
    }, {
      chunkSize: 4,
      fetchImpl: async () => {
        requests += 1;
        return new Response("unexpected", { status: 500 });
      }
    }), /integrity.*changed|checksum/i);

    assert.equal(requests, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("multipart migration aborts when uploaded part bytes differ from inspected bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-part-integrity-"));
  const filePath = path.join(root, "large.mp4");
  const requests = [];
  try {
    await fs.writeFile(filePath, "abcdefgh");
    const checksum = crypto.createHash("sha256").update("abcdefgh").digest("hex");
    const fetchImpl = async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      if (String(url).endsWith("/start")) {
        await fs.writeFile(filePath, "abcdWXYZ");
        return Response.json({ uploadId: "upload-1" }, { status: 201 });
      }
      if (String(url).includes("/part?")) {
        const partNumber = Number(new URL(url).searchParams.get("partNumber"));
        const etag = crypto.createHash("md5").update(Buffer.from(init.body)).digest("hex");
        return Response.json({ partNumber, etag });
      }
      if (String(url).endsWith("/abort")) return new Response(null, { status: 204 });
      if (String(url).endsWith("/complete")) return Response.json({ key: "unexpected" });
      return new Response("not found", { status: 404 });
    };

    await assert.rejects(uploadObjectMultipart({
      workerUrl: "https://worker.example",
      productionToken: "secret"
    }, {
      filePath,
      checksum,
      sizeBytes: 8,
      objectKey: `objects/sha256/${checksum}.mp4`,
      contentType: "video/mp4"
    }, { fetchImpl, chunkSize: 4 }), /integrity.*part 2/i);

    assert.ok(requests.some((request) => request.url.endsWith("/abort")));
    assert.equal(requests.some((request) => request.url.endsWith("/complete")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("multipart migration rejects an R2 ETag that does not match the uploaded part MD5", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-r2-etag-integrity-"));
  const filePath = path.join(root, "large.mp4");
  const requests = [];
  try {
    await fs.writeFile(filePath, "abcdefgh");
    const checksum = crypto.createHash("sha256").update("abcdefgh").digest("hex");
    const fetchImpl = async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      if (String(url).endsWith("/start")) return Response.json({ uploadId: "upload-1" }, { status: 201 });
      if (String(url).includes("/part?")) {
        const partNumber = Number(new URL(url).searchParams.get("partNumber"));
        return Response.json({ partNumber, etag: "not-the-md5" });
      }
      if (String(url).endsWith("/abort")) return new Response(null, { status: 204 });
      return new Response("not found", { status: 404 });
    };

    await assert.rejects(uploadObjectMultipart({
      workerUrl: "https://worker.example",
      productionToken: "secret"
    }, {
      filePath,
      checksum,
      sizeBytes: 8,
      objectKey: `objects/sha256/${checksum}.mp4`,
      contentType: "video/mp4"
    }, { fetchImpl, chunkSize: 4 }), /integrity.*part 1/i);

    assert.ok(requests.some((request) => request.url.endsWith("/abort")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
