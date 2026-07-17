import assert from "node:assert/strict";
import test from "node:test";

import { createMediaStore } from "../cloudflare/worker/media.js";

function bucketFixture() {
  const calls = [];
  return {
    calls,
    bucket: {
      head: async () => ({ size: 10, httpMetadata: { contentType: "video/mp4" }, etag: "etag" }),
      get: async (_key, options) => {
        calls.push(options);
        const length = options?.range?.length ?? 10;
        return {
          body: new Uint8Array(length),
          size: 10,
          httpMetadata: { contentType: "video/mp4" },
          etag: "etag"
        };
      }
    }
  };
}

test("suffix byte ranges return the final bytes of an R2 object", async () => {
  const { bucket, calls } = bucketFixture();
  const media = createMediaStore(bucket);

  const result = await media.get("video.mp4", { range: "bytes=-3" });

  assert.deepEqual(calls[0].range, { offset: 7, length: 3 });
  assert.equal(result.contentRange, "bytes 7-9/10");
  assert.equal(result.size, 3);
});

test("unsatisfiable byte ranges are rejected without reading the object body", async () => {
  const { bucket, calls } = bucketFixture();
  const media = createMediaStore(bucket);

  const result = await media.get("video.mp4", { range: "bytes=20-30" });

  assert.deepEqual(result, { rangeNotSatisfiable: true, totalSize: 10 });
  assert.equal(calls.length, 0);
});
