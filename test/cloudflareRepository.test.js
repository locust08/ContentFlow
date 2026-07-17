import assert from "node:assert/strict";
import test from "node:test";

import { createD1Repository, createRepository } from "../cloudflare/worker/repository.js";

function fakeDb(respond) {
  const calls = [];
  return {
    calls,
    async batch(statements) {
      const results = [];
      for (const prepared of statements) {
        const call = { sql: prepared.sql, bindings: prepared.bindings, method: "batch" };
        calls.push(call);
        const row = await respond(call);
        results.push({ success: true, results: row ? [row] : [] });
      }
      return results;
    },
    prepare(sql) {
      const statement = {
        sql: sql.replace(/\s+/g, " ").trim(),
        bindings: [],
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },
        async all() {
          const call = { sql: this.sql, bindings: this.bindings, method: "all" };
          calls.push(call);
          const result = await respond(call);
          return result?.results ? result : { results: result || [] };
        },
        async first() {
          const call = { sql: this.sql, bindings: this.bindings, method: "first" };
          calls.push(call);
          return (await respond(call)) || null;
        }
      };
      return statement;
    }
  };
}

function transactionalDb(seed, execute) {
  const state = structuredClone(seed);
  const calls = [];
  let faultAt = -1;
  return {
    state,
    calls,
    failAt(index) {
      faultAt = index;
    },
    clearFault() {
      faultAt = -1;
    },
    prepare(sql) {
      return {
        sql: sql.replace(/\s+/g, " ").trim(),
        bindings: [],
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        }
      };
    },
    async batch(statements) {
      const staged = structuredClone(state);
      const results = [];
      for (const [index, prepared] of statements.entries()) {
        const call = { sql: prepared.sql, bindings: prepared.bindings, method: "batch", index };
        calls.push(call);
        if (index === faultAt) throw new Error(`injected batch failure at statement ${index}`);
        const row = await execute(staged, call);
        results.push({ success: true, results: row ? [row] : [] });
      }
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, staged);
      return results;
    }
  };
}

const projectRow = {
  name: "launch",
  type: "ai-generator",
  folder_id: "folder-1",
  client_id: "client-1",
  campaign_id: "campaign-1",
  assigned_staff_id: "staff-1",
  reviewer_id: "reviewer-1",
  priority: "high",
  approval_status: "client-review",
  approval_feedback: "Tighten the ending",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-02T00:00:00.000Z",
  reference_count: 1,
  product_count: 1,
  character_count: 0,
  image_count: 3,
  video_count: 2,
  audio_count: 1,
  render_count: 4,
  ugc_count: 1,
  market_report_count: 1,
  script_count: 1,
  script_status: "approved",
  clipper_source_count: 0,
  clip_candidate_count: 2,
  reaction_count: 1,
  clip_render_count: 1
};

test("exports the D1 repository factory under the Worker-facing alias", () => {
  assert.equal(createRepository, createD1Repository);
});

test("accepts the DB binding shape used by the Worker entry point", async () => {
  const db = fakeDb(async () => []);
  const repository = createRepository(db);

  assert.deepEqual(await repository.listProjects({ role: "admin" }), []);
  assert.equal(db.calls.length, 1);
});

test("listProjects applies role filters in D1 and maps project summaries", async () => {
  const db = fakeDb(async () => [projectRow]);
  const repository = createD1Repository({ DB: db });

  const staffProjects = await repository.listProjects({ id: "staff-1", role: "staff-editor" });
  const clientProjects = await repository.listProjects({ id: "reviewer-1", clientId: "client-1", role: "manager-client" });
  const adminProjects = await repository.listProjects({ id: "admin-1", role: "admin" });

  assert.deepEqual(staffProjects[0], {
    name: "launch",
    type: "ai-generator",
    folderId: "folder-1",
    clientId: "client-1",
    campaignId: "campaign-1",
    assignedStaffId: "staff-1",
    reviewerId: "reviewer-1",
    priority: "high",
    approvalStatus: "client-review",
    approvalFeedback: "Tighten the ending",
    reviewSubmittedAt: "",
    reviewedAt: "",
    hasReference: true,
    hasProduct: true,
    hasCharacter: false,
    frameCount: 0,
    imageCount: 3,
    videoCount: 2,
    audioCount: 1,
    renderCount: 4,
    hasStyleAnalysis: false,
    hasReferenceBlueprint: false,
    hasUgcVideo: true,
    hasGeneratedTranscript: false,
    hasSubtitlePlan: false,
    hasGeneratedPlan: false,
    hasMarketReport: true,
    hasUgcScript: true,
    scriptStatus: "approved",
    hasClipperSource: false,
    hasClipperTranscript: false,
    hasClipperHighlights: true,
    hasClipperSelection: false,
    hasClipperReaction: true,
    hasClipperRender: true,
    assets: [],
    clipCandidates: []
  });
  assert.match(db.calls[0].sql, /p\.assigned_staff_id = \?/i);
  assert.deepEqual(db.calls[0].bindings, ["staff-1"]);
  assert.match(db.calls[1].sql, /p\.client_id = \?.*p\.reviewer_id = \?/i);
  assert.deepEqual(db.calls[1].bindings, ["client-1", "reviewer-1"]);
  assert.doesNotMatch(db.calls[2].sql, /assigned_staff_id = \?|client_id = \?/i);
  assert.deepEqual(adminProjects, staffProjects);
  assert.deepEqual(clientProjects, staffProjects);
});

