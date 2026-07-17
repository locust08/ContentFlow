const queueActions = new Map([
  ["analyze", "analyze-reference"],
  ["analyze-reference", "analyze-reference"],
  ["generate", "generate-content"],
  ["images", "generate-images"],
  ["videos", "generate-videos"],
  ["transcribe-generated-video", "transcribe-generated-video"],
  ["voiceover", "generate-voiceover"],
  ["render", "render-final-video"],
  ["pipeline", "pipeline"]
]);

const clipperActions = new Map([
  ["source-link", "clipper-source-link"],
  ["analyze", "clipper-analyze"],
  ["render", "clipper-render"],
  ["render-bulk", "clipper-render-bulk"],
  ["render-variations", "clipper-render-variations"]
]);

const uploadKinds = new Map([
  ["reference", "reference-video"],
  ["product", "product-image"],
  ["character", "character-reference"]
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function safeFileName(value) {
  const name = String(value || "asset").split(/[\\/]/).at(-1);
  return normalizeName(name) || "asset";
}

function isSupportedMedia(contentType) {
  return /^(image\/(png|jpe?g|webp|gif)|video\/(mp4|webm|quicktime))$/i.test(contentType);
}

function isContentObjectKey(value) {
  return /^objects\/sha256\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/i.test(String(value || ""));
}

function normalizeAssetPath(value) {
  const input = String(value || "").trim();
  const parts = input.split("/");
  if (!input || input.startsWith("/") || input.endsWith("/") || input.includes("\\")
    || parts.some((part) => !part || part === "." || part === "..")) {
    throw new HttpError(400, "Asset path is invalid");
  }
  return parts.map(safeFileName).join("/");
}

function registrationMetadata(body) {
  const contentType = String(body.contentType || "").trim().toLowerCase();
  const kind = String(body.kind || "").trim();
  const checksum = String(body.checksum || "");
  const sizeBytes = Number(body.sizeBytes);
  const keyMatch = String(body.objectKey || "").match(/^objects\/sha256\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/);
  if (!keyMatch) throw new HttpError(400, "Invalid asset object key");
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(contentType)) {
    throw new HttpError(400, "Invalid asset content type");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(kind)) throw new HttpError(400, "Invalid asset kind");
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) throw new HttpError(400, "Invalid asset size");
  if (!/^[a-f0-9]{64}$/.test(checksum) || keyMatch[1] !== checksum) throw new HttpError(400, "Invalid asset checksum");
  return { contentType, kind, checksum, sizeBytes, objectKey: body.objectKey };
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId || ""
  };
}

function editorRequired(user) {
  if (user.role === "manager-client") throw new HttpError(403, "Editor access required");
}

function adminRequired(user) {
  if (user.role !== "admin") throw new HttpError(403, "Admin access required");
}

const internalReviewStatuses = new Set(["draft", "internal-review", "client-review"]);
const finalReviewStatuses = new Set(["approved", "changes-requested"]);

function reviewStatusRequired(user, status) {
  if (!internalReviewStatuses.has(status) && !finalReviewStatuses.has(status)) {
    throw new HttpError(400, "Invalid review status");
  }
  if (user.role === "admin") return;
  if (user.role === "staff-editor" && internalReviewStatuses.has(status)) return;
  if (user.role === "manager-client" && finalReviewStatuses.has(status)) return;
  throw new HttpError(403, user.role === "manager-client"
    ? "Client reviewers may only approve or request changes"
    : "Staff editors may only use internal review statuses");
}

const ugcScriptReviewTransitions = new Map([
  ["draft", new Set(["internal-review"])],
  ["internal-review", new Set(["client-review"])],
  ["client-review", new Set(["approved", "changes-requested"])],
  ["changes-requested", new Set(["draft", "internal-review"])]
]);

