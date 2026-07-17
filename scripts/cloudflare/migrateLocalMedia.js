import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mediaExtensions = new Set([".mp4", ".webm", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".wav", ".mp3"]);
const wranglerUploadLimit = 300 * 1024 * 1024;
const defaultMultipartChunkSize = 50 * 1024 * 1024;
const mimeTypes = new Map([
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".mov", "video/quicktime"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
  [".wav", "audio/wav"], [".mp3", "audio/mpeg"]
]);

function slash(value) {
  return String(value || "").replace(/\\/g, "/");
}

export function inferAssetKind(relativePath) {
  const value = slash(relativePath).toLowerCase();
  if (value === "reference/reference.mp4" || value.startsWith("reference/")) return "reference-video";
  if (value.startsWith("product/")) return "product-image";
  if (value.startsWith("character/")) return "character-reference";
  if (value.startsWith("clipper/source/")) return "clipper-source";
  if (value.startsWith("clipper/reaction/")) return "reaction-character";
  if (value.startsWith("renders/")) return "final-render";
  if (/\.(png|jpe?g|webp)$/.test(value)) return "generated-image";
  if (/\.(wav|mp3)$/.test(value)) return "generated-audio";
  return "generated-video";
}

async function walk(directory) {
  const files = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (mediaExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function planMediaFiles(projectsDir) {
  const discovered = await walk(projectsDir);
  const files = [];
  const objects = new Map();
  for (const filePath of discovered.sort()) {
    const relative = path.relative(projectsDir, filePath);
    const segments = relative.split(path.sep);
    if (segments.length < 2) continue;
    const projectName = segments.shift();
    const projectRelativePath = slash(segments.join(path.sep));
    const extension = path.extname(filePath).toLowerCase();
    const checksum = await hashFile(filePath);
    const objectKey = `objects/sha256/${checksum}${extension}`;
    const stat = await fsp.stat(filePath);
    const assetId = `r2-${crypto.createHash("sha256").update(`${projectName}\0${projectRelativePath}`).digest("hex").slice(0, 32)}`;
    const item = {
      assetId,
      projectName,
      relativePath: projectRelativePath,
      filePath,
      kind: inferAssetKind(projectRelativePath),
      contentType: mimeTypes.get(extension) || "application/octet-stream",
      sizeBytes: stat.size,
      checksum,
      objectKey,
      createdAt: stat.mtime.toISOString()
    };
    files.push(item);
    if (!objects.has(objectKey)) objects.set(objectKey, item);
  }
  return { files, objects: [...objects.values()] };
}

function parseEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) result[key] = true;
    else result[key] = argv[++index];
  }
  return result;
}

export function resolveWranglerBindings(config, environment) {
  const environmentConfig = environment === "production"
    ? config
    : config.env?.[environment];
  return {
    databaseId: environmentConfig?.d1_databases?.find((item) => item.binding === "DB")?.database_id || "",
    bucket: environmentConfig?.r2_buckets?.find((item) => item.binding === "MEDIA")?.bucket_name || ""
  };
}

async function d1Query(config, batch) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({ batch })
  });
  const result = await response.json();
  if (!response.ok || !result.success || result.result?.some((entry) => entry.success === false)) {
    throw new Error(result.errors?.[0]?.message || `D1 request failed (${response.status})`);
  }
  return result.result;
}

function loadState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { uploaded: [], objects: {} };
  }
}

function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

async function responseError(response, operation) {
  const detail = await response.text().catch(() => "");
  return new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

async function inspectMultipartFile(filePath, chunkSize) {
  const hash = crypto.createHash("sha256");
  const parts = [];
  let sizeBytes = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: chunkSize })) {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
    parts.push({
      partNumber: parts.length + 1,
      sizeBytes: chunk.byteLength,
      md5: crypto.createHash("md5").update(chunk).digest("hex")
    });
  }
  return { checksum: hash.digest("hex"), parts, sizeBytes };
}

async function verifyPlannedObject(object) {
  const stat = await fsp.stat(object.filePath);
  const checksum = await hashFile(object.filePath);
  const keyChecksum = String(object.objectKey || "").match(/^objects\/sha256\/([a-f0-9]{64})(?:\.|$)/i)?.[1]?.toLowerCase();
  if (stat.size !== object.sizeBytes || checksum !== object.checksum || keyChecksum !== checksum) {
    throw new Error("Upload integrity check failed because the file changed after migration planning");
  }
}