test("getProject applies the same role boundary without loading an unrestricted list", async () => {
  const db = fakeDb(async ({ bindings }) => bindings.includes("missing") ? null : projectRow);
  const repository = createD1Repository({ DB: db });

  const project = await repository.getProject("launch", {
    id: "reviewer-1",
    clientId: "client-1",
    role: "manager-client"
  });
  const missing = await repository.getProject("missing", { id: "staff-1", role: "staff-editor" });

  assert.equal(project.name, "launch");
  assert.equal(missing, null);
  assert.match(db.calls[0].sql, /p\.name = \?/i);
  assert.deepEqual(db.calls[0].bindings, ["launch", "client-1", "reviewer-1"]);
  assert.deepEqual(db.calls[1].bindings, ["missing", "staff-1"]);
});

test("missing repository identity is denied by default", async () => {
  const db = fakeDb(async ({ sql, method }) => /1 = 0/.test(sql)
    ? (method === "first" ? null : [])
    : [projectRow]);
  const repository = createD1Repository({ DB: db });

  assert.deepEqual(await repository.listProjects(null), []);
  assert.equal(await repository.getProject("launch", null), null);
  assert.match(db.calls[0].sql, /WHERE 1 = 0/i);
  assert.match(db.calls[1].sql, /p\.name = \? AND 1 = 0/i);
});

test("creates, lists, and lease-guards production job updates with safe JSON mapping", async () => {
  const rows = {
    insert: {
      id: "job-1", project_name: "launch", job_type: "generate-content", status: "queued",
      payload: "{\"prompt\":\"hello\"}", requested_by: "staff-1", result: "{}",
      created_at: "created", started_at: null, completed_at: null, updated_at: "created"
    },
    update: {
      id: "job-1", project_name: "launch", job_type: "generate-content", status: "completed",
      payload: "not-json", requested_by: "staff-1", output_url: "https://media.test/final.mp4",
      result: "{\"assetId\":\"asset-1\"}", error: null, lease_token: "lease-1",
      created_at: "created", started_at: "started", completed_at: "completed", updated_at: "completed"
    }
  };
  const db = fakeDb(async ({ sql, method }) => {
    if (/^INSERT INTO cf_production_jobs/i.test(sql)) return rows.insert;
    if (/^UPDATE cf_production_jobs/i.test(sql)) return rows.update;
    if (method === "all") return [rows.update, { ...rows.update, id: "job-2", result: "[invalid" }];
    return null;
  });
  const repository = createD1Repository({ DB: db });

  const created = await repository.createJob({
    id: "job-1",
    projectName: "launch",
    jobType: "generate-content",
    payload: { prompt: "hello" },
    requestedBy: "staff-1"
  });
  const jobs = await repository.listJobs({ projectName: "launch", status: "completed", limit: 999 });
  const updated = await repository.updateJob("job-1", {
    status: "completed",
    outputUrl: "https://media.test/final.mp4",
    result: { assetId: "asset-1" }
  }, "lease-1");

  assert.deepEqual(created.payload, { prompt: "hello" });
  assert.deepEqual(jobs[0].result, { assetId: "asset-1" });
  assert.deepEqual(jobs[0].payload, {});
  assert.deepEqual(jobs[1].result, {});
  assert.equal(updated.outputUrl, "https://media.test/final.mp4");

  const insert = db.calls.find((call) => /^INSERT INTO cf_production_jobs/i.test(call.sql));
  assert.match(insert.sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?\)/i);
  assert.ok(insert.bindings.includes(JSON.stringify({ prompt: "hello" })));
  const list = db.calls.find((call) => call.method === "all");
  assert.match(list.sql, /project_name = \?.*status = \?.*LIMIT \?/i);
  assert.deepEqual(list.bindings, ["launch", "completed", 200]);
  const update = db.calls.find((call) => /^UPDATE cf_production_jobs/i.test(call.sql));
  assert.match(update.sql, /WHERE id = \? AND lease_token = \?/i);
  assert.deepEqual(update.bindings.slice(-2), ["job-1", "lease-1"]);
});