function ugcScriptReviewTransitionRequired(user, fromStatus, toStatus, overrideReason) {
  if (ugcScriptReviewTransitions.get(fromStatus)?.has(toStatus)) {
    return { overridden: false, overrideReason: "" };
  }
  const reason = String(overrideReason || "").trim();
  if (user.role === "admin" && reason) {
    return { overridden: true, overrideReason: reason };
  }
  throw new HttpError(409, `UGC script review cannot move from ${fromStatus} to ${toStatus}`);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function contentObjectKey(checksum, assetPath) {
  const extension = String(assetPath || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return `objects/sha256/${checksum}${extension ? `.${extension}` : ""}`;
}

async function accessibleProject(repository, name, user) {
  const project = await repository.getProject(name, user);
  if (!project) throw new HttpError(404, "Project not found");
  return project;
}

async function queueProjectJob(repository, projectName, jobType, payload, user) {
  const job = await repository.createJob({
    id: crypto.randomUUID(),
    projectName,
    jobType,
    status: "queued",
    payload,
    requestedBy: user.id,
    createdAt: new Date().toISOString()
  });
  return { ok: true, queued: true, job, project: projectName };
}

async function reconcileStructuredResult(repository, job, result) {
  if (job.jobType === "generate-market-report") {
    if (!result || typeof result !== "object" || !result.id || !result.briefId || !result.campaignId) {
      throw new HttpError(400, "Completed market report jobs require a structured result");
    }
    if (!await repository.reconcileMarketReport(result)) {
      throw new Error("Market report reconciliation did not persist a result");
    }
    return;
  }
  if (job.jobType === "generate-ugc-script") {
    if (!result?.script || !result?.version) {
      throw new HttpError(400, "Completed UGC script jobs require script and version results");
    }
    const reconciled = await repository.reconcileUgcScript(result.script, result.version);
    if (!reconciled?.script || !reconciled?.version) {
      throw new Error("UGC script reconciliation did not persist the complete result");
    }
    return;
  }
  if (job.jobType === "clipper-analyze") {
    if (!Array.isArray(result?.candidates)) {
      throw new HttpError(400, "Completed clipper analysis jobs require candidate results");
    }
    await repository.replaceClipCandidates(job.projectName, result.candidates);
  }
}

async function ensureRenderForAsset(repository, project, asset, kind, outputPath, objectKey) {
  if (!/render/i.test(kind)) return null;
  const render = await repository.ensureRender({
    assetId: asset.id,
    projectName: project.name,
    mode: project.type || "worker",
    status: "completed",
    outputPath,
    objectKey,
    outputUrl: asset.url,
    renderType: kind,
    createdAt: new Date().toISOString()
  });
  if (!render) throw new Error("Render registration did not persist a result");
  return render;
}

async function uploadAsset({ request, project, kind, repository, media, user }) {
  editorRequired(user);
  const contentType = String(request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!isSupportedMedia(contentType)) throw new HttpError(415, "Only supported image and video files may be uploaded");
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, "Uploaded file is empty");
  const id = crypto.randomUUID();
  const fileName = safeFileName(request.headers.get("x-file-name"));
  const objectKey = `projects/${encodeURIComponent(project.name)}/${kind}/${id}-${fileName}`;
  await media.put(objectKey, bytes, { contentType, projectName: project.name, kind });
  const asset = await repository.createAsset({
    id,
    projectName: project.name,
    kind,
    name: fileName,
    mediaType: contentType,
    objectKey,
    url: `/media/assets/${id}`,
    sizeBytes: bytes.byteLength,
    status: "ready",
    createdAt: new Date().toISOString()
  });
  return json({ ok: true, asset }, 201);
}

async function mediaResponse(request, asset, media) {
  const object = await media.get(asset.objectKey, { range: request.headers.get("range") || "" });
  if (!object) throw new HttpError(404, "Media not found");
  if (object.rangeNotSatisfiable) {
    return new Response(null, {
      status: 416,
      headers: {
        "content-range": `bytes */${object.totalSize}`,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=300"
      }
    });
  }
  const headers = new Headers({
    "content-type": object.contentType || asset.mediaType || "application/octet-stream",
    "cache-control": "private, max-age=300",
    "accept-ranges": "bytes"
  });
  if (object.etag) headers.set("etag", object.etag);
  if (object.contentRange) headers.set("content-range", object.contentRange);
  if (object.size !== undefined) headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: object.contentRange ? 206 : 200, headers });
}

