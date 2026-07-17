import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
  cloudflareProductionEnabled,
  createCloudflareProductionClient
} from "../src/services/cloudflareProductionClient.js";

const TEST_MULTIPART_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

function md5(bytes) {
  return createHash("md5").update(bytes).digest("hex");
}

function configuredClient(fetchImpl, options = {}) {
  return createCloudflareProductionClient({
    env: {
      CLOUDFLARE_WORKER_URL: "https://worker.example/",
      CONTENTFLOW_PRODUCTION_TOKEN: "production-secret"
    },
    fetchImpl,
    ...options
  });
}

test("enables the Cloudflare production client only when its URL and token are configured", () => {
  assert.ok(DEFAULT_MULTIPART_THRESHOLD_BYTES <= 50 * 1024 * 1024);
  assert.equal(cloudflareProductionEnabled({}), false);
  assert.equal(cloudflareProductionEnabled({ CLOUDFLARE_WORKER_URL: "https://worker.example" }), false);
  assert.equal(cloudflareProductionEnabled({ CONTENTFLOW_PRODUCTION_TOKEN: "secret" }), false);
  assert.equal(cloudflareProductionEnabled({
    CLOUDFLARE_WORKER_URL: " https://worker.example/ ",
    CONTENTFLOW_PRODUCTION_TOKEN: " secret "
  }), true);

  assert.equal(createCloudflareProductionClient({ env: {} }), null);
  assert.ok(createCloudflareProductionClient({
    env: {
      CLOUDFLARE_WORKER_URL: "https://worker.example",
      CONTENTFLOW_PRODUCTION_TOKEN: "secret"
    },
    fetchImpl: async () => new Response()
  }));
});

test("claims a job from the authenticated Worker endpoint without exposing the token", async () => {
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      job: { id: "job-1", leaseToken: "lease-1", status: "processing" }
    });
  });

  const job = await client.claimJob();

  assert.deepEqual(job, { id: "job-1", leaseToken: "lease-1", status: "processing" });
  assert.equal(requests[0].url, "https://worker.example/internal/jobs/claim");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer production-secret");
  assert.doesNotMatch(JSON.stringify(client), /production-secret/);
});

test("updates a claimed job with its lease token", async () => {
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ job: { id: "job/1", status: "processing", progress: 40 } });
  });

  const job = await client.updateJob("job/1", "lease-1", {
    status: "processing",
    progress: 40
  });

  assert.deepEqual(job, { id: "job/1", status: "processing", progress: 40 });
  assert.equal(requests[0].url, "https://worker.example/internal/jobs/job%2F1");
  assert.equal(requests[0].options.method, "PATCH");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    status: "processing",
    progress: 40,
    leaseToken: "lease-1"
  });
});

test("renews a claimed job lease as a processing update", async () => {
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ job: { id: "job-1", status: "processing" } });
  });

  await client.renewJobLease("job-1", "lease-1");

  assert.equal(requests[0].url, "https://worker.example/internal/jobs/job-1");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    status: "processing",
    leaseToken: "lease-1"
  });
});

test("exposes the HTTP status when a lease update is rejected", async () => {
  const client = configuredClient(async () => Response.json(
    { error: "Job lease is no longer valid" },
    { status: 409 }
  ));

  await assert.rejects(
    () => client.failJob("job-1", "lease-1", new Error("render failed")),
    (error) => error.status === 409
  );
});

test("completes a claimed job with result metadata", async () => {
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ job: { id: "job-1", status: "completed" } });
  });

  await client.completeJob("job-1", "lease-1", {
    outputUrl: "/media/assets/render-1",
    result: { output: "renders/final.mp4" }
  });

  assert.deepEqual(JSON.parse(requests[0].options.body), {
    outputUrl: "/media/assets/render-1",
    result: { output: "renders/final.mp4" },
    status: "completed",
    leaseToken: "lease-1"
  });
});