function normalizeEtag(value) {
  const etag = String(value || "").trim();
  return etag.startsWith('"') && etag.endsWith('"')
    ? etag.slice(1, -1).toLowerCase()
    : etag.toLowerCase();
}

export async function uploadObjectMultipart(config, object, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const chunkSize = Number(options.chunkSize || defaultMultipartChunkSize);
  if (!config.workerUrl || !config.productionToken) {
    throw new Error("CLOUDFLARE_WORKER_URL and CONTENTFLOW_PRODUCTION_TOKEN are required for files larger than 300 MiB");
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 60 * 1024 * 1024) {
    throw new Error("Multipart chunk size must be between 1 byte and 60 MiB");
  }

  const integrity = await inspectMultipartFile(object.filePath, chunkSize);
  if (integrity.sizeBytes !== object.sizeBytes || integrity.checksum !== object.checksum) {
    throw new Error("Multipart integrity check failed because the file changed after migration planning");
  }
  const keyChecksum = String(object.objectKey || "").match(/^objects\/sha256\/([a-f0-9]{64})(?:\.|$)/i)?.[1]?.toLowerCase();
  if (!keyChecksum || keyChecksum !== integrity.checksum) {
    throw new Error("Multipart integrity check failed because the object key checksum does not match the file");
  }

  const baseUrl = String(config.workerUrl).replace(/\/$/, "");
  const headers = { authorization: `Bearer ${config.productionToken}` };
  let uploadId = "";
  try {
    const start = await fetchImpl(`${baseUrl}/internal/r2/multipart/start`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ key: object.objectKey, contentType: object.contentType })
    });
    if (!start.ok) throw await responseError(start, "Multipart start");
    uploadId = String((await start.json()).uploadId || "");
    if (!uploadId) throw new Error("Multipart start did not return an upload ID");

    const file = await fsp.open(object.filePath, "r");
    const parts = [];
    try {
      let position = 0;
      let partNumber = 1;
      while (position < integrity.sizeBytes) {
        const expectedPart = integrity.parts[partNumber - 1];
        if (!expectedPart) throw new Error(`Multipart integrity check failed for part ${partNumber}`);
        const length = expectedPart.sizeBytes;
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(buffer, 0, length, position);
        const bytes = buffer.subarray(0, bytesRead);
        const currentMd5 = crypto.createHash("md5").update(bytes).digest("hex");
        if (bytesRead !== expectedPart.sizeBytes || currentMd5 !== expectedPart.md5) {
          throw new Error(`Multipart integrity check failed for part ${partNumber}`);
        }
        const url = new URL(`${baseUrl}/internal/r2/multipart/part`);
        url.searchParams.set("key", object.objectKey);
        url.searchParams.set("uploadId", uploadId);
        url.searchParams.set("partNumber", String(partNumber));
        const response = await fetchImpl(url, {
          method: "PUT",
          headers: { ...headers, "content-type": "application/octet-stream" },
          body: bytes
        });
        if (!response.ok) throw await responseError(response, `Multipart part ${partNumber}`);
        const uploadedPart = await response.json();
        if (Number(uploadedPart.partNumber) !== partNumber || normalizeEtag(uploadedPart.etag) !== expectedPart.md5) {
          throw new Error(`Multipart integrity check failed for part ${partNumber}`);
        }
        parts.push({ partNumber, etag: uploadedPart.etag, sizeBytes: expectedPart.sizeBytes });
        position += bytesRead;
        partNumber += 1;
      }
      if (parts.length !== integrity.parts.length) {
        throw new Error(`Multipart integrity check failed: expected ${integrity.parts.length} parts but uploaded ${parts.length}`);
      }
    } finally {
      await file.close();
    }

    const complete = await fetchImpl(`${baseUrl}/internal/r2/multipart/complete`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ key: object.objectKey, uploadId, parts })
    });
    if (!complete.ok) throw await responseError(complete, "Multipart completion");
    return complete.json();
  } catch (error) {
    if (uploadId) {
      await fetchImpl(`${baseUrl}/internal/r2/multipart/abort`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ key: object.objectKey, uploadId })
      }).catch(() => null);
    }
    throw error;
  }
}