test("creates and gets assets through prepared statements", async () => {
  const row = {
    id: "asset-1",
    project_name: "launch",
    kind: "product",
    name: "product.png",
    media_type: "image/png",
    local_path: "",
    object_key: "projects/launch/product.png",
    url: "/media/assets/asset-1",
    size_bytes: 42,
    checksum: "etag-1",
    status: "ready",
    created_at: "created",
    updated_at: "updated"
  };
  const db = fakeDb(async () => row);
  const repository = createD1Repository({ DB: db });

  const created = await repository.createAsset({
    ...row,
    projectName: row.project_name,
    mediaType: row.media_type,
    objectKey: row.object_key,
    sizeBytes: row.size_bytes
  });
  const fetched = await repository.getAsset("asset-1");

  assert.deepEqual(created, {
    id: "asset-1",
    projectName: "launch",
    kind: "product",
    name: "product.png",
    mediaType: "image/png",
    localPath: "",
    objectKey: "projects/launch/product.png",
    url: "/media/assets/asset-1",
    sizeBytes: 42,
    checksum: "etag-1",
    status: "ready",
    createdAt: "created",
    updatedAt: "updated"
  });
  assert.deepEqual(fetched, created);
  assert.match(db.calls[0].sql, /^INSERT INTO cf_assets/i);
  assert.match(db.calls[1].sql, /^SELECT \* FROM cf_assets WHERE id = \?/i);
  assert.deepEqual(db.calls[1].bindings, ["asset-1"]);
});

test("asset creation is idempotent for a non-null project local path and object key", async () => {
  const row = {
    id: "asset-existing", project_name: "launch", kind: "final-render", name: "renders/final.mp4",
    media_type: "video/mp4", local_path: "renders/final.mp4", object_key: `objects/sha256/${"a".repeat(64)}.mp4`,
    url: "/media/assets/asset-existing", size_bytes: 42, checksum: "a".repeat(64), status: "ready",
    created_at: "created", updated_at: "updated"
  };
  const db = fakeDb(async () => row);
  const repository = createD1Repository({ DB: db });

  const asset = await repository.createAsset({
    id: "asset-new", projectName: "launch", kind: "final-render", name: "renders/final.mp4",
    localPath: "renders/final.mp4", mediaType: "video/mp4", objectKey: row.object_key,
    url: "/media/assets/asset-new", sizeBytes: 42, checksum: "a".repeat(64)
  });

  assert.equal(asset.id, "asset-existing");
  assert.match(db.calls[0].sql, /ON CONFLICT\s*\(project_name, local_path, object_key\)/i);
  assert.match(db.calls[0].sql, /WHERE local_path IS NOT NULL AND object_key IS NOT NULL/i);
  assert.equal(db.calls[0].bindings[5], "renders/final.mp4");
});

test("lists organization and rendered media using current camelCase contracts", async () => {
  const db = fakeDb(async ({ sql }) => {
    if (/FROM cf_clients/i.test(sql)) return [{ id: "client-1", name: "Acme", industry: null, contact: "Sam", created_at: "client-created" }];
    if (/FROM cf_campaigns/i.test(sql)) return [{ id: "campaign-1", client_id: "client-1", name: "Launch", objective: null, status: "active", created_at: "campaign-created" }];
    if (/FROM cf_users/i.test(sql)) return [{ id: "staff-1", name: "Editor", role: "staff-editor", email: null, client_id: null }];
    if (/FROM cf_render_jobs/i.test(sql)) return [{
      id: "render-1", project_name: "launch", mode: "ai-generator", output_path: "final.mp4",
      output_url: "/media/render-1", render_type: "ugc", status: "completed", created_at: "render-created",
      type: "ai-generator", client_id: "client-1", campaign_id: "campaign-1", assigned_staff_id: "staff-1",
      reviewer_id: "reviewer-1", approval_status: "approved", approval_feedback: null
    }];
    return [];
  });
  const repository = createD1Repository({ DB: db });

  const organization = await repository.listOrganization();
  const media = await repository.listMedia();

  assert.deepEqual(organization, {
    clients: [{ id: "client-1", name: "Acme", industry: "", contact: "Sam", createdAt: "client-created" }],
    campaigns: [{ id: "campaign-1", clientId: "client-1", name: "Launch", objective: "", status: "active", createdAt: "campaign-created" }],
    staff: [{ id: "staff-1", name: "Editor", role: "staff-editor", email: "", clientId: "" }]
  });
  assert.deepEqual(media, [{
    id: "render-1",
    name: "final.mp4",
    project: "launch",
    projectType: "ai-generator",
    clientId: "client-1",
    campaignId: "campaign-1",
    assignedStaffId: "staff-1",
    reviewerId: "reviewer-1",
    approvalStatus: "approved",
    approvalFeedback: "",
    status: "completed",
    renderType: "ugc",
    url: "/media/render-1",
    createdAt: "render-created"
  }]);
  assert.equal(db.calls.filter((call) => call.method === "all").length, 4);
});

