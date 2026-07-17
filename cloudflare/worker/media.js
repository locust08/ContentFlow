function parseRange(value, size) {
  if (!String(value || "").trim()) return null;
  const match = String(value || "").match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || !size || (!match[1] && !match[2])) return { invalid: true };
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    const length = Math.min(suffixLength, size);
    const start = size - length;
    return { offset: start, length, start, end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return { invalid: true };
  return { offset: start, length: end - start + 1, start, end };
}

export function createMediaStore(bucket) {
  return {
    async head(key) {
      const object = await bucket.head(key);
      if (!object) return null;
      return {
        size: object.size,
        contentType: object.httpMetadata?.contentType || "application/octet-stream",
        etag: object.httpEtag || object.etag
      };
    },
    async put(key, bytes, metadata = {}) {
      await bucket.put(key, bytes, {
        httpMetadata: { contentType: metadata.contentType || "application/octet-stream" },
        customMetadata: { projectName: metadata.projectName || "", kind: metadata.kind || "" }
      });
      return { key, size: bytes.byteLength };
    },
    async get(key, options = {}) {
      let object = await bucket.head(key);
      if (!object) return null;
      const range = parseRange(options.range, object.size);
      if (range?.invalid) return { rangeNotSatisfiable: true, totalSize: object.size };
      object = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
      if (!object) return null;
      return {
        body: object.body,
        size: range?.length ?? object.size,
        contentType: object.httpMetadata?.contentType || "application/octet-stream",
        etag: object.httpEtag || object.etag,
        contentRange: range ? `bytes ${range.start}-${range.end}/${object.size}` : ""
      };
    },
    async createMultipart(key, metadata = {}) {
      const upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: metadata.contentType || "application/octet-stream" }
      });
      return { key: upload.key, uploadId: upload.uploadId };
    },
    async uploadPart(key, uploadId, partNumber, bytes) {
      const upload = bucket.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, bytes);
      return { partNumber: part.partNumber, etag: part.etag };
    },
    async completeMultipart(key, uploadId, parts) {
      const upload = bucket.resumeMultipartUpload(key, uploadId);
      const object = await upload.complete(parts.map((part) => ({ partNumber: Number(part.partNumber), etag: part.etag })));
      return { key: object.key, etag: object.httpEtag || object.etag, size: object.size };
    },
    async abortMultipart(key, uploadId) {
      await bucket.resumeMultipartUpload(key, uploadId).abort();
      return { ok: true };
    }
  };
}
