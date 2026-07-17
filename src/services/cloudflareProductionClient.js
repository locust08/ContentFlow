import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const DEFAULT_MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;
const MIN_MULTIPART_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MULTIPART_CHUNK_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_MULTIPART_CHUNK_SIZE_BYTES = 60 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;

export function cloudflareProductionEnabled(env = process.env) {
  return Boolean(
    String(env?.CLOUDFLARE_WORKER_URL || "").trim()
    && String(env?.CONTENTFLOW_PRODUCTION_TOKEN || "").trim()
  );
}

export function createCloudflareProductionClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  multipartThresholdBytes = DEFAULT_MULTIPART_THRESHOLD_BYTES,
  multipartChunkSizeBytes = DEFAULT_MULTIPART_CHUNK_SIZE_BYTES,
  statImpl = fs.stat
} = {}) {
  if (!cloudflareProductionEnabled(env)) return null;
  if (!Number.isSafeInteger(multipartThresholdBytes) || multipartThresholdBytes < 0) {
    throw new TypeError("Multipart threshold must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(multipartChunkSizeBytes) || multipartChunkSizeBytes < MIN_MULTIPART_CHUNK_SIZE_BYTES || multipartChunkSizeBytes > MAX_MULTIPART_CHUNK_SIZE_BYTES) {
    throw new TypeError("Multipart chunk size must be between 5 MiB and 60 MiB.");
  }

  const baseUrl = String(env.CLOUDFLARE_WORKER_URL).trim().replace(/\/+$/, "");
  const token = String(env.CONTENTFLOW_PRODUCTION_TOKEN).trim();

  function projectAssetEndpoint(projectName, assetPath) {
    const encodedAssetPath = String(assetPath).split("/").map(encodeURIComponent).join("/");
    return `/internal/projects/${encodeURIComponent(projectName)}/assets/${encodedAssetPath}`;
  }

  function responseError(response) {
    const error = new Error(`Cloudflare production request failed (${response.status}).`);
    error.status = response.status;
    return error;
  }

  async function requestJson(pathname, { method = "GET", body, signal } = {}) {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      method,
      signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      throw responseError(response);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function updateJob(id, leaseToken, updates) {
    const result = await requestJson(`/internal/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { ...updates, leaseToken }
    });
    return result?.job ?? result;
  }

  async function downloadToPath(pathname, localPath, signal) {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      method: "GET",
      signal,
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw responseError(response);
    }
    if (!response.body) {
      throw new Error("Cloudflare production download returned no response body.");
    }
    const directory = path.dirname(localPath);
    const temporaryPath = path.join(directory, `.${path.basename(localPath)}.${randomUUID()}.part`);
    await fs.mkdir(directory, { recursive: true });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporaryPath, { flags: "wx" }),
        { signal }
      );
      signal?.throwIfAborted();
      await fs.rename(temporaryPath, localPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return localPath;
  }

  async function inspectMultipartFile(localPath, signal) {
    const hash = createHash("sha256");
    const parts = [];
    let sizeBytes = 0;
    for await (const chunk of createReadStream(localPath, { highWaterMark: multipartChunkSizeBytes, signal })) {
      if (parts.length >= MAX_MULTIPART_PARTS) {
        throw new RangeError("Cloudflare R2 supports at most 10,000 multipart parts.");
      }
      hash.update(chunk);
      sizeBytes += chunk.byteLength;
      parts.push({
        partNumber: parts.length + 1,
        sizeBytes: chunk.byteLength,
        md5: createHash("md5").update(chunk).digest("hex")
      });
    }
    return { checksum: hash.digest("hex"), parts, sizeBytes };
  }

  function normalizeEtag(etag) {
    const value = String(etag || "").trim();
    return value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).toLowerCase()
      : value.toLowerCase();
  }

  async function uploadMultipartProjectAsset({ projectName, assetPath, localPath, contentType, kind, sizeBytes, signal }) {
    const integrity = await inspectMultipartFile(localPath, signal);
    if (integrity.sizeBytes !== sizeBytes) {
      throw new Error("Cloudflare multipart integrity check failed because the file size changed during hashing.");
    }
    const { checksum } = integrity;
    const extension = String(assetPath).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
    const objectKey = `objects/sha256/${checksum}${extension ? `.${extension}` : ""}`;
    const started = await requestJson("/internal/r2/multipart/start", {
      method: "POST",
      body: { key: objectKey, contentType },
      signal
    });
    const uploadId = String(started?.uploadId || "");
    if (!uploadId) throw new Error("Cloudflare multipart upload did not return an upload ID.");

    const parts = [];
    try {
      let partNumber = 1;
      for await (const chunk of createReadStream(localPath, { highWaterMark: multipartChunkSizeBytes, signal })) {
        const expectedPart = integrity.parts[partNumber - 1];
        if (!expectedPart || chunk.byteLength !== expectedPart.sizeBytes) {
          throw new Error(`Cloudflare integrity check failed for multipart part ${partNumber}.`);
        }
        const query = new URLSearchParams({ key: objectKey, uploadId, partNumber: String(partNumber) });
        const response = await fetchImpl(`${baseUrl}/internal/r2/multipart/part?${query}`, {
          method: "PUT",
          signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream"
          },
          body: chunk
        });
        if (!response.ok) throw responseError(response);
        const uploadedPart = await response.json();
        if (!String(uploadedPart?.etag || "")) throw new Error(`Cloudflare multipart part ${partNumber} did not return an ETag.`);
        if (normalizeEtag(uploadedPart.etag) !== expectedPart.md5) {
          throw new Error(`Cloudflare integrity check failed for multipart part ${partNumber}.`);
        }
        parts.push({ partNumber, etag: String(uploadedPart.etag), sizeBytes: expectedPart.sizeBytes });
        partNumber += 1;
      }
      if (parts.length !== integrity.parts.length) {
        throw new Error(`Cloudflare multipart integrity check failed: expected ${integrity.parts.length} parts but uploaded ${parts.length}.`);
      }
      await requestJson("/internal/r2/multipart/complete", {
        method: "POST",
        body: { key: objectKey, uploadId, parts },
        signal
      });
    } catch (error) {
      await requestJson("/internal/r2/multipart/abort", {
        method: "DELETE",
        body: { key: objectKey, uploadId }
      }).catch(() => {});
      throw error;
    }

    const result = await requestJson(`/internal/projects/${encodeURIComponent(projectName)}/assets/register`, {
      method: "POST",
      body: { assetPath, objectKey, contentType, kind, sizeBytes, checksum },
      signal
    });
    return result?.asset ?? result;
  }

  return {
    async claimJob() {
      const result = await requestJson("/internal/jobs/claim", { method: "POST" });
      return result?.job ?? result;
    },
    getProjectContext(projectName, { signal } = {}) {
      return requestJson(`/internal/projects/${encodeURIComponent(projectName)}/context`, { signal });
    },
    updateJob,
    renewJobLease(id, leaseToken) {
      return updateJob(id, leaseToken, { status: "processing" });
    },
    completeJob(id, leaseToken, updates = {}) {
      return updateJob(id, leaseToken, { ...updates, status: "completed" });
    },
    failJob(id, leaseToken, error) {
      return updateJob(id, leaseToken, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error || "Production job failed.")
      });
    },
    async uploadProjectAsset({ projectName, assetPath, localPath, contentType = "application/octet-stream", kind = "output", signal }) {
      const { size } = await statImpl(localPath);
      if (size > multipartThresholdBytes) {
        if (Math.ceil(size / multipartChunkSizeBytes) > MAX_MULTIPART_PARTS) {
          throw new RangeError("Cloudflare R2 supports at most 10,000 multipart parts.");
        }
        return uploadMultipartProjectAsset({
          projectName,
          assetPath,
          localPath,
          contentType,
          kind,
          sizeBytes: size,
          signal
        });
      }
      const response = await fetchImpl(`${baseUrl}${projectAssetEndpoint(projectName, assetPath)}`, {
        method: "PUT",
        signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          "X-Asset-Kind": kind
        },
        body: await fs.readFile(localPath, { signal })
      });
      if (!response.ok) throw responseError(response);
      const result = await response.json();
      return result?.asset ?? result;
    },
    async downloadProjectAsset({ projectName, assetPath, localPath, signal }) {
      return downloadToPath(projectAssetEndpoint(projectName, assetPath), localPath, signal);
    },
    async downloadAsset({ assetId, localPath, signal }) {
      return downloadToPath(`/internal/assets/${encodeURIComponent(assetId)}`, localPath, signal);
    }
  };
}