test("fails a claimed job with only the error message", async () => {
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ job: { id: "job-1", status: "failed" } });
  });
  const error = new Error("render failed");
  error.context = { token: "do-not-send" };

  await client.failJob("job-1", "lease-1", error);

  assert.deepEqual(JSON.parse(requests[0].options.body), {
    status: "failed",
    error: "render failed",
    leaseToken: "lease-1"
  });
});

test("uploads a local project asset to the Worker", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "final.mp4");
  await fs.writeFile(localPath, Buffer.from([1, 2, 3, 4]));

  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json({ asset: { id: "asset-1", url: "/media/assets/asset-1" } }, { status: 201 });
  });

  const asset = await client.uploadProjectAsset({
    projectName: "launch campaign",
    assetPath: "renders/final video.mp4",
    localPath,
    contentType: "video/mp4",
    kind: "render"
  });

  assert.deepEqual(asset, { id: "asset-1", url: "/media/assets/asset-1" });
  assert.equal(requests[0].url, "https://worker.example/internal/projects/launch%20campaign/assets/renders/final%20video.mp4");
  assert.equal(requests[0].options.method, "PUT");
  assert.equal(requests[0].options.headers.Authorization, "Bearer production-secret");
  assert.equal(requests[0].options.headers["Content-Type"], "video/mp4");
  assert.equal(requests[0].options.headers["X-Asset-Kind"], "render");
  assert.deepEqual(Buffer.from(requests[0].options.body), Buffer.from([1, 2, 3, 4]));
});

test("forwards a lease abort signal through project context and asset transfers", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.mp4");
  const downloadPath = path.join(directory, "download.mp4");
  await fs.writeFile(sourcePath, Buffer.from([1, 2, 3]));
  const controller = new AbortController();
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/context")) return Response.json({ project: { name: "alpha" }, assets: [] });
    if (options.method === "GET") return new Response(new Uint8Array([4, 5, 6]));
    return Response.json({ asset: { id: "asset-1", url: "/media/assets/asset-1" } }, { status: 201 });
  });

  await client.getProjectContext("alpha", { signal: controller.signal });
  await client.uploadProjectAsset({
    projectName: "alpha",
    assetPath: "renders/final.mp4",
    localPath: sourcePath,
    contentType: "video/mp4",
    kind: "final-render",
    signal: controller.signal
  });
  await client.downloadAsset({ assetId: "asset-1", localPath: downloadPath, signal: controller.signal });

  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.options.signal === controller.signal));
});

test("rejects multipart chunk sizes below the R2 minimum before making a network request", () => {
  let networkRequests = 0;

  assert.throws(() => configuredClient(async () => {
    networkRequests += 1;
    return Response.json({});
  }, {
    multipartChunkSizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES - 1
  }), /between 5 MiB and 60 MiB/);

  assert.equal(networkRequests, 0);
});

test("rejects files requiring more than 10,000 multipart parts before reading or uploading", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "too-many-parts.mp4");

  let networkRequests = 0;
  const client = configuredClient(async () => {
    networkRequests += 1;
    return Response.json({});
  }, {
    multipartThresholdBytes: 0,
    multipartChunkSizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES,
    statImpl: async () => ({ size: TEST_MULTIPART_CHUNK_SIZE_BYTES * 10_000 + 1 })
  });

  await assert.rejects(() => client.uploadProjectAsset({
    projectName: "alpha",
    assetPath: "renders/too-many-parts.mp4",
    localPath,
    contentType: "video/mp4",
    kind: "final-render"
  }), /10,000 multipart parts/);

  assert.equal(networkRequests, 0);
});