test("claims queued or expired jobs atomically with a caller lease token", async () => {
  const claimedRow = {
    id: "job-1", project_name: "launch", job_type: "pipeline", status: "processing",
    payload: "{}", requested_by: "staff-1", result: "{}", lease_token: "lease-1",
    created_at: "created", started_at: "started", completed_at: null, updated_at: "started"
  };
  const db = fakeDb(async () => claimedRow);
  const repository = createD1Repository({ DB: db });

  const claimed = await repository.claimNextJob("lease-1", "worker-1");

  assert.equal(claimed.id, "job-1");
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].method, "first");
  assert.match(db.calls[0].sql, /^UPDATE cf_production_jobs/i);
  assert.match(db.calls[0].sql, /lease_token = \?/i);
  assert.match(db.calls[0].sql, /attempt_count = attempt_count \+ 1/i);
  assert.match(db.calls[0].sql, /status = 'queued'.*lease_expires_at < \?/i);
  assert.match(db.calls[0].sql, /ORDER BY created_at ASC, id ASC/i);
  assert.equal(db.calls[0].bindings[0], "lease-1");
  await assert.rejects(() => repository.claimNextJob(""), /lease token is required/i);
});

test("exposes leased claim and update operations under the Worker-facing contract", async () => {
  const db = fakeDb(async ({ sql, bindings }) => ({
    id: "job-1",
    project_name: "launch",
    job_type: "pipeline",
    status: /SET status = 'processing'/i.test(sql) ? "processing" : "completed",
    payload: "{}",
    result: "{}",
    lease_token: bindings.at(-1),
    created_at: "created",
    started_at: "started",
    completed_at: null,
    updated_at: "updated"
  }));
  const repository = createRepository(db);

  const claimed = await repository.claimJob({ workerId: "worker-1" });
  const updated = await repository.updateClaimedJob("job-1", {
    status: "completed",
    leaseToken: claimed.leaseToken
  });

  assert.equal(claimed.status, "processing");
  assert.match(claimed.leaseToken, /^worker-1:/);
  assert.equal(updated.status, "completed");
  assert.match(db.calls[1].sql, /WHERE id = \? AND lease_token = \?/i);
  assert.deepEqual(db.calls[1].bindings.slice(-2), ["job-1", claimed.leaseToken]);
});

test("renews only a currently processing job lease", async () => {
  const db = fakeDb(async ({ bindings }) => ({
    id: "job-1",
    project_name: "launch",
    job_type: "pipeline",
    status: "processing",
    payload: "{}",
    result: "{}",
    lease_token: bindings.at(-1),
    created_at: "created",
    started_at: "started",
    completed_at: null,
    updated_at: "updated"
  }));
  const repository = createRepository(db);

  const renewed = await repository.renewJobLease("job-1", "lease-1");

  assert.equal(renewed.status, "processing");
  assert.match(db.calls[0].sql, /SET status = \?/i);
  assert.match(db.calls[0].sql, /lease_expires_at = \?/i);
  assert.match(db.calls[0].sql, /WHERE id = \? AND lease_token = \? AND status = 'processing'/i);
  assert.deepEqual(db.calls[0].bindings.slice(-2), ["job-1", "lease-1"]);
});

test("a completed job cannot be overwritten by failure reporting with the old lease", async () => {
  let status = "processing";
  const db = fakeDb(async ({ sql, bindings }) => {
    if (!/^UPDATE cf_production_jobs/i.test(sql)) return null;
    const requiresProcessing = /AND status = 'processing'/i.test(sql);
    if (requiresProcessing && status !== "processing") return null;
    status = bindings[0];
    return {
      id: "job-1",
      project_name: "launch",
      job_type: "pipeline",
      status,
      payload: "{}",
      result: "{}",
      lease_token: "lease-1",
      created_at: "created",
      started_at: "started",
      completed_at: status === "processing" ? null : "completed",
      updated_at: "updated"
    };
  });
  const repository = createRepository(db);

  const completed = await repository.updateJob("job-1", { status: "completed" }, "lease-1");
  const staleFailure = await repository.updateJob("job-1", { status: "failed", error: "response lost" }, "lease-1");

  assert.equal(completed.status, "completed");
  assert.equal(staleFailure, null);
  assert.equal(status, "completed");
  assert.match(db.calls[0].sql, /AND status = 'processing'/i);
  assert.match(db.calls[1].sql, /AND status = 'processing'/i);
});

test("the Worker repository has no Node, PostgreSQL, or process environment dependency", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(
    new URL("../cloudflare/worker/repository.js", import.meta.url),
    "utf8"
  ));
  assert.doesNotMatch(source, /from ["'](?:node:)?fs|from ["']pg["']|process\.env/);
  assert.match(source, /env\.DB|\{ DB \}/);
});

test("findUser resolves Supabase identities into the D1 role profile", async () => {
  const db = fakeDb(async () => ({
    id: "admin-1", auth_user_id: "auth-1", name: "Admin", role: "admin",
    email: "admin@example.com", client_id: null
  }));
  const repository = createRepository(db);

  const profile = await repository.findUser({ authUserId: "auth-1", email: "admin@example.com" });

  assert.deepEqual(profile, {
    id: "admin-1",
    authUserId: "auth-1",
    name: "Admin",
    role: "admin",
    email: "admin@example.com",
    clientId: ""
  });
  assert.match(db.calls[0].sql, /WHERE auth_user_id = \?/i);
  assert.doesNotMatch(db.calls[0].sql, /\sOR\s/i);
});

