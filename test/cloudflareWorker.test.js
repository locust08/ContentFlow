import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../cloudflare/worker/app.js";

function jsonRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body !== "string" && !(options.body instanceof ArrayBuffer) && !ArrayBuffer.isView(options.body)) {
    headers.set("content-type", "application/json");
    options = { ...options, body: JSON.stringify(options.body) };
  }
  return new Request(`https://contentflow.test${path}`, { ...options, headers });
}

async function body(response) {
  return response.json();
}

function fixture(overrides = {}) {
  const users = {
    admin: { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin", clientId: "" },
    staff: { id: "staff-1", name: "Editor", email: "staff@example.com", role: "staff-editor", clientId: "" },
    client: { id: "client-user-1", name: "Client", email: "client@example.com", role: "manager-client", clientId: "client-1" }
  };
  const projects = [
    { name: "alpha", type: "ai-generator", assignedStaffId: "staff-1", clientId: "client-1", campaignId: "campaign-1" },
    { name: "beta", type: "auto-clipper", assignedStaffId: "staff-2", clientId: "client-2" }
  ];
  const jobs = [];
  const assets = [];
  const folders = [];
  const clients = [];
  const campaigns = [];
  const renderRecords = [];
  const clipCandidates = [];
  let campaignIntelligence = { campaignBrief: null, researchSources: [], marketReport: null };
  const scriptBundle = { ugcScript: null, scriptAnalysis: null, scriptVersions: [], scriptReviewEvents: [] };
  let selectedHighlight = null;
  const auth = {
    config: () => ({ enabled: true, required: true, hostedDemo: true, supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon" }),
    user: async (request) => users[request.headers.get("authorization")?.replace("Bearer ", "")] || null
  };
  const repository = {
    listProjects: async (user) => projects.filter((project) => user.role === "admin"
      || (user.role === "staff-editor" && project.assignedStaffId === user.id)
      || (user.role === "manager-client" && project.clientId === user.clientId)),
    getProject: async (name, user) => (await repository.listProjects(user)).find((project) => project.name === name) || null,
    createJob: async (job) => {
      const saved = { id: `job-${jobs.length + 1}`, status: "queued", ...job };
      jobs.push(saved);
      return saved;
    },
    claimJob: async () => {
      const job = jobs.find((item) => item.status === "queued");
      if (!job) return null;
      Object.assign(job, { status: "processing", leaseToken: "lease-test" });
      return job;
    },
    updateClaimedJob: async (id, patch) => {
      const job = jobs.find((item) => item.id === id);
      return job ? Object.assign(job, patch) : null;
    },
    renewJobLease: async (id, leaseToken) => {
      const job = jobs.find((item) => item.id === id && item.status === "processing" && item.leaseToken === leaseToken);
      return job || null;
    },
    createAsset: async (asset) => {
      const existing = asset.localPath && asset.objectKey
        ? assets.find((item) => item.projectName === asset.projectName
          && item.localPath === asset.localPath && item.objectKey === asset.objectKey)
        : null;
      if (existing) return existing;
      assets.push(asset);
      return asset;
    },
    getAsset: async (id) => assets.find((asset) => asset.id === id) || null
    ,listFolders: async () => folders
    ,createFolder: async (folder) => (folders.push(folder), folder)
    ,updateFolder: async (id, patch) => Object.assign(folders.find((folder) => folder.id === id), patch)
    ,deleteFolder: async (id) => folders.splice(folders.findIndex((folder) => folder.id === id), 1)
    ,createClient: async (client) => (clients.push(client), client)
    ,createCampaign: async (campaign) => (campaigns.push(campaign), campaign)
    ,createProject: async (project) => (projects.push(project), project)
    ,updateProject: async (name, patch) => Object.assign(projects.find((project) => project.name === name), patch)
    ,deleteProject: async (name) => projects.splice(projects.findIndex((project) => project.name === name), 1)
    ,listOrganization: async () => ({ clients, campaigns, staff: Object.values(users) })
    ,listMedia: async () => []
    ,listJobs: async () => jobs
    ,listActivity: async () => []
    ,analytics: async () => ({ totalProjects: projects.length })
    ,createRender: async (render) => (renderRecords.push(render), render)
    ,ensureRender: async (render) => {
      const id = `render:${render.assetId}`;
      const existing = renderRecords.find((item) => item.id === id);
      if (existing) return existing;
      const saved = { ...render, id };
      renderRecords.push(saved);
      return saved;
    }
    ,listIntelligence: async () => ({ campaigns: [{ id: "campaign-1", name: "Launch", intelligence: campaignIntelligence }] })
    ,campaignIntelligence: async () => campaignIntelligence
    ,upsertCampaignBrief: async (brief) => (campaignIntelligence = { ...campaignIntelligence, campaignBrief: brief }, brief)
    ,createResearchSource: async (source) => (campaignIntelligence.researchSources.push(source), source)
    ,deleteResearchSource: async (id, briefId) => {
      const index = campaignIntelligence.researchSources.findIndex((source) => source.id === id && source.briefId === briefId);
      if (index < 0) return false;
      campaignIntelligence.researchSources.splice(index, 1);
      return true;
    }
    ,upsertMarketReport: async (report) => (campaignIntelligence = { ...campaignIntelligence, marketReport: report }, report)
    ,reconcileMarketReport: async (report) => (campaignIntelligence = { ...campaignIntelligence, marketReport: report }, report)
    ,projectScriptBundle: async () => scriptBundle
    ,getProjectData: async (name, user) => {
      const project = await repository.getProject(name, user);
      return project ? { summary: { ...project, assets: assets.filter((asset) => asset.projectName === name) } } : null;
    }
    ,upsertUgcScript: async (script) => (scriptBundle.ugcScript = script, script)
    ,createScriptVersion: async (version) => (scriptBundle.scriptVersions.unshift(version), version)
    ,reconcileUgcScript: async (script, version) => {
      scriptBundle.ugcScript = script;
      const index = scriptBundle.scriptVersions.findIndex((item) => item.id === version.id);
      if (index < 0) scriptBundle.scriptVersions.unshift(version);
      else scriptBundle.scriptVersions[index] = version;
      return { script, version };
    }
    ,recordScriptReview: async (event) => (scriptBundle.scriptReviewEvents.unshift(event), event)
    ,replaceClipCandidates: async (_projectName, candidates) => {
      clipCandidates.splice(0, clipCandidates.length, ...candidates);
      return clipCandidates;
    }
    ,setSelectedHighlight: async (_project, id) => (selectedHighlight = { id, selected: true })
  };
  const media = {
    put: async (key, value) => ({ key, size: value.byteLength }),
    get: async (key) => key === "projects/alpha/final.mp4"
      ? { body: new Uint8Array([1, 2, 3]), size: 3, contentType: "video/mp4", etag: "etag-1" }
      : null,
    createMultipart: async (key) => ({ key, uploadId: "upload-1" }),
    uploadPart: async (_key, _uploadId, partNumber, bytes) => ({ partNumber, etag: `etag-${partNumber}-${bytes.byteLength}` }),
    completeMultipart: async (key, _uploadId, parts) => ({ key, parts: parts.length }),
    abortMultipart: async () => ({ ok: true })
  };
  return {
    users,
    projects,
    jobs,
    assets,
    folders,
    clients,
    campaigns,
    renderRecords,
    clipCandidates,
    repository,
    scriptBundle,
    setCampaignIntelligence: (value) => { campaignIntelligence = value; },
    app: createApp({ auth, repository, media, ...overrides })
  };
}

test("auth bootstrap is public while project data requires a valid user", async () => {
  const { app } = fixture();
  const config = await app.fetch(jsonRequest("/api/auth/config"));
  assert.equal(config.status, 200);
  assert.equal((await body(config)).required, true);

  const profile = await app.fetch(jsonRequest("/api/auth/profile"));
  assert.equal(profile.status, 401);

  const projects = await app.fetch(jsonRequest("/api/projects"));
  assert.equal(projects.status, 401);
  assert.equal((await body(projects)).error, "Login required");
});

test("decoded and repeated protected path separators cannot bypass authentication", async () => {
  const { app, assets } = fixture();
  assets.push({
    id: "asset-1",
    projectName: "alpha",
    objectKey: "projects/alpha/final.mp4",
    mediaType: "video/mp4"
  });

  const attempts = [
    "/%61pi/projects",
    "//api/projects",
    "/%6dedia/assets/asset-1",
    "//media/assets/asset-1"
  ];

  for (const path of attempts) {
    const response = await app.fetch(jsonRequest(path));
    assert.equal(response.status, 401, path);
    assert.deepEqual(await body(response), { error: "Login required" }, path);
  }
});

test("project lists and project details are filtered by role", async () => {
  const { app } = fixture();
  const staffList = await app.fetch(jsonRequest("/api/projects", { headers: { authorization: "Bearer staff" } }));
  assert.deepEqual((await body(staffList)).projects.map((project) => project.name), ["alpha"]);

  const denied = await app.fetch(jsonRequest("/api/projects/beta", { headers: { authorization: "Bearer staff" } }));
  assert.equal(denied.status, 404);

  const adminList = await app.fetch(jsonRequest("/api/projects", { headers: { authorization: "Bearer admin" } }));
  assert.deepEqual((await body(adminList)).projects.map((project) => project.name), ["alpha", "beta"]);
});

test("heavy project actions create queued jobs instead of running production in the Worker", async () => {
  const { app, jobs } = fixture();
  const response = await app.fetch(jsonRequest("/api/projects/alpha/clipper/analyze", {
    method: "POST",
    headers: { authorization: "Bearer staff" },
    body: { sourceUrl: "https://youtube.com/watch?v=test" }
  }));
  const result = await body(response);
  assert.equal(response.status, 202);
  assert.equal(result.queued, true);
  assert.equal(result.job.jobType, "clipper-analyze");
  assert.equal(jobs[0].requestedBy, "staff-1");
});

test("hosted uploads reject generic binaries and store supported media privately", async () => {
  const { app, assets } = fixture();
  const rejected = await app.fetch(jsonRequest("/api/projects/alpha/product", {
    method: "POST",
    headers: { authorization: "Bearer staff", "content-type": "application/octet-stream", "x-file-name": "product.bin" },
    body: new Uint8Array([1, 2, 3])
  }));
  assert.equal(rejected.status, 415);

  const uploaded = await app.fetch(jsonRequest("/api/projects/alpha/product", {
    method: "POST",
    headers: { authorization: "Bearer staff", "content-type": "image/png", "x-file-name": "product.png" },
    body: new Uint8Array([1, 2, 3])
  }));
  const result = await body(uploaded);
  assert.equal(uploaded.status, 201);
  assert.equal(result.asset.kind, "product-image");
  assert.match(result.asset.url, /^\/media\/assets\//);
  assert.equal(assets.length, 1);
});

test("R2 media reads require project access and return private content", async () => {
  const { app, assets } = fixture();
  assets.push({ id: "asset-1", projectName: "alpha", objectKey: "projects/alpha/final.mp4", mediaType: "video/mp4" });

  const anonymous = await app.fetch(jsonRequest("/media/assets/asset-1"));
  assert.equal(anonymous.status, 401);

  const denied = await app.fetch(jsonRequest("/media/assets/asset-1", { headers: { authorization: "Bearer client" } }));
  assert.equal(denied.status, 200, "client linked to the project may view final media");
  assert.equal(denied.headers.get("content-type"), "video/mp4");
  assert.equal((await denied.arrayBuffer()).byteLength, 3);
});

test("unsatisfiable private media ranges return HTTP 416", async () => {
  const { app, assets } = fixture({
    media: {
      get: async () => ({ rangeNotSatisfiable: true, totalSize: 10 })
    }
  });
  assets.push({ id: "asset-1", projectName: "alpha", objectKey: "projects/alpha/final.mp4", mediaType: "video/mp4" });

  const response = await app.fetch(jsonRequest("/media/assets/asset-1", {
    headers: { authorization: "Bearer staff", range: "bytes=20-30" }
  }));

  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */10");
});

test("unknown API paths never fall through to static or local handlers", async () => {
  const { app } = fixture();
  const response = await app.fetch(jsonRequest("/api/not-a-real-route", { headers: { authorization: "Bearer admin" } }));
  assert.equal(response.status, 404);
  assert.deepEqual(await body(response), { error: "API route not found" });

  const encoded = await app.fetch(jsonRequest("/api%2Fnot-a-real-route", { headers: { authorization: "Bearer admin" } }));
  assert.equal(encoded.status, 404);
  assert.deepEqual(await body(encoded), { error: "API route not found" });
});

test("staff editors cannot rewrite project ownership or assignment metadata", async () => {
  const { app, projects } = fixture();
  const response = await app.fetch(jsonRequest("/api/projects/alpha/meta", {
    method: "PUT",
    headers: { authorization: "Bearer staff" },
    body: { campaignId: "campaign-2", clientId: "client-2", assignedStaffId: "staff-2" }
  }));

  assert.equal(response.status, 403);
  assert.equal(projects[0].campaignId, "campaign-1");
  assert.equal(projects[0].clientId, "client-1");
  assert.equal(projects[0].assignedStaffId, "staff-1");
});

test("research source deletion is constrained to the campaign brief", async () => {
  const { app, setCampaignIntelligence } = fixture();
  setCampaignIntelligence({
    campaignBrief: { id: "brief-1", campaignId: "campaign-1" },
    researchSources: [{ id: "outside-source", briefId: "brief-2", name: "Other tenant" }],
    marketReport: null
  });
  const response = await app.fetch(jsonRequest("/api/campaigns/campaign-1/research-sources/outside-source", {
    method: "DELETE",
    headers: { authorization: "Bearer staff" }
  }));

  assert.equal(response.status, 404);
});

test("admin management CRUD persists typed projects and folders", async () => {
  const { app, projects, folders, clients, campaigns } = fixture();
  const headers = { authorization: "Bearer admin" };

  const client = await app.fetch(jsonRequest("/api/clients", { method: "POST", headers, body: { name: "Digital Bee" } }));
  assert.equal(client.status, 201);
  assert.equal(clients.length, 1);

  const campaign = await app.fetch(jsonRequest("/api/campaigns", { method: "POST", headers, body: { name: "Launch", clientId: clients[0].id } }));
  assert.equal(campaign.status, 201);
  assert.equal(campaigns.length, 1);

  const folder = await app.fetch(jsonRequest("/api/folders", { method: "POST", headers, body: { name: "Q3 Content" } }));
  assert.equal(folder.status, 201);
  assert.equal(folders[0].name, "Q3 Content");

  const created = await app.fetch(jsonRequest("/api/projects", {
    method: "POST",
    headers,
    body: { name: "Summer Launch", type: "auto-clipper", folderId: folders[0].id, assignedStaffId: "staff-1" }
  }));
  assert.equal(created.status, 201);
  assert.equal((await body(created)).project.name, "summer-launch");
  assert.equal(projects.at(-1).type, "auto-clipper");

  const updated = await app.fetch(jsonRequest("/api/projects/summer-launch/meta", {
    method: "PUT",
    headers,
    body: { priority: "high", approvalStatus: "internal-review" }
  }));
  assert.equal(updated.status, 200);
  assert.equal(projects.at(-1).priority, "high");

  const deleted = await app.fetch(jsonRequest("/api/projects/summer-launch", { method: "DELETE", headers }));
  assert.equal(deleted.status, 200);
  assert.equal(projects.some((project) => project.name === "summer-launch"), false);
});

test("non-admin users cannot create organization records", async () => {
  const { app } = fixture();
  const response = await app.fetch(jsonRequest("/api/clients", {
    method: "POST",
    headers: { authorization: "Bearer staff" },
    body: { name: "Blocked client" }
  }));
  assert.equal(response.status, 403);
  assert.equal((await body(response)).error, "Admin access required");
});

test("internal production asset transfer is token protected and stored in private R2", async () => {
  const { app, assets, renderRecords } = fixture({ internalToken: "worker-secret" });
  const path = "/internal/projects/alpha/assets/renders/final.mp4";

  const blocked = await app.fetch(jsonRequest(path, {
    method: "PUT",
    headers: { "content-type": "video/mp4" },
    body: new Uint8Array([1, 2, 3])
  }));
  assert.equal(blocked.status, 401);

  const uploaded = await app.fetch(jsonRequest(path, {
    method: "PUT",
    headers: { authorization: "Bearer worker-secret", "content-type": "video/mp4", "x-asset-kind": "final-render" },
    body: new Uint8Array([1, 2, 3])
  }));
  assert.equal(uploaded.status, 201);
  const asset = (await body(uploaded)).asset;
  assert.equal(asset.kind, "final-render");
  assert.equal(assets.at(-1).objectKey, `objects/sha256/${"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"}.mp4`);
  assert.equal(assets.at(-1).localPath, "renders/final.mp4");
  assert.equal(assets.at(-1).checksum, "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  assert.equal(renderRecords.length, 1);
  assert.equal(renderRecords[0].outputUrl, asset.url);
});

test("internal direct uploads are content-addressed and idempotent", async () => {
  const { app, assets, renderRecords } = fixture({ internalToken: "worker-secret" });
  const upload = () => app.fetch(jsonRequest("/internal/projects/alpha/assets/renders/final.mp4", {
    method: "PUT",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "video/mp4",
      "x-asset-kind": "final-render"
    },
    body: new Uint8Array([1, 2, 3])
  }));

  const first = await upload();
  const second = await upload();
  const firstBody = await body(first);
  const secondBody = await body(second);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(secondBody.asset.id, firstBody.asset.id);
  assert.equal(assets.length, 1);
  assert.equal(renderRecords.length, 1);
});

test("retrying an idempotent asset registration repairs a prior render write failure exactly once", async () => {
  const { app, assets, renderRecords, repository } = fixture({ internalToken: "worker-secret" });
  let failRender = true;
  const registerRender = async (render) => {
    if (failRender) {
      failRender = false;
      throw new Error("injected render write failure");
    }
    const id = `render:${render.assetId}`;
    const existing = renderRecords.find((item) => item.id === id);
    if (existing) return existing;
    const saved = { ...render, id };
    renderRecords.push(saved);
    return saved;
  };
  repository.createRender = registerRender;
  repository.ensureRender = registerRender;
  const upload = () => app.fetch(jsonRequest("/internal/projects/alpha/assets/renders/final.mp4", {
    method: "PUT",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "video/mp4",
      "x-asset-kind": "final-render"
    },
    body: new Uint8Array([1, 2, 3])
  }));

  const failed = await upload();
  assert.equal(failed.status, 500);
  assert.equal(assets.length, 1);
  assert.equal(renderRecords.length, 0);

  const repaired = await upload();
  const replayed = await upload();
  assert.equal(repaired.status, 200);
  assert.equal(replayed.status, 200);
  assert.equal(assets.length, 1);
  assert.equal(renderRecords.length, 1);
  assert.equal(renderRecords[0].assetId, assets[0].id);
});

test("internal multipart registration is token protected and records an existing R2 render", async () => {
  const checksum = "a".repeat(64);
  const objectKey = `objects/sha256/${checksum}.mp4`;
  const media = {
    head: async (key) => key === objectKey ? { size: 7, contentType: "video/mp4", etag: "etag-large" } : null
  };
  const { app, assets, renderRecords } = fixture({ internalToken: "worker-secret", media });
  const path = "/internal/projects/alpha/assets/register";
  const registration = {
    assetPath: "renders/final video.mp4",
    objectKey,
    contentType: "video/mp4",
    kind: "final-render",
    sizeBytes: 7,
    checksum
  };

  const blocked = await app.fetch(jsonRequest(path, { method: "POST", body: registration }));
  assert.equal(blocked.status, 401);

  const response = await app.fetch(jsonRequest(path, {
    method: "POST",
    headers: { authorization: "Bearer worker-secret" },
    body: registration
  }));
  const result = await body(response);

  assert.equal(response.status, 201);
  assert.equal(result.asset.projectName, "alpha");
  assert.equal(result.asset.kind, "final-render");
  assert.equal(result.asset.name, "renders/final-video.mp4");
  assert.equal(result.asset.objectKey, objectKey);
  assert.equal(result.asset.sizeBytes, 7);
  assert.equal(result.asset.checksum, checksum);
  assert.match(result.asset.url, /^\/media\/assets\//);
  assert.deepEqual(assets.at(-1), result.asset);
  assert.equal(renderRecords.length, 1);
  assert.equal(renderRecords[0].outputPath, "renders/final-video.mp4");
  assert.equal(renderRecords[0].objectKey, objectKey);
  assert.equal(renderRecords[0].outputUrl, result.asset.url);
});

test("internal multipart registration is idempotent for the same project path and object", async () => {
  const checksum = "d".repeat(64);
  const objectKey = `objects/sha256/${checksum}.mp4`;
  const media = { head: async () => ({ size: 7, contentType: "video/mp4" }) };
  const { app, assets, renderRecords } = fixture({ internalToken: "worker-secret", media });
  const request = () => jsonRequest("/internal/projects/alpha/assets/register", {
    method: "POST",
    headers: { authorization: "Bearer worker-secret" },
    body: {
      assetPath: "renders/final.mp4", objectKey, contentType: "video/mp4",
      kind: "final-render", sizeBytes: 7, checksum
    }
  });

  const first = await app.fetch(request());
  const second = await app.fetch(request());
  const firstBody = await body(first);
  const secondBody = await body(second);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(secondBody.asset.id, firstBody.asset.id);
  assert.equal(assets.length, 1);
  assert.equal(renderRecords.length, 1);
});

test("internal multipart registration validates project, key, path, metadata, size, checksum, and R2 head", async () => {
  const checksum = "b".repeat(64);
  const objectKey = `objects/sha256/${checksum}.mp4`;
  const valid = {
    assetPath: "renders/final.mp4",
    objectKey,
    contentType: "video/mp4",
    kind: "final-render",
    sizeBytes: 7,
    checksum
  };
  const cases = [
    { name: "missing project", project: "missing", patch: {}, expectedStatus: 404 },
    { name: "invalid object key", project: "alpha", patch: { objectKey: "projects/alpha/final.mp4" }, expectedStatus: 400 },
    { name: "unsafe path", project: "alpha", patch: { assetPath: "../final.mp4" }, expectedStatus: 400 },
    { name: "invalid content type", project: "alpha", patch: { contentType: "video mp4" }, expectedStatus: 400 },
    { name: "invalid kind", project: "alpha", patch: { kind: "Final Render" }, expectedStatus: 400 },
    { name: "invalid size", project: "alpha", patch: { sizeBytes: 0 }, expectedStatus: 400 },
    { name: "invalid checksum", project: "alpha", patch: { checksum: "B".repeat(64) }, expectedStatus: 400 },
    { name: "checksum key mismatch", project: "alpha", patch: { checksum: "c".repeat(64) }, expectedStatus: 400 },
    { name: "missing object", project: "alpha", patch: {}, expectedStatus: 404, head: null },
    { name: "size mismatch", project: "alpha", patch: {}, expectedStatus: 409, head: { size: 8, contentType: "video/mp4" } },
    { name: "content type mismatch", project: "alpha", patch: {}, expectedStatus: 409, head: { size: 7, contentType: "application/octet-stream" } }
  ];

  for (const item of cases) {
    const media = { head: async () => item.head === undefined ? { size: 7, contentType: "video/mp4" } : item.head };
    const { app, assets, renderRecords } = fixture({ internalToken: "worker-secret", media });
    const response = await app.fetch(jsonRequest(`/internal/projects/${item.project}/assets/register`, {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
      body: { ...valid, ...item.patch }
    }));
    assert.equal(response.status, item.expectedStatus, item.name);
    assert.equal(assets.length, 0, `${item.name} must not create an asset`);
    assert.equal(renderRecords.length, 0, `${item.name} must not create a render`);
  }
});

test("internal project context is token protected and uses an Admin-scoped D1 view", async () => {
  const { app, assets, scriptBundle, setCampaignIntelligence } = fixture({ internalToken: "worker-secret" });
  assets.push({
    id: "asset-source",
    projectName: "alpha",
    kind: "reference-video",
    name: "reference.mp4",
    objectKey: "projects/alpha/reference/source.mp4"
  });
  setCampaignIntelligence({
    campaignBrief: { id: "brief-1", campaignId: "campaign-1", brief: { product: "Bee Phone" } },
    researchSources: [{ id: "source-1", content: "Fast setup" }],
    marketReport: { id: "report-1", status: "approved" }
  });
  scriptBundle.ugcScript = { id: "script-1", versionId: "version-2", status: "approved" };

  const blocked = await app.fetch(jsonRequest("/internal/projects/alpha/context"));
  assert.equal(blocked.status, 401);

  const response = await app.fetch(jsonRequest("/internal/projects/alpha/context", {
    headers: { authorization: "Bearer worker-secret" }
  }));
  assert.equal(response.status, 200);
  const context = await body(response);
  assert.equal(context.project.name, "alpha");
  assert.deepEqual(context.assets, assets);
  assert.equal(context.campaignIntelligence.marketReport.id, "report-1");
  assert.equal(context.scriptBundle.ugcScript.versionId, "version-2");
});

test("internal asset download resolves the R2 object by protected D1 asset ID", async () => {
  const { app, assets } = fixture({ internalToken: "worker-secret" });
  assets.push({
    id: "asset-1",
    projectName: "alpha",
    kind: "reference-video",
    name: "reference.mp4",
    objectKey: "projects/alpha/final.mp4",
    mediaType: "video/mp4"
  });

  const blocked = await app.fetch(jsonRequest("/internal/assets/asset-1"));
  assert.equal(blocked.status, 401);

  const response = await app.fetch(jsonRequest("/internal/assets/asset-1", {
    headers: { authorization: "Bearer worker-secret" }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]));
});

test("internal R2 object metadata lookup is token protected and does not require a D1 asset row", async () => {
  const objectKey = `objects/sha256/${"b".repeat(64)}.mp4`;
  const { app } = fixture({
    internalToken: "worker-secret",
    media: {
      head: async (key) => key === objectKey
        ? { size: 321, contentType: "video/mp4", etag: "etag-head" }
        : null
    }
  });
  const path = `/internal/r2/object?key=${encodeURIComponent(objectKey)}`;

  const blocked = await app.fetch(jsonRequest(path, { method: "HEAD" }));
  assert.equal(blocked.status, 401);

  const response = await app.fetch(jsonRequest(path, {
    method: "HEAD",
    headers: { authorization: "Bearer worker-secret" }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "321");
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("etag"), "etag-head");
});

test("market intelligence CRUD and generation use D1 state plus the production queue", async () => {
  const { app, jobs } = fixture();
  const headers = { authorization: "Bearer staff" };
  const saved = await app.fetch(jsonRequest("/api/campaigns/campaign-1/brief", {
    method: "PUT", headers, body: { title: "Product launch", productName: "Bee Phone" }
  }));
  assert.equal(saved.status, 200);

  const source = await app.fetch(jsonRequest("/api/campaigns/campaign-1/research-sources/text", {
    method: "POST", headers, body: { name: "Interviews", content: "Customers want a simpler setup." }
  }));
  assert.equal(source.status, 201);

  const generated = await app.fetch(jsonRequest("/api/campaigns/campaign-1/market-reports/generate", {
    method: "POST", headers, body: { sourceIds: [] }
  }));
  assert.equal(generated.status, 202);
  assert.equal(jobs.at(-1).jobType, "generate-market-report");

  const detail = await app.fetch(jsonRequest("/api/campaigns/campaign-1/intelligence", { headers }));
  assert.equal(detail.status, 200);
  assert.equal((await body(detail)).researchSources.length, 1);
});

test("nested UGC script actions enqueue the correct production jobs", async () => {
  const { app, jobs } = fixture();
  const headers = { authorization: "Bearer staff" };
  const analyzed = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/analyze", {
    method: "POST", headers, body: { manualTranscript: "This changed my routine." }
  }));
  const generated = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/generate", {
    method: "POST", headers, body: { marketReportId: "report-1" }
  }));
  assert.equal(analyzed.status, 202);
  assert.equal(generated.status, 202);
  assert.deepEqual(jobs.slice(-2).map((job) => job.jobType), ["analyze-ugc-script", "generate-ugc-script"]);
});