test("streams large project assets through ordered SHA-256 multipart requests before registration", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "final.mp4");
  const bytes = Buffer.alloc(TEST_MULTIPART_CHUNK_SIZE_BYTES * 2 + 7, 0x31);
  bytes.fill(0x32, TEST_MULTIPART_CHUNK_SIZE_BYTES, TEST_MULTIPART_CHUNK_SIZE_BYTES * 2);
  bytes.fill(0x33, TEST_MULTIPART_CHUNK_SIZE_BYTES * 2);
  await fs.writeFile(localPath, bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `objects/sha256/${checksum}.mp4`;

  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/internal/r2/multipart/start")) {
      return Response.json({ key: objectKey, uploadId: "upload-1" }, { status: 201 });
    }
    if (url.includes("/internal/r2/multipart/part?")) {
      const partNumber = Number(new URL(url).searchParams.get("partNumber"));
      return Response.json({ partNumber, etag: `\"${md5(options.body).toUpperCase()}\"` });
    }
    if (url.endsWith("/internal/r2/multipart/complete")) {
      return Response.json({ key: objectKey, size: bytes.length });
    }
    if (url.endsWith("/internal/projects/launch%20campaign/assets/register")) {
      return Response.json({ asset: { id: "asset-large", url: "/media/assets/asset-large" } }, { status: 201 });
    }
    return Response.json({ error: "large files must not use direct upload" }, { status: 413 });
  }, {
    multipartThresholdBytes: 4,
    multipartChunkSizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES
  });

  const asset = await client.uploadProjectAsset({
    projectName: "launch campaign",
    assetPath: "renders/final.mp4",
    localPath,
    contentType: "video/mp4",
    kind: "final-render"
  });

  assert.deepEqual(asset, { id: "asset-large", url: "/media/assets/asset-large" });
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/internal/r2/multipart/start",
    "/internal/r2/multipart/part",
    "/internal/r2/multipart/part",
    "/internal/r2/multipart/part",
    "/internal/r2/multipart/complete",
    "/internal/projects/launch%20campaign/assets/register"
  ]);
  assert.deepEqual(requests.slice(1, 4).map((request) => Buffer.from(request.options.body)), [
    bytes.subarray(0, TEST_MULTIPART_CHUNK_SIZE_BYTES),
    bytes.subarray(TEST_MULTIPART_CHUNK_SIZE_BYTES, TEST_MULTIPART_CHUNK_SIZE_BYTES * 2),
    bytes.subarray(TEST_MULTIPART_CHUNK_SIZE_BYTES * 2)
  ]);
  assert.deepEqual(requests.slice(1, 4).map((request) => Number(new URL(request.url).searchParams.get("partNumber"))), [1, 2, 3]);
  assert.deepEqual(JSON.parse(requests[4].options.body), {
    key: objectKey,
    uploadId: "upload-1",
    parts: [
      { partNumber: 1, etag: `\"${md5(bytes.subarray(0, TEST_MULTIPART_CHUNK_SIZE_BYTES)).toUpperCase()}\"`, sizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES },
      { partNumber: 2, etag: `\"${md5(bytes.subarray(TEST_MULTIPART_CHUNK_SIZE_BYTES, TEST_MULTIPART_CHUNK_SIZE_BYTES * 2)).toUpperCase()}\"`, sizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES },
      { partNumber: 3, etag: `\"${md5(bytes.subarray(TEST_MULTIPART_CHUNK_SIZE_BYTES * 2)).toUpperCase()}\"`, sizeBytes: 7 }
    ]
  });
  assert.deepEqual(JSON.parse(requests[5].options.body), {
    assetPath: "renders/final.mp4",
    objectKey,
    contentType: "video/mp4",
    kind: "final-render",
    sizeBytes: bytes.length,
    checksum
  });
  assert.ok(requests.every((request) => request.options.headers.Authorization === "Bearer production-secret"));
});