test("findUser never falls back to an email row when an immutable auth id is supplied", async () => {
  const db = fakeDb(async () => null);
  const repository = createRepository(db);

  const profile = await repository.findUser({ authUserId: "auth-new", email: "admin@example.com" });

  assert.equal(profile, null);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /WHERE auth_user_id = \?/i);
  assert.doesNotMatch(db.calls[0].sql, /WHERE[^;]*lower\(email\)/i);
});

test("folder queries apply the same staff project boundary", async () => {
  const db = fakeDb(async () => []);
  const repository = createRepository(db);

  await repository.listFolders({ id: "staff-1", role: "staff-editor", clientId: "" });

  assert.match(db.calls[0].sql, /JOIN cf_projects p ON p\.folder_id = f\.id/i);
  assert.match(db.calls[0].sql, /p\.assigned_staff_id = \?/i);
  assert.deepEqual(db.calls[0].bindings, ["staff-1"]);
});

test("management mutations and folders use prepared D1 statements", async () => {
  const db = fakeDb(async ({ sql, bindings }) => {
    if (/INSERT INTO cf_clients/i.test(sql)) return { id: bindings[0], name: bindings[1], industry: bindings[2], contact: bindings[3], created_at: bindings[4] };
    if (/INSERT INTO cf_campaigns/i.test(sql)) return { id: bindings[0], client_id: bindings[1], name: bindings[2], objective: bindings[3], status: bindings[4], created_at: bindings[5] };
    if (/INSERT INTO cf_folders/i.test(sql)) return { id: bindings[0], name: bindings[1], created_by: bindings[2], created_at: bindings[3] };
    if (/SELECT .* FROM cf_folders/i.test(sql)) return [{ id: "folder-1", name: "Launches", created_by: "admin-1", created_at: "created", updated_at: "updated" }];
    if (/INSERT INTO cf_projects/i.test(sql) || /UPDATE cf_projects/i.test(sql)) return { ...projectRow, name: bindings[0] || "launch" };
    return { success: true };
  });
  const repository = createRepository(db);

  await repository.createClient({ id: "client-1", name: "Acme", createdAt: "created" });
  await repository.createCampaign({ id: "campaign-1", clientId: "client-1", name: "Launch", createdAt: "created" });
  await repository.createFolder({ id: "folder-1", name: "Launches", createdBy: "admin-1", createdAt: "created" });
  const folders = await repository.listFolders();
  await repository.createProject({ ...projectRow, assignedStaffId: "staff-1", createdAt: "created" });
  await repository.updateProject("launch", { priority: "urgent", approvalStatus: "approved" });
  await repository.deleteProject("launch");

  assert.equal(folders[0].name, "Launches");
  assert.ok(db.calls.every((call) => !call.sql.includes("Acme") && !call.sql.includes("Launches")), "values must be bound, not interpolated");
  assert.ok(db.calls.some((call) => /^DELETE FROM cf_projects WHERE name = \?/i.test(call.sql)));
});

test("job and media listing queries apply project role access", async () => {
  const db = fakeDb(async () => []);
  const repository = createRepository(db);
  const staff = { id: "staff-1", role: "staff-editor", clientId: "" };
  const client = { id: "reviewer-1", role: "manager-client", clientId: "client-1" };

  await repository.listJobs({ user: staff });
  await repository.listMedia(client);

  assert.match(db.calls[0].sql, /JOIN cf_projects p ON p\.name = j\.project_name/i);
  assert.match(db.calls[0].sql, /p\.assigned_staff_id = \?/i);
  assert.deepEqual(db.calls[0].bindings.at(-1), 50);
  assert.match(db.calls[1].sql, /p\.client_id = \?.*p\.reviewer_id = \?/i);
  assert.deepEqual(db.calls[1].bindings, ["client-1", "reviewer-1"]);
});

test("creates render records that point at private R2 media URLs", async () => {
  const db = fakeDb(async ({ bindings }) => ({
    id: bindings[0], project_name: bindings[1], mode: bindings[2], status: bindings[3],
    output_path: bindings[4], object_key: bindings[5], output_url: bindings[6],
    render_type: bindings[7], highlight_id: bindings[8], reaction_id: bindings[9], created_at: bindings[10]
  }));
  const repository = createRepository(db);
  const render = await repository.createRender({
    id: "render-1", projectName: "alpha", mode: "worker", status: "completed",
    outputPath: "renders/final.mp4", objectKey: "projects/alpha/renders/final.mp4",
    outputUrl: "/media/assets/asset-1", renderType: "final", createdAt: "created"
  });

  assert.equal(render.outputUrl, "/media/assets/asset-1");
  assert.match(db.calls[0].sql, /^INSERT INTO cf_render_jobs/i);
});