test("clipper active highlight selection persists instead of becoming a no-op", async () => {
  const { app } = fixture();
  const response = await app.fetch(jsonRequest("/api/projects/alpha/clipper/select-highlight", {
    method: "POST",
    headers: { authorization: "Bearer staff" },
    body: { highlightId: "h-1" }
  }));
  assert.equal(response.status, 200);
  assert.equal((await body(response)).selection.id, "h-1");
});

test("UGC production requires approval and script review is audited", async () => {
  const { app, jobs, scriptBundle } = fixture();
  const staffHeaders = { authorization: "Bearer staff" };
  scriptBundle.ugcScript = {
    id: "script-1", projectName: "alpha", campaignId: "campaign-1", status: "draft",
    versionId: "version-1", currentVersionNumber: 1, hooks: [{ id: "hook-1", text: "Wait" }], scenes: []
  };
  scriptBundle.scriptVersions.push({ id: "version-1", versionNumber: 1, content: scriptBundle.ugcScript });

  const blocked = await app.fetch(jsonRequest("/api/projects/alpha/generate-ugc-video", {
    method: "POST", headers: staffHeaders, body: {}
  }));
  assert.equal(blocked.status, 409);

  const blockedStaffApproval = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: staffHeaders, body: { status: "approved", feedback: "Ready" }
  }));
  assert.equal(blockedStaffApproval.status, 403);

  const internalReview = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: staffHeaders, body: { status: "internal-review", feedback: "Internally checked" }
  }));
  assert.equal(internalReview.status, 200);

  const submitted = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: staffHeaders, body: { status: "client-review", feedback: "Ready for client" }
  }));
  assert.equal(submitted.status, 200);

  const reviewed = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: { authorization: "Bearer client" }, body: { status: "approved", feedback: "Approved" }
  }));
  assert.equal(reviewed.status, 200);
  assert.equal(scriptBundle.scriptReviewEvents.length, 3);

  const queued = await app.fetch(jsonRequest("/api/projects/alpha/generate-ugc-video", {
    method: "POST", headers: staffHeaders, body: {}
  }));
  assert.equal(queued.status, 202);
  assert.equal(jobs.at(-1).payload.scriptVersionId, "version-1");
});

