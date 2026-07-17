import assert from "node:assert/strict";
import test from "node:test";

import { createMediaStore } from "../cloudflare/worker/media.js";

test("reads R2 object metadata without fetching its body", async () => {
  const calls = [];
  const bucket = {
    head: async (key) => {
      calls.push(key);
      return key === "objects/sha256/present.mp4" ? {
        size: 42,
        httpMetadata: { contentType: "video/mp4" },
        httpEtag: "etag-42"
      } : null;
    }
  };
  const media = createMediaStore(bucket);

  assert.deepEqual(await media.head("objects/sha256/present.mp4"), {
    size: 42,
    contentType: "video/mp4",
    etag: "etag-42"
  });
  assert.equal(await media.head("objects/sha256/missing.mp4"), null);
  assert.deepEqual(calls, ["objects/sha256/present.mp4", "objects/sha256/missing.mp4"]);
});