test("ensures one deterministic render row for an idempotent asset retry", async () => {
  const rows = new Map();
  const db = fakeDb(async ({ bindings }) => {
    const row = {
      id: bindings[0], project_name: bindings[1], mode: bindings[2], status: bindings[3],
      output_path: bindings[4], object_key: bindings[5], output_url: bindings[6],
      render_type: bindings[7], highlight_id: bindings[8], reaction_id: bindings[9], created_at: bindings[10]
    };
    rows.set(row.id, row);
    return row;
  });
  const repository = createRepository(db);
  const input = {
    assetId: "asset-1", projectName: "alpha", mode: "worker", status: "completed",
    outputPath: "renders/final.mp4", objectKey: "objects/sha256/output.mp4",
    outputUrl: "/media/assets/asset-1", renderType: "final-render", createdAt: "created"
  };

  const first = await repository.ensureRender(input);
  const retried = await repository.ensureRender(input);

  assert.equal(first.id, "render:asset-1");
  assert.equal(retried.id, first.id);
  assert.equal(rows.size, 1);
  assert.match(db.calls[0].sql, /ON CONFLICT\s*\(id\)\s+DO UPDATE/i);
});

test("render repair reuses a legacy render row with the same asset business key", async () => {
  const legacy = {
    id: "legacy-random-id", project_name: "alpha", mode: "worker", status: "completed",
    output_path: "renders/final.mp4", object_key: "objects/sha256/output.mp4",
    output_url: "/media/assets/asset-1", render_type: "final-render",
    highlight_id: null, reaction_id: null, created_at: "before-retry"
  };
  const db = transactionalDb({ renders: [legacy] }, (staged, { sql, bindings }) => {
    if (/^INSERT INTO cf_render_jobs/i.test(sql)) {
      const candidate = {
        id: bindings[0], project_name: bindings[1], mode: bindings[2], status: bindings[3],
        output_path: bindings[4], object_key: bindings[5], output_url: bindings[6],
        render_type: bindings[7], highlight_id: bindings[8], reaction_id: bindings[9], created_at: bindings[10]
      };
      const exists = staged.renders.some((item) => item.project_name === candidate.project_name
        && item.output_path === candidate.output_path && item.object_key === candidate.object_key);
      if (!exists) staged.renders.push(candidate);
      return exists ? null : candidate;
    }
    return staged.renders.find((item) => item.project_name === bindings[1]
      && item.output_path === bindings[2] && item.object_key === bindings[3]) || null;
  });
  const repository = createRepository(db);

  const render = await repository.ensureRender({
    assetId: "asset-1", projectName: "alpha", outputPath: "renders/final.mp4",
    objectKey: "objects/sha256/output.mp4", outputUrl: "/media/assets/asset-1", renderType: "final-render"
  });

  assert.equal(render.id, "legacy-random-id");
  assert.equal(db.state.renders.length, 1);
  assert.equal(db.calls.length, 2);
});

test("campaign intelligence parses D1 JSON and hides internal sources from clients", async () => {
  const db = fakeDb(async ({ sql, method }) => {
    if (/FROM cf_campaign_briefs/i.test(sql)) return method === "first" ? {
      id: "brief-1", campaign_id: "campaign-1", title: "Launch", product_name: "Bee Phone",
      objective: "Sales", target_audience: "Creators", brief: '{"promise":"Easy"}', status: "complete",
      created_by: "admin-1", created_at: "created", updated_at: "updated"
    } : [];
    if (/FROM cf_research_sources/i.test(sql)) return [{
      id: "source-1", brief_id: "brief-1", source_type: "text", name: "Interviews", content: "Easy setup",
      passages: '["Easy setup"]', metadata: '{"frequency":3}', created_by: "staff-1", created_at: "created"
    }];
    if (/FROM cf_market_reports/i.test(sql)) return method === "first" ? {
      id: "report-1", brief_id: "brief-1", campaign_id: "campaign-1", status: "approved", source: "openai",
      report: '{"angle":"simplicity"}', scriptwriter_input: '{"pain":"setup"}', created_by: "staff-1",
      created_at: "created", updated_at: "updated"
    } : [];
    return [];
  });
  const repository = createRepository(db);
  const staff = await repository.campaignIntelligence("campaign-1", { role: "staff-editor", id: "staff-1" });
  const client = await repository.campaignIntelligence("campaign-1", { role: "manager-client", id: "reviewer-1", clientId: "client-1" });

  assert.equal(staff.campaignBrief.brief.promise, "Easy");
  assert.deepEqual(staff.researchSources[0].metadata, { frequency: 3 });
  assert.equal(staff.marketReport.report.angle, "simplicity");
  assert.deepEqual(client.researchSources, []);
  assert.equal(client.marketReport.status, "approved");
});