test("UGC script review rejects client approval before client review", async () => {
  const { app, scriptBundle } = fixture();
  scriptBundle.ugcScript = {
    id: "script-1", projectName: "alpha", status: "draft", versionId: "version-1"
  };

  const draftApproval = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST",
    headers: { authorization: "Bearer client" },
    body: { status: "approved", feedback: "Skipping the editors" }
  }));
  assert.equal(draftApproval.status, 409);
  assert.equal(scriptBundle.ugcScript.status, "draft");
  assert.equal(scriptBundle.scriptReviewEvents.length, 0);

  scriptBundle.ugcScript.status = "internal-review";
  const internalApproval = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST",
    headers: { authorization: "Bearer client" },
    body: { status: "approved", feedback: "Still skipping client review" }
  }));
  assert.equal(internalApproval.status, 409);
  assert.equal(scriptBundle.ugcScript.status, "internal-review");
  assert.equal(scriptBundle.scriptReviewEvents.length, 0);
});

test("UGC script review enforces editor sequence and changes-requested recovery", async () => {
  const { app, scriptBundle } = fixture();
  const staffHeaders = { authorization: "Bearer staff" };
  scriptBundle.ugcScript = {
    id: "script-1", projectName: "alpha", status: "draft", versionId: "version-1"
  };

  const skippedInternalReview = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: staffHeaders, body: { status: "client-review" }
  }));
  assert.equal(skippedInternalReview.status, 409);
  assert.equal(scriptBundle.ugcScript.status, "draft");

  scriptBundle.ugcScript.status = "changes-requested";
  const returnedToDraft = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: staffHeaders, body: { status: "draft", feedback: "Starting revisions" }
  }));
  assert.equal(returnedToDraft.status, 200);

  scriptBundle.ugcScript.status = "changes-requested";
  const returnedToInternalReview = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: staffHeaders, body: { status: "internal-review", feedback: "Revision is ready" }
  }));
  assert.equal(returnedToInternalReview.status, 200);
});