async function uploadObject(config, object) {
  if (object.sizeBytes > wranglerUploadLimit) {
    return uploadObjectMultipart(config, object);
  }
  await verifyPlannedObject(object);
  const executable = process.execPath;
  const args = [
    path.join(config.cwd, "node_modules", "wrangler", "bin", "wrangler.js"),
    "r2", "object", "put", `${config.bucket}/${object.objectKey}`,
    "--file", object.filePath,
    "--content-type", object.contentType,
    "--cache-control", "private, max-age=31536000, immutable",
    "--remote"
  ];
  if (config.environment !== "production") args.push("--env", config.environment);
  args.push("--env-file", config.envFile, "--force");
  const result = spawnSync(executable, args, { cwd: config.cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || "unknown Wrangler error";
    throw new Error(`R2 upload failed for ${object.relativePath}: ${String(detail).trim()}`);
  }
}

function checkpointMetadata(object) {
  return {
    sizeBytes: object.sizeBytes,
    checksum: object.checksum,
    contentType: object.contentType
  };
}

function checkpointMatchesObject(state, object) {
  const metadata = state.objects?.[object.objectKey];
  return Number(metadata?.sizeBytes) === object.sizeBytes
    && metadata?.checksum === object.checksum
    && String(metadata?.contentType || "").toLowerCase() === object.contentType.toLowerCase();
}

export async function verifyCheckpointedR2Object(config, object) {
  if (!config.workerUrl || !config.productionToken) {
    throw new Error("CLOUDFLARE_WORKER_URL and CONTENTFLOW_PRODUCTION_TOKEN are required to verify checkpointed R2 objects");
  }
  const fetchImpl = config.fetchImpl || fetch;
  const url = new URL(`${String(config.workerUrl).replace(/\/$/, "")}/internal/r2/object`);
  url.searchParams.set("key", object.objectKey);
  const response = await fetchImpl(url, {
    method: "HEAD",
    headers: { authorization: `Bearer ${config.productionToken}` }
  });
  if (response.status === 404) return false;
  if (!response.ok) throw await responseError(response, `R2 checkpoint verification for ${object.objectKey}`);
  return Number(response.headers.get("content-length")) === object.sizeBytes
    && String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() === object.contentType.toLowerCase();
}

export async function verifyCheckpointedObject(config, object) {
  if (!config.workerUrl || !config.productionToken) {
    throw new Error("CLOUDFLARE_WORKER_URL and CONTENTFLOW_PRODUCTION_TOKEN are required to verify checkpointed R2 objects");
  }
  const query = config.d1QueryImpl || d1Query;
  const result = await query(config, [{
    sql: `SELECT id, object_key, size_bytes, checksum, media_type
      FROM cf_assets WHERE object_key = ? LIMIT 1`,
    params: [object.objectKey]
  }]);
  const asset = result[0]?.results?.[0];
  if (!asset
    || asset.object_key !== object.objectKey
    || Number(asset.size_bytes) !== object.sizeBytes
    || asset.checksum !== object.checksum
    || String(asset.media_type || "").toLowerCase() !== object.contentType.toLowerCase()) {
    return false;
  }

  const fetchImpl = config.fetchImpl || fetch;
  const response = await fetchImpl(`${String(config.workerUrl).replace(/\/$/, "")}/internal/assets/${encodeURIComponent(asset.id)}`, {
    method: "HEAD",
    headers: { authorization: `Bearer ${config.productionToken}` }
  });
  if (response.status === 404) return false;
  if (!response.ok) throw await responseError(response, `R2 checkpoint verification for ${object.objectKey}`);
  return Number(response.headers.get("content-length")) === object.sizeBytes
    && String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() === object.contentType.toLowerCase();
}

function assetQueries(files) {
  return files.flatMap((file) => {
    const asset = {
      sql: `INSERT INTO cf_assets (
        id, project_name, kind, name, media_type, local_path, object_key, url,
        size_bytes, checksum, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        kind = excluded.kind, name = excluded.name, media_type = excluded.media_type,
        local_path = excluded.local_path, object_key = excluded.object_key, url = excluded.url,
        size_bytes = excluded.size_bytes, checksum = excluded.checksum, status = 'ready', updated_at = excluded.updated_at`,
      params: [
        file.assetId, file.projectName, file.kind, file.relativePath, file.contentType, file.relativePath,
        file.objectKey, `/media/assets/${file.assetId}`, file.sizeBytes, file.checksum, file.createdAt, new Date().toISOString()
      ]
    };
    if (file.kind !== "final-render") return [asset];
    const shortPath = file.relativePath.replace(/^renders\//, "");
    return [asset, {
      sql: `UPDATE cf_render_jobs SET object_key = ?, output_url = ?
        WHERE project_name = ? AND (output_path = ? OR output_path = ?)`,
      params: [file.objectKey, `/media/assets/${file.assetId}`, file.projectName, file.relativePath, shortPath]
    }];
  });
}

export async function migrateLocalMedia(config) {
  const plan = await planMediaFiles(config.projectsDir);
  const totalBytes = plan.objects.reduce((sum, object) => sum + object.sizeBytes, 0);
  console.log(`Planned ${plan.files.length} assets as ${plan.objects.length} unique R2 objects (${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB).`);
  if (config.dryRun) return plan;

  const query = config.d1QueryImpl || d1Query;
  const projectResult = await query(config, [{ sql: "SELECT name FROM cf_projects" }]);
  const projectNames = new Set(projectResult[0].results.map((row) => row.name));
  plan.files = plan.files.filter((file) => projectNames.has(file.projectName));
  const neededKeys = new Set(plan.files.map((file) => file.objectKey));
  plan.objects = plan.objects.filter((object) => neededKeys.has(object.objectKey));

  const state = loadState(config.stateFile);
  const uploaded = new Set(state.uploaded || []);
  const checkpointedObjects = { ...(state.objects || {}) };
  let completed = 0;
  for (const object of plan.objects) {
    const verifyObject = config.verifyObjectImpl || verifyCheckpointedR2Object;
    if (checkpointMatchesObject(state, object) && await verifyObject(config, object)) {
      completed += 1;
      continue;
    }
    if (uploaded.has(object.objectKey) && await verifyCheckpointedObject(config, object)) {
      checkpointedObjects[object.objectKey] = checkpointMetadata(object);
      state.objects = checkpointedObjects;
      saveState(config.stateFile, {
        uploaded: [...uploaded].sort(),
        objects: checkpointedObjects,
        updatedAt: new Date().toISOString()
      });
      completed += 1;
      continue;
    }
    console.log(`[${completed + 1}/${plan.objects.length}] Uploading ${object.relativePath} (${(object.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    await (config.uploadObjectImpl || uploadObject)(config, object);
    uploaded.add(object.objectKey);
    checkpointedObjects[object.objectKey] = checkpointMetadata(object);
    state.objects = checkpointedObjects;
    completed += 1;
    saveState(config.stateFile, {
      uploaded: [...uploaded].sort(),
      objects: checkpointedObjects,
      updatedAt: new Date().toISOString()
    });
  }

  const queries = assetQueries(plan.files);
  for (let index = 0; index < queries.length; index += 50) await query(config, queries.slice(index, index + 50));
  console.log(`R2 migration complete: ${plan.files.length} asset rows, ${plan.objects.length} unique objects.`);
  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const envFile = path.resolve(args["env-file"] || path.join(cwd, ".env"));
  const env = { ...parseEnv(envFile), ...process.env };
  const config = JSON.parse(fs.readFileSync(path.join(cwd, "wrangler.jsonc"), "utf8"));
  const environment = String(args.environment || "preview");
  const bindings = resolveWranglerBindings(config, environment);
  const databaseId = args["database-id"] || bindings.databaseId;
  await migrateLocalMedia({
    cwd,
    environment,
    envFile,
    projectsDir: path.resolve(args["projects-dir"] || env.CONTENTFLOW_PROJECTS_DIR || path.join(cwd, "projects")),
    stateFile: path.resolve(args["state-file"] || path.join(cwd, ".wrangler", `r2-media-migration-${environment}.json`)),
    bucket: args.bucket || bindings.bucket,
    databaseId,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    workerUrl: env.CLOUDFLARE_WORKER_URL,
    productionToken: env.CONTENTFLOW_PRODUCTION_TOKEN,
    dryRun: Boolean(args["dry-run"])
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