test("aborts a multipart upload when an ordered part request fails", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "failed.mp4");
  const bytes = Buffer.alloc(TEST_MULTIPART_CHUNK_SIZE_BYTES + 7, 0x41);
  bytes.fill(0x42, TEST_MULTIPART_CHUNK_SIZE_BYTES);
  await fs.writeFile(localPath, bytes);

  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/internal/r2/multipart/start")) return Response.json({ uploadId: "upload-fail" }, { status: 201 });
    if (url.includes("partNumber=1")) return Response.json({ partNumber: 1, etag: md5(options.body) });
    if (url.includes("partNumber=2")) return Response.json({ error: "R2 unavailable" }, { status: 503 });
    if (url.endsWith("/internal/r2/multipart/abort")) return Response.json({ ok: true });
    return Response.json({ error: "unexpected request" }, { status: 500 });
  }, {
    multipartThresholdBytes: 4,
    multipartChunkSizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES
  });

  await assert.rejects(() => client.uploadProjectAsset({
    projectName: "alpha",
    assetPath: "renders/failed.mp4",
    localPath,
    contentType: "video/mp4",
    kind: "final-render"
  }));

  assert.deepEqual(requests.map((request) => `${request.options.method} ${new URL(request.url).pathname}`), [
    "POST /internal/r2/multipart/start",
    "PUT /internal/r2/multipart/part",
    "PUT /internal/r2/multipart/part",
    "DELETE /internal/r2/multipart/abort"
  ]);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    key: `objects/sha256/${createHash("sha256").update(bytes).digest("hex")}.mp4`,
    uploadId: "upload-fail"
  });
});

test("aborts multipart upload when file content changes after the integrity pass", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "changed.mp4");
  const originalBytes = Buffer.alloc(TEST_MULTIPART_CHUNK_SIZE_BYTES + 7, 0x51);
  const changedBytes = Buffer.alloc(originalBytes.length, 0x52);
  await fs.writeFile(localPath, originalBytes);

  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/internal/r2/multipart/start")) {
      await fs.writeFile(localPath, changedBytes);
      return Response.json({ uploadId: "upload-changed" }, { status: 201 });
    }
    if (url.includes("/internal/r2/multipart/part?")) {
      const partNumber = Number(new URL(url).searchParams.get("partNumber"));
      return Response.json({ partNumber, etag: md5(options.body) });
    }
    if (url.endsWith("/internal/r2/multipart/abort")) return Response.json({ ok: true });
    if (url.endsWith("/internal/r2/multipart/complete")) return Response.json({ ok: true });
    if (url.includes("/assets/register")) return Response.json({ asset: { id: "must-not-register" } }, { status: 201 });
    return Response.json({ error: "unexpected request" }, { status: 500 });
  }, {
    multipartThresholdBytes: 4,
    multipartChunkSizeBytes: TEST_MULTIPART_CHUNK_SIZE_BYTES
  });

  await assert.rejects(() => client.uploadProjectAsset({
    projectName: "alpha",
    assetPath: "renders/changed.mp4",
    localPath,
    contentType: "video/mp4",
    kind: "final-render"
  }), /integrity check failed for multipart part 1/i);

  assert.deepEqual(requests.map((request) => `${request.options.method} ${new URL(request.url).pathname}`), [
    "POST /internal/r2/multipart/start",
    "PUT /internal/r2/multipart/part",
    "DELETE /internal/r2/multipart/abort"
  ]);
});

test("downloads a Worker project asset to a local path", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "reference", "reference.mp4");

  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return new Response(new Uint8Array([5, 6, 7]), {
      headers: { "content-type": "video/mp4" }
    });
  });

  const downloadedPath = await client.downloadProjectAsset({
    projectName: "launch campaign",
    assetPath: "reference/reference.mp4",
    localPath
  });

  assert.equal(downloadedPath, localPath);
  assert.equal(requests[0].url, "https://worker.example/internal/projects/launch%20campaign/assets/reference/reference.mp4");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.Authorization, "Bearer production-secret");
  assert.deepEqual(await fs.readFile(localPath), Buffer.from([5, 6, 7]));
});