test("UGC script review requires and audits an explicit admin override", async () => {
  const { app, scriptBundle } = fixture();
  const adminHeaders = { authorization: "Bearer admin" };
  scriptBundle.ugcScript = {
    id: "script-1", projectName: "alpha", status: "draft", versionId: "version-1"
  };

  const implicitOverride = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: adminHeaders, body: { status: "approved" }
  }));
  assert.equal(implicitOverride.status, 409);
  assert.equal(scriptBundle.ugcScript.status, "draft");
  assert.equal(scriptBundle.scriptReviewEvents.length, 0);

  const blankOverride = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST", headers: adminHeaders, body: { status: "approved", overrideReason: "   " }
  }));
  assert.equal(blankOverride.status, 409);
  assert.equal(scriptBundle.scriptReviewEvents.length, 0);

  const explicitOverride = await app.fetch(jsonRequest("/api/projects/alpha/ugc-script/review", {
    method: "POST",
    headers: adminHeaders,
    body: { status: "approved", feedback: "Emergency release", overrideReason: "Legal approval recorded offline" }
  }));
  assert.equal(explicitOverride.status, 200);
  assert.equal(scriptBundle.ugcScript.status, "approved");
  assert.equal(scriptBundle.scriptReviewEvents.length, 1);
  assert.equal(scriptBundle.scriptReviewEvents[0].overridden, true);
  assert.equal(scriptBundle.scriptReviewEvents[0].overrideReason, "Legal approval recorded offline");
  assert.equal(scriptBundle.scriptReviewEvents[0].actorId, "admin-1");
});