test("project script bundle merges the current D1 version and review history", async () => {
  const db = fakeDb(async ({ sql }) => {
    if (/FROM cf_ugc_scripts/i.test(sql)) return [{
      id: "script-1", project_name: "alpha", campaign_id: "campaign-1", title: "UGC", status: "client-review",
      selected_hook_id: "hook-1", selected_hook_index: 0, current_version_number: 2,
      created_by: "staff-1", updated_by: "staff-1", created_at: "created", updated_at: "updated"
    }];
    if (/FROM cf_ugc_script_versions/i.test(sql)) return [{
      id: "version-2", script_id: "script-1", version_number: 2,
      content: '{"hooks":[{"id":"hook-1","text":"Wait"}],"scenes":[{"audio":"Try this"}]}',
      change_note: "Tighter hook", created_by: "staff-1", created_at: "updated"
    }];
    if (/FROM cf_script_review_events/i.test(sql)) return [{
      id: "review-1", script_id: "script-1", version_id: "version-2", from_status: "draft",
      to_status: "client-review", feedback: "Ready", actor_id: "staff-1", created_at: "updated"
    }];
    return [];
  });
  const repository = createRepository(db);
  const bundle = await repository.projectScriptBundle("alpha", { role: "staff-editor", id: "staff-1" });

  assert.equal(bundle.ugcScript.versionId, "version-2");
  assert.equal(bundle.ugcScript.hooks[0].text, "Wait");
  assert.equal(bundle.scriptVersions[0].versionNumber, 2);
  assert.equal(bundle.scriptReviewEvents[0].toStatus, "client-review");
});

test("script writes persist metadata, immutable versions, and review events", async () => {
  const db = fakeDb(async ({ sql, bindings }) => {
    if (/INSERT INTO cf_ugc_scripts/i.test(sql)) return {
      id: bindings[0], market_report_id: bindings[1], campaign_id: bindings[2], project_name: bindings[3],
      title: bindings[4], status: bindings[5], selected_hook_id: bindings[6], selected_hook_index: bindings[7],
      current_version_number: bindings[8], created_by: bindings[9], updated_by: bindings[10],
      created_at: bindings[11], updated_at: bindings[12]
    };
    if (/INSERT INTO cf_ugc_script_versions/i.test(sql)) return {
      id: bindings[0], script_id: bindings[1], version_number: bindings[2], content: bindings[3],
      change_note: bindings[4], created_by: bindings[5], created_at: bindings[6]
    };
    if (/INSERT INTO cf_script_review_events/i.test(sql)) return {
      id: bindings[0], script_id: bindings[1], version_id: bindings[2], from_status: bindings[3],
      to_status: bindings[4], feedback: bindings[5], actor_id: bindings[6], override_reason: bindings[7], created_at: bindings[8]
    };
    return null;
  });
  const repository = createRepository(db);
  const script = await repository.upsertUgcScript({
    id: "script-1", projectName: "alpha", campaignId: "campaign-1", title: "UGC", status: "draft",
    selectedHookId: "hook-1", selectedHookIndex: 0, currentVersionNumber: 1, createdBy: "staff-1", createdAt: "created", updatedAt: "updated"
  });
  const version = await repository.createScriptVersion({
    id: "version-1", scriptId: "script-1", versionNumber: 1, content: { hooks: [] }, createdBy: "staff-1", createdAt: "created"
  });
  const review = await repository.recordScriptReview({
    id: "review-1", scriptId: "script-1", versionId: "version-1", fromStatus: "draft",
    toStatus: "client-review", actorId: "staff-1", createdAt: "created"
  });

  assert.equal(script.projectName, "alpha");
  assert.deepEqual(version.content, { hooks: [] });
  assert.equal(review.toStatus, "client-review");
});

test("script version reconciliation is idempotent after a lost terminal job update", async () => {
  const row = {
    id: "version-1", script_id: "script-1", version_number: 1,
    content: '{"scenes":[]}', change_note: null, created_by: "staff-1", created_at: "created"
  };
  const db = fakeDb(async () => row);
  const repository = createRepository(db);

  const version = await repository.createScriptVersion({
    id: "version-1", scriptId: "script-1", versionNumber: 1,
    content: { scenes: [] }, createdBy: "staff-1", createdAt: "created"
  });

  assert.equal(version.id, "version-1");
  assert.match(db.calls[0].sql, /ON CONFLICT\s*\(id\)\s+DO UPDATE/i);
});

test("clipper candidates can be replaced and one active highlight persisted", async () => {
  const db = fakeDb(async ({ sql, bindings }) => {
    if (/INSERT INTO cf_clip_candidates/i.test(sql)) return {
      id: bindings[0], project_name: bindings[1], title: bindings[2], start_seconds: bindings[3],
      end_seconds: bindings[4], score: bindings[5], reason: bindings[6], selected: 0, created_at: bindings[7]
    };
    if (/selected = 1/i.test(sql)) return {
      id: bindings.at(-1), project_name: bindings[0], title: "Best moment", start_seconds: 10,
      end_seconds: 40, score: 95, reason: "Strong hook", selected: 1, created_at: "created"
    };
    return { ok: true };
  });
  const repository = createRepository(db);
  const candidates = await repository.replaceClipCandidates("alpha", [{ id: "h-1", title: "Best moment", start: 10, end: 40, score: 95, reason: "Strong hook" }]);
  const selected = await repository.setSelectedHighlight("alpha", "h-1");

  assert.equal(candidates[0].id, "h-1");
  assert.equal(selected.selected, true);
  assert.match(db.calls[0].sql, /^DELETE FROM cf_clip_candidates WHERE project_name = \?/i);
  assert.match(db.calls.at(-1).sql, /selected = 1/i);
});