test("streams downloads to an atomic temporary file without buffering the full response", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "reference", "reference.mp4");
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, Buffer.from([9, 9, 9]));
  const chunks = [Buffer.from([1, 2]), Buffer.from([3, 4]), Buffer.from([5])];

  const client = configuredClient(async () => {
    const response = new Response(new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      }
    }));
    response.arrayBuffer = async () => {
      throw new Error("download must not call arrayBuffer");
    };
    return response;
  });

  assert.equal(await client.downloadAsset({ assetId: "asset-1", localPath }), localPath);
  assert.deepEqual(await fs.readFile(localPath), Buffer.from([1, 2, 3, 4, 5]));
  assert.deepEqual(await fs.readdir(path.dirname(localPath)), ["reference.mp4"]);
});

test("keeps the previous file and removes temporary output when a download stream fails", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "source.mp4");
  const previousBytes = Buffer.from([7, 7, 7]);
  await fs.writeFile(localPath, previousBytes);

  let pulls = 0;
  let observedAtomicStaging = false;
  const client = configuredClient(async () => new Response(new ReadableStream({
    async pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(new Uint8Array(256 * 1024));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      const entries = await fs.readdir(directory);
      observedAtomicStaging = entries.some((entry) => entry !== "source.mp4");
      controller.error(new Error("connection interrupted"));
    }
  })));

  await assert.rejects(
    () => client.downloadAsset({ assetId: "asset-1", localPath }),
    /connection interrupted/
  );
  assert.equal(observedAtomicStaging, true);
  assert.deepEqual(await fs.readFile(localPath), previousBytes);
  assert.deepEqual(await fs.readdir(directory), ["source.mp4"]);
});

test("aborting a download cancels its response stream and preserves the previous file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "source.mp4");
  const previousBytes = Buffer.from([8, 8, 8]);
  await fs.writeFile(localPath, previousBytes);
  const controller = new AbortController();
  let cancelled = false;
  let pulls = 0;

  const client = configuredClient(async () => new Response(new ReadableStream({
    pull(streamController) {
      pulls += 1;
      if (pulls === 1) {
        streamController.enqueue(new Uint8Array([1, 2, 3]));
        return;
      }
      controller.abort(new DOMException("lease lost", "AbortError"));
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    }
  })));

  const outcome = await Promise.race([
    client.downloadAsset({ assetId: "asset-1", localPath, signal: controller.signal })
      .then(() => null, (error) => error),
    new Promise((resolve) => setTimeout(() => resolve(new Error("download did not abort")), 200))
  ]);

  assert.equal(outcome?.name, "AbortError");
  assert.equal(cancelled, true);
  assert.deepEqual(await fs.readFile(localPath), previousBytes);
  assert.deepEqual(await fs.readdir(directory), ["source.mp4"]);
});

test("retrieves the protected D1 project context", async () => {
  const requests = [];
  const expected = {
    project: { name: "launch/campaign" },
    assets: [{ id: "asset-1", kind: "reference-video" }],
    campaignIntelligence: { marketReport: { id: "report-1" } },
    scriptBundle: { ugcScript: { id: "script-1" } }
  };
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return Response.json(expected);
  });

  assert.deepEqual(await client.getProjectContext("launch/campaign"), expected);
  assert.equal(requests[0].url, "https://worker.example/internal/projects/launch%2Fcampaign/context");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.Authorization, "Bearer production-secret");
});

test("downloads a protected R2 object by its D1 asset ID", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-cloudflare-client-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "product", "phone.png");
  const requests = [];
  const client = configuredClient(async (url, options) => {
    requests.push({ url, options });
    return new Response(new Uint8Array([8, 9, 10]), { headers: { "content-type": "image/png" } });
  });

  assert.equal(await client.downloadAsset({ assetId: "asset/1", localPath }), localPath);
  assert.equal(requests[0].url, "https://worker.example/internal/assets/asset%2F1");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.Authorization, "Bearer production-secret");
  assert.deepEqual(await fs.readFile(localPath), Buffer.from([8, 9, 10]));
});