test("project approval separates internal staff review from client final decisions", async () => {
  const { app, projects } = fixture();

  const staffFinal = await app.fetch(jsonRequest("/api/projects/alpha/meta", {
    method: "PUT",
    headers: { authorization: "Bearer staff" },
    body: { approvalStatus: "approved", approvalFeedback: "Ship it" }
  }));
  assert.equal(staffFinal.status, 403);

  const staffInternal = await app.fetch(jsonRequest("/api/projects/alpha/meta", {
    method: "PUT",
    headers: { authorization: "Bearer staff" },
    body: { approvalStatus: "client-review", approvalFeedback: "Ready for client" }
  }));
  assert.equal(staffInternal.status, 200);

  const clientFinal = await app.fetch(jsonRequest("/api/projects/alpha/meta", {
    method: "PUT",
    headers: { authorization: "Bearer client" },
    body: { approvalStatus: "approved", approvalFeedback: "Approved" }
  }));
  assert.equal(clientFinal.status, 200);
  assert.equal(projects[0].approvalStatus, "approved");

  const clientInternal = await app.fetch(jsonRequest("/api/projects/alpha/meta", {
    method: "PUT",
    headers: { authorization: "Bearer client" },
    body: { approvalStatus: "internal-review" }
  }));
  assert.equal(clientInternal.status, 403);
});