test("market report reconciliation is atomic and idempotent after a batch fault", async () => {
  const db = transactionalDb({ reports: [] }, (staged, { sql, bindings }) => {
    assert.match(sql, /INSERT INTO cf_market_reports/i);
    const row = {
      id: bindings[0], brief_id: bindings[1], campaign_id: bindings[2], status: bindings[3],
      source: bindings[4], report: bindings[5], scriptwriter_input: bindings[6],
      created_by: bindings[7], created_at: bindings[8], updated_at: bindings[9]
    };
    staged.reports = staged.reports.filter((item) => item.id !== row.id);
    staged.reports.push(row);
    return row;
  });
  const repository = createRepository(db);
  const input = {
    id: "report-1", briefId: "brief-1", campaignId: "campaign-1", status: "ready",
    report: { angle: "simple" }, scriptwriterInput: { pain: "setup" }
  };

  db.failAt(0);
  await assert.rejects(repository.reconcileMarketReport(input), /injected batch failure/);
  assert.deepEqual(db.state.reports, []);

  db.clearFault();
  await repository.reconcileMarketReport(input);
  await repository.reconcileMarketReport(input);
  assert.equal(db.state.reports.length, 1);
});

test("UGC script and version reconciliation is all-or-nothing and idempotent", async () => {
  const db = transactionalDb({ scripts: [], versions: [] }, (staged, { sql, bindings }) => {
    if (/INSERT INTO cf_ugc_scripts/i.test(sql)) {
      const row = {
        id: bindings[0], market_report_id: bindings[1], campaign_id: bindings[2], project_name: bindings[3],
        title: bindings[4], status: bindings[5], selected_hook_id: bindings[6], selected_hook_index: bindings[7],
        current_version_number: bindings[8], created_by: bindings[9], updated_by: bindings[10],
        created_at: bindings[11], updated_at: bindings[12]
      };
      staged.scripts = staged.scripts.filter((item) => item.id !== row.id);
      staged.scripts.push(row);
      return row;
    }
    const row = {
      id: bindings[0], script_id: bindings[1], version_number: bindings[2], content: bindings[3],
      change_note: bindings[4], created_by: bindings[5], created_at: bindings[6]
    };
    staged.versions = staged.versions.filter((item) => item.id !== row.id);
    staged.versions.push(row);
    return row;
  });
  const repository = createRepository(db);
  const script = { id: "script-1", projectName: "alpha", title: "Draft", currentVersionNumber: 1 };
  const version = { id: "version-1", scriptId: "script-1", versionNumber: 1, content: { scenes: [] } };

  db.failAt(1);
  await assert.rejects(repository.reconcileUgcScript(script, version), /injected batch failure/);
  assert.deepEqual(db.state.scripts, []);
  assert.deepEqual(db.state.versions, []);

  db.clearFault();
  await repository.reconcileUgcScript(script, version);
  await repository.reconcileUgcScript(script, version);
  assert.equal(db.state.scripts.length, 1);
  assert.equal(db.state.versions.length, 1);
});

test("clip candidate replacement is atomic and idempotent after an insert fault", async () => {
  const db = transactionalDb({ candidates: [{ id: "alpha:old", project_name: "alpha" }] }, (staged, { sql, bindings }) => {
    if (/^DELETE FROM cf_clip_candidates/i.test(sql)) {
      staged.candidates = staged.candidates.filter((item) => item.project_name !== bindings[0]);
      return null;
    }
    const row = {
      id: bindings[0], project_name: bindings[1], title: bindings[2], start_seconds: bindings[3],
      end_seconds: bindings[4], score: bindings[5], reason: bindings[6], selected: 0, created_at: bindings[7]
    };
    staged.candidates.push(row);
    return row;
  });
  const repository = createRepository(db);
  const candidates = [
    { id: "h-1", title: "First", start: 1, end: 31, score: 90 },
    { id: "h-2", title: "Second", start: 40, end: 75, score: 80 }
  ];

  db.failAt(2);
  await assert.rejects(repository.replaceClipCandidates("alpha", candidates), /injected batch failure/);
  assert.deepEqual(db.state.candidates, [{ id: "alpha:old", project_name: "alpha" }]);

  db.clearFault();
  await repository.replaceClipCandidates("alpha", candidates);
  await repository.replaceClipCandidates("alpha", candidates);
  assert.deepEqual(db.state.candidates.map((item) => item.id), ["alpha:h-1", "alpha:h-2"]);
});