export function createApp({ auth, repository, media, assets = null, internalToken = "" }) {
  if (!auth || !repository || !media) throw new Error("Cloudflare app dependencies are required");

  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        let parts;
        try {
          parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
        } catch {
          throw new HttpError(400, "Invalid URL encoding");
        }
        const routeRoot = decodeURIComponent(url.pathname).split("/").filter(Boolean)[0]?.toLowerCase() || "";
        const isApiPath = routeRoot === "api";
        const isMediaPath = routeRoot === "media";

        if (request.method === "GET" && url.pathname === "/api/health") {
          return json({ ok: true, service: "contentflow-cloudflare", timestamp: new Date().toISOString() });
        }
        if (request.method === "GET" && url.pathname === "/api/auth/config") {
          return json(auth.config());
        }

        if (parts[0] === "internal") {
          if (!internalToken || request.headers.get("authorization") !== `Bearer ${internalToken}`) {
            throw new HttpError(401, "Worker authentication required");
          }
          if (request.method === "HEAD" && parts[1] === "r2" && parts[2] === "object" && parts.length === 3) {
            const key = url.searchParams.get("key") || "";
            if (!isContentObjectKey(key)) throw new HttpError(400, "Invalid R2 object key");
            if (typeof media.head !== "function") throw new HttpError(500, "Media metadata lookup is unavailable");
            const object = await media.head(key);
            if (!object) throw new HttpError(404, "R2 object not found");
            return new Response(null, {
              status: 200,
              headers: {
                "content-length": String(object.size),
                "content-type": object.contentType || "application/octet-stream",
                ...(object.etag ? { etag: object.etag } : {})
              }
            });
          }
          if (parts[1] === "r2" && parts[2] === "multipart") {
            if (request.method === "POST" && parts[3] === "start") {
              const body = await readJson(request);
              if (!isContentObjectKey(body.key)) throw new HttpError(400, "Invalid multipart object key");
              const upload = await media.createMultipart(body.key, { contentType: body.contentType || "application/octet-stream" });
              return json(upload, 201);
            }
            if (request.method === "PUT" && parts[3] === "part") {
              const key = url.searchParams.get("key") || "";
              const uploadId = url.searchParams.get("uploadId") || "";
              const partNumber = Number(url.searchParams.get("partNumber"));
              if (!isContentObjectKey(key) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
                throw new HttpError(400, "Invalid multipart part request");
              }
              const bytes = await request.arrayBuffer();
              if (!bytes.byteLength || bytes.byteLength > 60 * 1024 * 1024) throw new HttpError(413, "Multipart parts must be between 1 byte and 60 MiB");
              return json({ ...await media.uploadPart(key, uploadId, partNumber, bytes), sizeBytes: bytes.byteLength });
            }
            if (request.method === "POST" && parts[3] === "complete") {
              const body = await readJson(request);
              const validParts = Array.isArray(body.parts) && body.parts.length && body.parts.every((part) =>
                Number.isInteger(Number(part.partNumber)) && Number(part.partNumber) > 0 && String(part.etag || "")
              );
              if (!isContentObjectKey(body.key) || !body.uploadId || !validParts) throw new HttpError(400, "Multipart completion data is invalid");
              const sortedParts = body.parts.map((part) => ({
                partNumber: Number(part.partNumber),
                etag: String(part.etag),
                sizeBytes: Number(part.sizeBytes)
              })).sort((left, right) => left.partNumber - right.partNumber);
              if (sortedParts.some((part, index) => part.partNumber !== index + 1)) {
                throw new HttpError(400, "Multipart part numbers must be unique and sequential");
              }
              const suppliedSizes = sortedParts.filter((part) => Number.isSafeInteger(part.sizeBytes) && part.sizeBytes > 0);
              if (suppliedSizes.length && suppliedSizes.length !== sortedParts.length) {
                throw new HttpError(400, "Multipart completion must include every part size");
              }
              if (suppliedSizes.length > 1) {
                const expectedSize = sortedParts[0].sizeBytes;
                const nonFinalParts = sortedParts.slice(0, -1);
                if (expectedSize < 5 * 1024 * 1024 || nonFinalParts.some((part) => part.sizeBytes !== expectedSize)) {
                  throw new HttpError(400, "Multipart non-final parts must be equal and at least 5 MiB");
                }
              }
              return json(await media.completeMultipart(body.key, body.uploadId, sortedParts.map(({ partNumber, etag }) => ({ partNumber, etag }))));
            }
            if (request.method === "DELETE" && parts[3] === "abort") {
              const body = await readJson(request);
              if (!isContentObjectKey(body.key) || !body.uploadId) throw new HttpError(400, "Multipart abort data is invalid");
              await media.abortMultipart(body.key, body.uploadId);
              return json({ ok: true });
            }
          }
          if (request.method === "POST" && url.pathname === "/internal/jobs/claim") {
            const body = await readJson(request);
            return json({ job: await repository.claimJob({ workerId: body.workerId || "local-worker" }) });
          }
          if (request.method === "PATCH" && parts[1] === "jobs" && parts[2]) {
            const body = await readJson(request);
            if (body.status === "completed") {
              const activeJob = await repository.renewJobLease(parts[2], body.leaseToken || "");
              if (!activeJob) throw new HttpError(409, "Job lease is no longer valid");
              await reconcileStructuredResult(repository, activeJob, body.result);
            }
            const job = await repository.updateClaimedJob(parts[2], body);
            if (!job) throw new HttpError(409, "Job lease is no longer valid");
            return json({ ok: true, job });
          }
          if (request.method === "GET" && parts[1] === "projects" && parts[2] && parts[3] === "context" && parts.length === 4) {
            const admin = { id: "internal-worker", role: "admin", clientId: "" };
            const projectName = parts[2];
            const project = await repository.getProject(projectName, admin);
            if (!project) throw new HttpError(404, "Project not found");
            const [projectData, campaignIntelligence, scriptBundle] = await Promise.all([
              repository.getProjectData(projectName, admin),
              project.campaignId
                ? repository.campaignIntelligence(project.campaignId, admin)
                : Promise.resolve({ campaignBrief: null, researchSources: [], marketReport: null }),
              repository.projectScriptBundle(projectName, admin)
            ]);
            return json({
              project,
              assets: projectData?.summary?.assets || [],
              campaignIntelligence,
              scriptBundle
            });
          }
          if ((request.method === "GET" || request.method === "HEAD") && parts[1] === "assets" && parts[2] && parts.length === 3) {
            const asset = await repository.getAsset(parts[2]);
            if (!asset?.objectKey) throw new HttpError(404, "Media not found");
            return await mediaResponse(request, asset, media);
          }
          if (request.method === "POST" && parts[1] === "projects" && parts[2] && parts[3] === "assets" && parts[4] === "register" && parts.length === 5) {
            const projectName = parts[2];
            const project = await repository.getProject(projectName, { id: "internal-worker", role: "admin", clientId: "" });
            if (!project) throw new HttpError(404, "Project not found");
            const body = await readJson(request);
            const assetPath = normalizeAssetPath(body.assetPath);
            const metadata = registrationMetadata(body);
            if (typeof media.head !== "function") throw new HttpError(500, "Media metadata lookup is unavailable");
            const object = await media.head(metadata.objectKey);
            if (!object) throw new HttpError(404, "Uploaded object not found");
            if (Number(object.size) !== metadata.sizeBytes) throw new HttpError(409, "Uploaded object size does not match registration");
            if (String(object.contentType || "").toLowerCase() !== metadata.contentType) {
              throw new HttpError(409, "Uploaded object content type does not match registration");
            }
            const id = crypto.randomUUID();
            const asset = await repository.createAsset({
              id,
              projectName,
              kind: metadata.kind,
              name: assetPath,
              localPath: assetPath,
              mediaType: metadata.contentType,
              objectKey: metadata.objectKey,
              url: `/media/assets/${id}`,
              sizeBytes: metadata.sizeBytes,
              checksum: metadata.checksum,
              status: "ready",
              createdAt: new Date().toISOString()
            });
            const created = asset.id === id;
            await ensureRenderForAsset(repository, project, asset, metadata.kind, assetPath, metadata.objectKey);
            return json({ ok: true, asset, existing: !created }, created ? 201 : 200);
          }
          if (parts[1] === "projects" && parts[2] && parts[3] === "assets" && parts.length > 4) {
            const projectName = parts[2];
            const project = await repository.getProject(projectName, { id: "internal-worker", role: "admin", clientId: "" });
            if (!project) throw new HttpError(404, "Project not found");
            const assetPath = parts.slice(4).flatMap((part) => String(part).split("/")).map(safeFileName).filter(Boolean).join("/");
            if (!assetPath) throw new HttpError(400, "Asset path is required");
            if (request.method === "PUT") {
              const bytes = await request.arrayBuffer();
              if (!bytes.byteLength) throw new HttpError(400, "Uploaded file is empty");
              const contentType = String(request.headers.get("content-type") || "application/octet-stream").split(";")[0];
              const kind = request.headers.get("x-asset-kind") || "output";
              const checksum = await sha256Hex(bytes);
              const objectKey = contentObjectKey(checksum, assetPath);
              await media.put(objectKey, bytes, { contentType, projectName, kind });
              const id = crypto.randomUUID();
              const asset = await repository.createAsset({
                id,
                projectName,
                kind,
                name: assetPath,
                localPath: assetPath,
                mediaType: contentType,
                objectKey,
                url: `/media/assets/${id}`,
                sizeBytes: bytes.byteLength,
                checksum,
                status: "ready",
                createdAt: new Date().toISOString()
              });
              const created = asset.id === id;
              await ensureRenderForAsset(repository, project, asset, kind, assetPath, objectKey);
              return json({ ok: true, asset, existing: !created }, created ? 201 : 200);
            }
            if (request.method === "GET" || request.method === "HEAD") {
              const objectKey = `projects/${encodeURIComponent(projectName)}/${assetPath}`;
              return await mediaResponse(request, { objectKey, mediaType: "application/octet-stream" }, media);
            }
          }
          throw new HttpError(404, "Internal route not found");
        }

        const user = await auth.user(request);
        if (request.method === "GET" && url.pathname === "/api/auth/profile") {
          if (auth.config().required && !user) throw new HttpError(401, "Login required");
          return json({ user: publicUser(user), required: auth.config().required });
        }
        if ((isApiPath || isMediaPath) && !user) throw new HttpError(401, "Login required");

        if (request.method === "GET" && url.pathname === "/api/projects") {
          return json({ projects: await repository.listProjects(user), folders: await repository.listFolders?.(user) || [] });
        }

        if (request.method === "GET" && url.pathname === "/api/folders") {
          return json({ folders: await repository.listFolders?.(user) || [] });
        }

        if (request.method === "GET" && url.pathname === "/api/organization") {
          return json(await repository.listOrganization(user));
        }

        if (request.method === "GET" && url.pathname === "/api/media-library") {
          return json({ items: await repository.listMedia(user) });
        }

        if (request.method === "GET" && url.pathname === "/api/intelligence") {
          return json(await repository.listIntelligence(user));
        }

        if (request.method === "GET" && url.pathname === "/api/production-jobs") {
          return json({ jobs: await repository.listJobs({ user }) });
        }

        if (request.method === "GET" && url.pathname === "/api/activity") {
          return json({ items: await repository.listActivity?.({ user, limit: url.searchParams.get("limit") }) || [] });
        }

        if (request.method === "GET" && url.pathname === "/api/supabase/status") {
          return json({ configured: true, ready: true, provider: "cloudflare", database: "D1", storage: "R2" });
        }

        if (request.method === "GET" && url.pathname === "/api/supabase/analytics") {
          return json({ analytics: await repository.analytics?.(user) || null, provider: "cloudflare" });
        }

        if (request.method === "POST" && url.pathname === "/api/clients") {
          adminRequired(user);
          const body = await readJson(request);
          if (!String(body.name || "").trim()) throw new HttpError(400, "Client name is required");
          const client = await repository.createClient({
            id: body.id || crypto.randomUUID(),
            name: String(body.name).trim(),
            industry: body.industry || "",
            contact: body.contact || "",
            createdAt: new Date().toISOString()
          });
          return json({ ok: true, client }, 201);
        }

        if (request.method === "POST" && url.pathname === "/api/campaigns") {
          adminRequired(user);
          const body = await readJson(request);
          if (!String(body.name || "").trim()) throw new HttpError(400, "Campaign name is required");
          const campaign = await repository.createCampaign({
            id: body.id || crypto.randomUUID(),
            clientId: body.clientId || "",
            name: String(body.name).trim(),
            objective: body.objective || "",
            status: body.status || "active",
            createdAt: new Date().toISOString()
          });
          return json({ ok: true, campaign }, 201);
        }

        if (parts[0] === "api" && parts[1] === "campaigns" && parts[2] && parts.length > 3) {
          const campaignId = parts[2];
          const visibleProjects = (await repository.listProjects(user)).filter((project) => project.campaignId === campaignId);
          if (!visibleProjects.length) throw new HttpError(404, "Campaign not found");
          const section = parts[3];

          if (request.method === "GET" && section === "intelligence") {
            return json(await repository.campaignIntelligence(campaignId, user));
          }

          editorRequired(user);
          if (request.method === "PUT" && section === "brief") {
            const body = await readJson(request);
            const current = await repository.campaignIntelligence(campaignId, user);
            const brief = await repository.upsertCampaignBrief({
              id: body.id || current.campaignBrief?.id || crypto.randomUUID(),
              campaignId,
              title: body.title || body.productName || "Campaign brief",
              productName: body.productName || body.product || "",
              objective: body.objective || "",
              targetAudience: body.targetAudience || body.audience || "",
              brief: body.brief || body,
              status: body.status || current.campaignBrief?.status || "draft",
              createdBy: current.campaignBrief?.createdBy || user.id,
              createdAt: current.campaignBrief?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            return json({ ok: true, brief, intelligence: await repository.campaignIntelligence(campaignId, user) });
          }

          if (request.method === "POST" && section === "research-sources" && ["text", "file"].includes(parts[4])) {
            const intelligence = await repository.campaignIntelligence(campaignId, user);
            if (!intelligence.campaignBrief?.id) throw new HttpError(409, "Save the campaign brief before adding research sources");
            let source;
            if (parts[4] === "text") {
              source = await readJson(request);
            } else {
              const fileName = safeFileName(request.headers.get("x-file-name") || "research.txt");
              const extension = fileName.split(".").at(-1)?.toLowerCase();
              if (!["txt", "md", "csv"].includes(extension)) throw new HttpError(415, "Research files must be TXT, MD, or CSV");
              source = { name: fileName, type: extension, content: await request.text() };
            }
            if (!String(source.content || source.text || "").trim()) throw new HttpError(400, "Research source content is required");
            const saved = await repository.createResearchSource({
              id: source.id || crypto.randomUUID(),
              briefId: intelligence.campaignBrief.id,
              sourceType: source.type || "text",
              name: source.name || "Research notes",
              content: source.content || source.text,
              passages: source.passages || [],
              metadata: source.metadata || {},
              createdBy: user.id,
              createdAt: new Date().toISOString()
            });
            return json({ ok: true, source: saved }, 201);
          }

          if (request.method === "DELETE" && section === "research-sources" && parts[4]) {
            const intelligence = await repository.campaignIntelligence(campaignId, user);
            if (!intelligence.campaignBrief?.id) throw new HttpError(404, "Campaign brief not found");
            const deleted = await repository.deleteResearchSource(parts[4], intelligence.campaignBrief.id);
            if (!deleted) throw new HttpError(404, "Research source not found");
            return json({ ok: true });
          }

          if (request.method === "POST" && section === "market-reports" && parts[4] === "generate") {
            const body = await readJson(request);
            const project = visibleProjects.find((item) => item.type !== "auto-clipper");
            if (!project) throw new HttpError(409, "Create an AI Generator project for this campaign first");
            return json(await queueProjectJob(repository, project.name, "generate-market-report", { campaignId, sourceIds: body.sourceIds || [] }, user), 202);
          }

          if (section === "market-reports" && parts[4]) {
            const current = await repository.campaignIntelligence(campaignId, user);
            if (!current.marketReport || current.marketReport.id !== parts[4]) throw new HttpError(404, "Market report not found");
            if (request.method === "PUT" && parts.length === 5) {
              const body = await readJson(request);
              const report = await repository.upsertMarketReport({ ...current.marketReport, ...body, id: parts[4], campaignId, status: "draft", updatedAt: new Date().toISOString() });
              return json({ ok: true, report });
            }
            if (request.method === "POST" && parts[5] === "approve") {
              const report = await repository.upsertMarketReport({ ...current.marketReport, id: parts[4], campaignId, status: "approved", updatedAt: new Date().toISOString() });
              return json({ ok: true, report });
            }
          }
        }

        if (request.method === "POST" && url.pathname === "/api/folders") {
          adminRequired(user);
          const body = await readJson(request);
          if (!String(body.name || "").trim()) throw new HttpError(400, "Folder name is required");
          const folder = await repository.createFolder({
            id: body.id || crypto.randomUUID(),
            name: String(body.name).trim(),
            createdBy: user.id,
            createdAt: new Date().toISOString()
          });
          return json({ ok: true, folder }, 201);
        }

        if (parts[0] === "api" && parts[1] === "folders" && parts[2]) {
          adminRequired(user);
          if (request.method === "PUT") {
            const body = await readJson(request);
            if (!String(body.name || "").trim()) throw new HttpError(400, "Folder name is required");
            const folder = await repository.updateFolder(parts[2], { name: String(body.name).trim(), updatedAt: new Date().toISOString() });
            if (!folder) throw new HttpError(404, "Folder not found");
            return json({ ok: true, folder });
          }
          if (request.method === "DELETE") {
            await repository.deleteFolder(parts[2]);
            return json({ ok: true });
          }
        }

        if (request.method === "POST" && url.pathname === "/api/projects") {
          adminRequired(user);
          const body = await readJson(request);
          const name = normalizeName(body.name);
          if (!name) throw new HttpError(400, "Project name is required");
          const type = body.type === "auto-clipper" ? "auto-clipper" : "ai-generator";
          const project = await repository.createProject({
            name,
            type,
            folderId: body.folderId || "",
            clientId: body.clientId || "",
            campaignId: body.campaignId || "",
            assignedStaffId: body.assignedStaffId || "",
            reviewerId: body.reviewerId || "",
            priority: body.priority || "normal",
            approvalStatus: "draft",
            approvalFeedback: "",
            createdAt: new Date().toISOString()
          });
          return json({ ok: true, project }, 201);
        }

        if ((request.method === "GET" || request.method === "HEAD") && parts[0] === "media" && parts[1] === "assets" && parts[2]) {
          const asset = await repository.getAsset(parts[2]);
          if (!asset) throw new HttpError(404, "Media not found");
          await accessibleProject(repository, asset.projectName, user);
          return await mediaResponse(request, asset, media);
        }

        if (parts[0] === "api" && parts[1] === "projects" && parts[2]) {
          const projectName = parts[2];
          const project = await accessibleProject(repository, projectName, user);

          if (request.method === "DELETE" && parts.length === 3) {
            adminRequired(user);
            await repository.deleteProject(projectName);
            return json({ ok: true });
          }

          if (request.method === "PUT" && parts[3] === "meta") {
            if (!["admin", "staff-editor", "manager-client"].includes(user.role)) throw new HttpError(403, "Project review access required");
            const body = await readJson(request);
            const adminFields = ["type", "folderId", "clientId", "campaignId", "assignedStaffId", "reviewerId"];
            if (user.role !== "admin" && adminFields.some((field) => Object.hasOwn(body, field))) {
              throw new HttpError(403, "Only administrators can change project ownership or assignment");
            }
            if (user.role === "manager-client" && Object.keys(body).some((field) => !["approvalStatus", "approvalFeedback"].includes(field))) {
              throw new HttpError(403, "Client reviewers may only update approval status and feedback");
            }
            if (body.approvalStatus) reviewStatusRequired(user, body.approvalStatus);
            const patch = {
              approvalStatus: body.approvalStatus ?? project.approvalStatus ?? "draft",
              approvalFeedback: body.approvalFeedback ?? project.approvalFeedback ?? "",
              updatedAt: new Date().toISOString()
            };
            if (user.role !== "manager-client") patch.priority = body.priority ?? project.priority ?? "normal";
            if (user.role === "admin") Object.assign(patch, {
              type: body.type || project.type,
              folderId: body.folderId ?? project.folderId ?? "",
              clientId: body.clientId ?? project.clientId ?? "",
              campaignId: body.campaignId ?? project.campaignId ?? "",
              assignedStaffId: body.assignedStaffId ?? project.assignedStaffId ?? "",
              reviewerId: body.reviewerId ?? project.reviewerId ?? ""
            });
            const updated = await repository.updateProject(projectName, patch);
            if (body.approvalStatus) await repository.recordApproval?.({
              id: crypto.randomUUID(),
              projectName,
              status: body.approvalStatus,
              feedback: patch.approvalFeedback,
              actorId: user.id,
              createdAt: new Date().toISOString()
            });
            return json({ ok: true, project: updated, data: await repository.getProjectData?.(projectName, user) || { summary: updated } });
          }

          if (request.method === "GET" && parts.length === 3) {
            return json(await repository.getProjectData?.(projectName, user) || { summary: project });
          }
          if (request.method === "GET" && parts[3] === "jobs") {
            return json({ jobs: await repository.listJobs({ projectName, user }) });
          }

          if (parts[3] === "ugc-script" && request.method === "POST" && ["analyze", "generate"].includes(parts[4])) {
            editorRequired(user);
            const body = await readJson(request);
            const jobType = parts[4] === "analyze" ? "analyze-ugc-script" : "generate-ugc-script";
            return json(await queueProjectJob(repository, projectName, jobType, { ...body, campaignId: project.campaignId || "" }, user), 202);
          }

          if (parts[3] === "ugc-script" && request.method === "PUT" && parts.length === 4) {
            editorRequired(user);
            const body = await readJson(request);
            const bundle = await repository.projectScriptBundle(projectName, user);
            if (!bundle.ugcScript) throw new HttpError(409, "Generate a UGC script before editing it");
            if (body.baseVersionId && body.baseVersionId !== bundle.ugcScript.versionId) {
              throw new HttpError(409, "This script changed since it was opened. Reload before saving");
            }
            const versionNumber = Number(bundle.ugcScript.currentVersionNumber || 0) + 1;
            const versionId = crypto.randomUUID();
            const now = new Date().toISOString();
            const content = {
              ...bundle.ugcScript,
              ...body,
              hooks: Array.isArray(body.hooks) ? body.hooks : bundle.ugcScript.hooks || [],
              scenes: Array.isArray(body.scenes) ? body.scenes : bundle.ugcScript.scenes || [],
              status: "draft",
              currentVersionNumber: versionNumber,
              versionId
            };
            const script = await repository.upsertUgcScript({
              ...bundle.ugcScript,
              ...content,
              id: bundle.ugcScript.id,
              projectName,
              campaignId: project.campaignId || bundle.ugcScript.campaignId || "",
              status: "draft",
              currentVersionNumber: versionNumber,
              updatedBy: user.id,
              updatedAt: now
            });
            const version = await repository.createScriptVersion({
              id: versionId,
              scriptId: script.id,
              versionNumber,
              content,
              changeNote: body.changeNote || "Edited in UGC Script Studio",
              createdBy: user.id,
              createdAt: now
            });
            return json({ ok: true, result: script, version });
          }

          if (parts[3] === "ugc-script" && request.method === "POST" && parts[4] === "review") {
            const body = await readJson(request);
            reviewStatusRequired(user, body.status);
            const bundle = await repository.projectScriptBundle(projectName, user);
            if (!bundle.ugcScript) throw new HttpError(409, "Generate a UGC script before reviewing it");
            const fromStatus = bundle.ugcScript.status || "draft";
            const transition = ugcScriptReviewTransitionRequired(user, fromStatus, body.status, body.overrideReason);
            const now = new Date().toISOString();
            const script = await repository.upsertUgcScript({
              ...bundle.ugcScript,
              id: bundle.ugcScript.id,
              projectName,
              status: body.status,
              updatedBy: user.id,
              updatedAt: now
            });
            const event = await repository.recordScriptReview({
              id: crypto.randomUUID(),
              scriptId: script.id,
              versionId: bundle.ugcScript.versionId,
              fromStatus,
              toStatus: body.status,
              feedback: body.feedback || "",
              actorId: user.id,
              overridden: transition.overridden,
              overrideReason: transition.overrideReason,
              createdAt: now
            });
            return json({ ok: true, result: script, event });
          }

          if (request.method === "POST" && parts[3] === "generate-ugc-video") {
            editorRequired(user);
            const body = await readJson(request);
            const bundle = await repository.projectScriptBundle(projectName, user);
            if (!bundle.ugcScript) throw new HttpError(409, "Generate and approve a UGC script before video generation");
            const overridden = user.role === "admin" && String(body.overrideReason || "").trim();
            if (bundle.ugcScript.status !== "approved" && !overridden) {
              throw new HttpError(409, "Approve the active UGC script before video generation");
            }
            return json(await queueProjectJob(repository, projectName, "generate-ugc-video", {
              ...body,
              marketReportId: bundle.ugcScript.marketReportId || "",
              scriptId: bundle.ugcScript.id,
              scriptVersionId: bundle.ugcScript.versionId || "",
              selectedHookId: bundle.ugcScript.selectedHookId || "",
              override: overridden ? { overrideReason: body.overrideReason, actorId: user.id } : null
            }, user), 202);
          }

          const directJobType = queueActions.get(parts[3]);
          if (request.method === "POST" && directJobType) {
            editorRequired(user);
            return json(await queueProjectJob(repository, projectName, directJobType, await readJson(request), user), 202);
          }

          if (request.method === "POST" && uploadKinds.has(parts[3])) {
            return await uploadAsset({ request, project, kind: uploadKinds.get(parts[3]), repository, media, user });
          }

          if (parts[3] === "clipper") {
            if (request.method === "POST" && parts[4] === "reaction") {
              return await uploadAsset({ request, project, kind: "reaction-character", repository, media, user });
            }
            if (request.method === "POST" && parts[4] === "select-highlight") {
              editorRequired(user);
              const body = await readJson(request);
              const selection = await repository.setSelectedHighlight(projectName, body.highlightId);
              if (!selection) throw new HttpError(404, "Highlight candidate not found");
              return json({ ok: true, selection });
            }
            const clipperJobType = clipperActions.get(parts[4]);
            if (request.method === "POST" && clipperJobType) {
              editorRequired(user);
              return json(await queueProjectJob(repository, projectName, clipperJobType, await readJson(request), user), 202);
            }
          }
        }

        if (isApiPath) throw new HttpError(404, "API route not found");
        if (assets) return assets.fetch(request);
        throw new HttpError(404, "Not found");
      } catch (error) {
        const status = Number(error?.status) || 500;
        const message = status >= 500 ? "Internal server error" : error.message;
        if (status >= 500) console.error("Cloudflare request failed", error);
        return json({ error: message }, status);
      }
    }
  };
}