test("completed local-worker results reconcile structured market reports into D1", async () => {
  const { app, jobs } = fixture({ internalToken: "worker-secret" });
  jobs.push({
    id: "job-market", projectName: "alpha", jobType: "generate-market-report", status: "queued",
    payload: { campaignId: "campaign-1" }, requestedBy: "staff-1"
  });
  const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  const claim = await app.fetch(jsonRequest("/internal/jobs/claim", { method: "POST", headers, body: { workerId: "test" } }));
  const claimed = (await body(claim)).job;
  const completed = await app.fetch(jsonRequest("/internal/jobs/job-market", {
    method: "PATCH",
    headers,
    body: {
      status: "completed",
      leaseToken: claimed.leaseToken,
      result: { id: "report-1", briefId: "brief-1", campaignId: "campaign-1", status: "ready", report: { angle: "simple" } }
    }
  }));
  assert.equal(completed.status, 200);
  const intelligence = await app.fetch(jsonRequest("/api/campaigns/campaign-1/intelligence", { headers: { authorization: "Bearer staff" } }));
  assert.equal((await body(intelligence)).marketReport.id, "report-1");
});

test("market report reconciliation failure leaves the production job processing", async () => {
  const { app, jobs, repository } = fixture({ internalToken: "worker-secret" });
  jobs.push({
    id: "job-market-fault", projectName: "alpha", jobType: "generate-market-report", status: "queued",
    payload: { campaignId: "campaign-1" }, requestedBy: "staff-1"
  });
  repository.reconcileMarketReport = async () => {
    throw new Error("injected market report write failure");
  };
  const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  const claim = await app.fetch(jsonRequest("/internal/jobs/claim", { method: "POST", headers, body: { workerId: "test" } }));
  const claimed = (await body(claim)).job;

  const response = await app.fetch(jsonRequest("/internal/jobs/job-market-fault", {
    method: "PATCH",
    headers,
    body: {
      status: "completed",
      leaseToken: claimed.leaseToken,
      result: { id: "report-fault", briefId: "brief-1", campaignId: "campaign-1", report: { angle: "simple" } }
    }
  }));

  assert.equal(response.status, 500);
  assert.equal(jobs[0].status, "processing");
});

test("atomic UGC reconciliation exposes no partial state and completes idempotently on retry", async () => {
  const { app, jobs, repository, scriptBundle } = fixture({ internalToken: "worker-secret" });
  jobs.push({
    id: "job-script-fault", projectName: "alpha", jobType: "generate-ugc-script", status: "queued",
    payload: {}, requestedBy: "staff-1"
  });
  let failReconcile = true;
  repository.reconcileUgcScript = async (script, version) => {
    if (failReconcile) {
      failReconcile = false;
      throw new Error("injected atomic script batch failure");
    }
    scriptBundle.ugcScript = script;
    if (!scriptBundle.scriptVersions.some((item) => item.id === version.id)) {
      scriptBundle.scriptVersions.push(version);
    }
    return { script, version };
  };
  const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  const claim = await app.fetch(jsonRequest("/internal/jobs/claim", { method: "POST", headers, body: { workerId: "test" } }));
  const claimed = (await body(claim)).job;

  const response = await app.fetch(jsonRequest("/internal/jobs/job-script-fault", {
    method: "PATCH",
    headers,
    body: {
      status: "completed",
      leaseToken: claimed.leaseToken,
      result: {
        script: { id: "script-fault", projectName: "alpha", title: "Draft" },
        version: { id: "version-fault", scriptId: "script-fault", versionNumber: 1, content: { scenes: [] } }
      }
    }
  }));

  assert.equal(response.status, 500);
  assert.equal(scriptBundle.ugcScript, null);
  assert.equal(scriptBundle.scriptVersions.length, 0);
  assert.equal(jobs[0].status, "processing");

  const retried = await app.fetch(jsonRequest("/internal/jobs/job-script-fault", {
    method: "PATCH",
    headers,
    body: {
      status: "completed",
      leaseToken: claimed.leaseToken,
      result: {
        script: { id: "script-fault", projectName: "alpha", title: "Draft" },
        version: { id: "version-fault", scriptId: "script-fault", versionNumber: 1, content: { scenes: [] } }
      }
    }
  }));

  assert.equal(retried.status, 200);
  assert.equal(scriptBundle.ugcScript.id, "script-fault");
  assert.equal(scriptBundle.scriptVersions.length, 1);
  assert.equal(jobs[0].status, "completed");
});

test("structured production jobs cannot complete without their required result", async () => {
  const structuredJobTypes = ["generate-market-report", "generate-ugc-script", "clipper-analyze"];
  for (const [index, jobType] of structuredJobTypes.entries()) {
    const { app, jobs } = fixture({ internalToken: "worker-secret" });
    const id = `job-missing-result-${index}`;
    jobs.push({ id, projectName: "alpha", jobType, status: "queued", payload: {}, requestedBy: "staff-1" });
    const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
    const claim = await app.fetch(jsonRequest("/internal/jobs/claim", { method: "POST", headers, body: { workerId: "test" } }));
    const claimed = (await body(claim)).job;

    const response = await app.fetch(jsonRequest(`/internal/jobs/${id}`, {
      method: "PATCH", headers, body: { status: "completed", leaseToken: claimed.leaseToken }
    }));

    assert.equal(response.status, 400, jobType);
    assert.equal(jobs[0].status, "processing", jobType);
  }
});

test("large R2 objects use the protected multipart channel", async () => {
  const { app } = fixture({ internalToken: "worker-secret" });
  const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  const objectKey = `objects/sha256/${"a".repeat(64)}.mp4`;
  const started = await app.fetch(jsonRequest("/internal/r2/multipart/start", {
    method: "POST", headers, body: { key: objectKey, contentType: "video/mp4" }
  }));
  assert.equal(started.status, 201);
  const uploadId = (await body(started)).uploadId;

  const part = await app.fetch(jsonRequest(`/internal/r2/multipart/part?key=${encodeURIComponent(objectKey)}&uploadId=${uploadId}&partNumber=1`, {
    method: "PUT",
    headers: { authorization: "Bearer worker-secret", "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3])
  }));
  const partData = await body(part);
  assert.equal(part.status, 200);
  assert.equal(partData.etag, "etag-1-3");
  assert.equal(partData.sizeBytes, 3);

  const completed = await app.fetch(jsonRequest("/internal/r2/multipart/complete", {
    method: "POST", headers, body: { key: objectKey, uploadId, parts: [partData] }
  }));
  assert.equal(completed.status, 200);
});

test("multipart completion rejects R2-incompatible non-final part sizes", async () => {
  const { app } = fixture({ internalToken: "worker-secret" });
  const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  const key = `objects/sha256/${"e".repeat(64)}.mp4`;
  const mib = 1024 * 1024;
  const cases = [
    {
      name: "non-final part below five MiB",
      parts: [
        { partNumber: 1, etag: "etag-1", sizeBytes: 4 * mib },
        { partNumber: 2, etag: "etag-2", sizeBytes: 1 * mib }
      ]
    },
    {
      name: "non-final parts have unequal sizes",
      parts: [
        { partNumber: 1, etag: "etag-1", sizeBytes: 6 * mib },
        { partNumber: 2, etag: "etag-2", sizeBytes: 5 * mib },
        { partNumber: 3, etag: "etag-3", sizeBytes: 1 * mib }
      ]
    }
  ];

  for (const item of cases) {
    const response = await app.fetch(jsonRequest("/internal/r2/multipart/complete", {
      method: "POST", headers, body: { key, uploadId: "upload-1", parts: item.parts }
    }));
    assert.equal(response.status, 400, item.name);
  }

  const valid = await app.fetch(jsonRequest("/internal/r2/multipart/complete", {
    method: "POST",
    headers,
    body: {
      key,
      uploadId: "upload-1",
      parts: [
        { partNumber: 1, etag: "etag-1", sizeBytes: 5 * mib },
        { partNumber: 2, etag: "etag-2", sizeBytes: 1 * mib }
      ]
    }
  }));
  assert.equal(valid.status, 200);
});

test("encoded slashes stay inside one decoded route segment", async () => {
  const { app, assets } = fixture({ internalToken: "worker-secret" });
  assets.push({ id: "asset/opaque", objectKey: "projects/alpha/final.mp4", mediaType: "video/mp4" });

  const response = await app.fetch(jsonRequest("/internal/assets/asset%2Fopaque", {
    headers: { authorization: "Bearer worker-secret" }
  }));

  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get("content-length")), 3);
});

test("multipart uploads reject arbitrary R2 keys", async () => {
  const { app } = fixture({ internalToken: "worker-secret" });
  const headers = { authorization: "Bearer worker-secret", "content-type": "application/json" };
  const response = await app.fetch(jsonRequest("/internal/r2/multipart/start", {
    method: "POST",
    headers,
    body: { key: "large.mp4", contentType: "video/mp4" }
  }));

  assert.equal(response.status, 400);

  const complete = await app.fetch(jsonRequest("/internal/r2/multipart/complete", {
    method: "POST",
    headers,
    body: { key: "large.mp4", uploadId: "unsafe-upload", parts: [{ partNumber: 1, etag: "etag" }] }
  }));
  assert.equal(complete.status, 400);
});
