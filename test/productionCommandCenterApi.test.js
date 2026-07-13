import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { handleRequest } from "../src/server.js";

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function withCommandCenter(run) {
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    REQUIRE_AUTH: process.env.REQUIRE_AUTH,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  const events = [];
  const requests = [];
  const storage = { failUploads: false, objects: new Map() };
  const jobs = [
    {
      id: "failed-job",
      project_name: "staff-project",
      job_type: "pipeline",
      status: "failed",
      attempt_count: 1,
      requested_by: "admin-user",
      payload: { topic: "Launch", apiKey: "secret-payload-key" },
      result: { provider: "libtv", authorization: "Bearer secret-result-token" },
      error: "Provider failed with api_key=secret-error-key"
    },
    { id: "queued-job", project_name: "staff-project", job_type: "render-final-video", status: "queued", attempt_count: 0 },
    { id: "other-job", project_name: "other-project", job_type: "pipeline", status: "completed", attempt_count: 1 }
  ];
  const workers = [{
    worker_id: "stale-worker",
    worker_name: "Main PC",
    status: "online",
    current_job_id: null,
    capabilities: ["pipeline"],
    last_seen_at: "2000-01-01T00:00:00.000Z"
  }];
  const profiles = {
    "admin-auth": { id: "admin", auth_user_id: "admin-auth", name: "Admin", role: "admin", email: "admin@example.test" },
    "staff-auth": { id: "staff", auth_user_id: "staff-auth", name: "Staff", role: "staff-editor", email: "staff@example.test" },
    "client-auth": { id: "client", auth_user_id: "client-auth", name: "Client", role: "manager-client", email: "client@example.test", client_id: "client-a" }
  };
  const projects = [
    { name: "staff-project", assigned_staff_id: "staff", client_id: "client-a" },
    { name: "other-project", assigned_staff_id: "other", client_id: "other-client" }
  ];
  const assets = [{
    id: "staff-project:reaction-character:r-1",
    project_name: "staff-project",
    kind: "reaction-character",
    name: "Maya",
    media_type: "image",
    local_path: "clipper/reaction/maya.png",
    url: "https://media.example.test/maya.png"
  }];
  const clipCandidates = [{
    id: "staff-project:highlight-1",
    project_name: "staff-project",
    title: "Hosted highlight",
    start_seconds: 4,
    end_seconds: 34,
    score: 0.9
  }];

  process.env.HOSTED_DEMO = "true";
  process.env.REQUIRE_AUTH = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.origin !== "https://project.supabase.co") return originalFetch(input, options);
    requests.push({ url, options });

    if (url.pathname === "/auth/v1/user") {
      const token = String(options.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
      const profile = profiles[token];
      return profile ? json({ id: profile.auth_user_id, email: profile.email }) : json({ message: "Unauthorized" }, 401);
    }

    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (storage.failUploads) return json({ message: "Storage unavailable" }, 503);
      const signedPrefix = "/storage/v1/object/upload/sign/contentflow-media/";
      const objectPrefix = "/storage/v1/object/contentflow-media/";
      if (url.pathname.startsWith(signedPrefix) && options.method === "POST") {
        return json({ url: `${url.pathname.replace("/storage/v1", "")}?token=signed-upload-token`, token: "signed-upload-token" });
      }
      if (url.pathname.startsWith(signedPrefix) && options.method === "PUT") {
        const objectPath = url.pathname.slice(signedPrefix.length).split("/").map(decodeURIComponent).join("/");
        const bytes = Buffer.isBuffer(options.body) ? options.body : Buffer.from(await options.body.arrayBuffer());
        storage.objects.set(objectPath, { bytes, contentType: options.headers?.["Content-Type"] || "application/octet-stream" });
        return json({ Key: objectPath });
      }
      if (url.pathname.startsWith(objectPrefix)) {
        const objectPath = url.pathname.slice(objectPrefix.length).split("/").map(decodeURIComponent).join("/");
        const object = storage.objects.get(objectPath);
        if (!object) return json({ message: "Not found" }, 404);
        const headers = { "Content-Type": object.contentType, "Content-Length": String(object.bytes.length) };
        if (options.method === "HEAD") return new Response(null, { status: 200, headers });
        return new Response(object.bytes.subarray(0, 32), { status: 206, headers });
      }
      return json({ Key: "uploaded" });
    }

    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "cf_users") {
      const encodedAuthId = url.searchParams.get("or") || "";
      const profile = Object.values(profiles).find((candidate) => encodedAuthId.includes(candidate.auth_user_id));
      return json(profile ? [profile] : []);
    }
    if (table === "cf_projects") {
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        const current = projects.find((project) => project.name === body.name);
        Object.assign(current, body);
        return json([current]);
      }
      return json(projects);
    }
    if (table === "cf_assets") {
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        const current = assets.find((asset) => asset.id === body.id);
        if (current) Object.assign(current, body);
        else assets.push(body);
        return json([body]);
      }
      return json(assets);
    }
    if (table === "cf_render_jobs") return json([]);
    if (table === "cf_clip_candidates") return json(clipCandidates);
    if (table === "cf_production_jobs") {
      if (options.method === "POST") {
        const created = { id: `created-${jobs.length + 1}`, attempt_count: 0, progress: 0, result: {}, ...JSON.parse(options.body) };
        jobs.push(created);
        return json([created]);
      }
      if (options.method === "PATCH") {
        const target = jobs.find((job) => job.id === (url.searchParams.get("id") || "").replace("eq.", ""));
        if (!target) return json([]);
        const allowedStatuses = url.searchParams.get("status") || "";
        if (allowedStatuses.includes("queued") && target.status !== "queued") return json([]);
        if (allowedStatuses.includes("failed,cancelled") && !["failed", "cancelled"].includes(target.status)) return json([]);
        Object.assign(target, JSON.parse(options.body));
        return json([target]);
      }
      let result = [...jobs];
      const jobId = url.searchParams.get("id");
      const projectName = url.searchParams.get("project_name");
      const status = url.searchParams.get("status");
      const jobType = url.searchParams.get("job_type");
      if (jobId) result = result.filter((job) => job.id === jobId.replace("eq.", ""));
      if (projectName) result = result.filter((job) => job.project_name === projectName.replace("eq.", ""));
      if (status) result = result.filter((job) => job.status === status.replace("eq.", ""));
      if (jobType) result = result.filter((job) => job.job_type === jobType.replace("eq.", ""));
      return json(result);
    }
    if (table === "cf_worker_heartbeats") {
      if (options.method === "PATCH") {
        const worker = workers.find((item) => item.worker_id === (url.searchParams.get("worker_id") || "").replace("eq.", ""));
        const body = JSON.parse(options.body);
        if (url.searchParams.get("status") !== `neq.${body.status}` || worker.status === body.status || worker.rejectTransition) return json([]);
        Object.assign(worker, body);
        return json([worker]);
      }
      return json(workers);
    }
    if (table === "cf_analytics_events") {
      events.push(JSON.parse(options.body));
      return json([]);
    }
    return json([]);
  };

  const server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  try {
    await run({ baseUrl, auth, events, jobs, workers, requests, storage, assets });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
}

test("admin command center forwards filters and persists each offline worker event once", async () => {
  await withCommandCenter(async ({ baseUrl, auth, events, workers, requests }) => {
    const list = await fetch(`${baseUrl}/api/production-jobs?project=staff-project&status=failed&jobType=pipeline`, { headers: auth("admin-auth") });
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.ok(Array.isArray(body.jobs));
    assert.deepEqual(body.jobs.map((job) => job.id), ["failed-job"]);
    assert.equal(typeof body.summary.queued, "number");
    assert.equal(body.summary.total, 1);
    const jobListRequest = requests.find(({ url }) => url.pathname.endsWith("/cf_production_jobs") && url.searchParams.get("select") === "*");
    assert.equal(jobListRequest.url.searchParams.get("job_type"), "eq.pipeline");
    assert.ok(Array.isArray(body.workers));
    assert.equal(body.workers[0].health.status, "offline");
    assert.equal(workers[0].status, "offline");
    const offlineRequest = requests.find(({ url, options }) => url.pathname.endsWith("/cf_worker_heartbeats") && options.method === "PATCH");
    assert.equal(offlineRequest.url.searchParams.get("last_seen_at"), "eq.2000-01-01T00:00:00.000Z");
    assert.deepEqual(events.map((event) => event.event_type), ["production.worker.offline"]);

    const refresh = await fetch(`${baseUrl}/api/production-workers`, { headers: auth("admin-auth") });
    assert.equal(refresh.status, 200);
    assert.equal(events.length, 1);
  });
});

test("a stale worker that loses the conditional offline transition emits no offline event", async () => {
  await withCommandCenter(async ({ baseUrl, auth, events, workers }) => {
    workers[0].rejectTransition = true;

    const response = await fetch(`${baseUrl}/api/production-workers`, { headers: auth("admin-auth") });
    assert.equal(response.status, 200);
    assert.equal(workers[0].status, "online");
    assert.equal(events.length, 0);
  });
});

test("production job transitions distinguish missing jobs from disallowed states", async () => {
  await withCommandCenter(async ({ baseUrl, auth, jobs, events }) => {
    const missing = await fetch(`${baseUrl}/api/production-jobs/00000000-0000-0000-0000-000000000000/retry`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(missing.status, 404);

    const missingCancel = await fetch(`${baseUrl}/api/production-jobs/00000000-0000-0000-0000-000000000000/cancel`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(missingCancel.status, 404);

    const invalidRetry = await fetch(`${baseUrl}/api/production-jobs/queued-job/retry`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(invalidRetry.status, 409);

    const invalidCancel = await fetch(`${baseUrl}/api/production-jobs/failed-job/cancel`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(invalidCancel.status, 409);

    const cancelled = await fetch(`${baseUrl}/api/production-jobs/queued-job/cancel`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(cancelled.status, 200);
    assert.equal(jobs.find((job) => job.id === "queued-job").status, "cancelled");
    assert.ok(events.some((event) => event.event_type === "production.job.cancelled"));

    const retried = await fetch(`${baseUrl}/api/production-jobs/queued-job/retry`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(retried.status, 200);
    assert.equal(jobs.find((job) => job.id === "queued-job").status, "queued");
    assert.ok(events.some((event) => event.event_type === "production.job.retried"));
  });
});

test("production command center is admin-only and staff job visibility stays project-scoped", async () => {
  await withCommandCenter(async ({ baseUrl, auth }) => {
    const jobs = await fetch(`${baseUrl}/api/production-jobs`, { headers: auth("client-auth") });
    assert.equal(jobs.status, 403);

    const workers = await fetch(`${baseUrl}/api/production-workers`, { headers: auth("client-auth") });
    assert.equal(workers.status, 403);

    const clientProjectJobs = await fetch(`${baseUrl}/api/projects/staff-project/jobs`, { headers: auth("client-auth") });
    assert.equal(clientProjectJobs.status, 403);

    const staffProjectJobs = await fetch(`${baseUrl}/api/projects/staff-project/jobs`, { headers: auth("staff-auth") });
    assert.equal(staffProjectJobs.status, 200);
    const staffBody = await staffProjectJobs.json();
    assert.equal(Object.hasOwn(staffBody.jobs[0], "payload"), false);
    assert.equal(Object.hasOwn(staffBody.jobs[0], "result"), false);
    assert.equal(Object.hasOwn(staffBody.jobs[0], "requestedBy"), false);
    assert.doesNotMatch(JSON.stringify(staffBody), /secret-payload-key|secret-result-token|secret-error-key/);

    const otherProjectJobs = await fetch(`${baseUrl}/api/projects/other-project/jobs`, { headers: auth("staff-auth") });
    assert.equal(otherProjectJobs.status, 403);
  });
});

test("production command center rejects trailing route segments", async () => {
  await withCommandCenter(async ({ baseUrl, auth, requests }) => {
    const retry = await fetch(`${baseUrl}/api/production-jobs/queued-job/retry/extra`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(retry.status, 404);

    const cancel = await fetch(`${baseUrl}/api/production-jobs/queued-job/cancel/extra`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(cancel.status, 404);

    const projectJobs = await fetch(`${baseUrl}/api/projects/staff-project/jobs/extra`, { headers: auth("staff-auth") });
    assert.equal(projectJobs.status, 404);

    const projectJobPost = await fetch(`${baseUrl}/api/projects/staff-project/jobs/extra`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ jobType: "pipeline" })
    });
    assert.equal(projectJobPost.status, 404);
    assert.equal(requests.filter(({ url, options }) => url.pathname.endsWith("/cf_production_jobs") && options.method === "POST").length, 0);
  });
});

test("hosted clipper selection persists and variation jobs carry stable references", async () => {
  await withCommandCenter(async ({ baseUrl, auth, events }) => {
    const selected = await fetch(`${baseUrl}/api/projects/staff-project/clipper/select-highlight`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ highlightId: "highlight-1" })
    });
    assert.equal(selected.status, 200);
    const selectedBody = await selected.json();
    assert.equal(selectedBody.data.summary.selectedHighlightId, "highlight-1");
    assert.equal(selectedBody.data.files.clipperSelection.id, "highlight-1");

    const queued = await fetch(`${baseUrl}/api/projects/staff-project/clipper/render-variations`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ reactionIds: ["r-1"] })
    });
    assert.equal(queued.status, 202);
    const queuedBody = await queued.json();
    assert.equal(queuedBody.job.payload.highlightId, "highlight-1");
    assert.deepEqual(queuedBody.job.payload.reactionAssets, [{
      id: "r-1",
      name: "Maya",
      localPath: "clipper/reaction/maya.png",
      url: "https://media.example.test/maya.png",
      mediaType: "image"
    }]);
    assert.equal(events.some((event) => event.event_type === "production.job.queued"), true);
  });
});

test("hosted staff reaction upload uses a signed direct-to-Storage handoff", async () => {
  await withCommandCenter(async ({ baseUrl, auth, storage, assets }) => {
    storage.failUploads = true;
    const failed = await fetch(`${baseUrl}/api/projects/staff-project/clipper/reaction/upload-url`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "Maya.mp4", contentType: "video/mp4", size: 8 * 1024 * 1024 })
    });
    assert.equal(failed.status, 500);
    assert.match((await failed.json()).error, /signed upload URL failed: 503/i);

    storage.failUploads = false;
    const video = Buffer.alloc(8 * 1024 * 1024);
    video.write("ftypisom", 4, "ascii");
    const prepared = await fetch(`${baseUrl}/api/projects/staff-project/clipper/reaction/upload-url`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "Maya.mp4", contentType: "video/mp4", size: video.length })
    });
    assert.equal(prepared.status, 201);
    const handoff = await prepared.json();
    assert.match(handoff.uploadUrl, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/upload\/sign\//);

    const directUpload = await fetch(handoff.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: video });
    assert.equal(directUpload.status, 200);

    const completed = await fetch(`${baseUrl}/api/projects/staff-project/clipper/reaction/complete`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ upload: handoff.upload })
    });
    assert.equal(completed.status, 200);
    const body = await completed.json();
    assert.equal(body.ok, true);
    const uploaded = assets.find((asset) => asset.kind === "reaction-character" && /^https:\/\/project\.supabase\.co\/storage\//.test(asset.url || ""));
    assert.match(uploaded.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/contentflow-media\//);
    assert.equal(uploaded.media_type, "video");

    const tampered = await fetch(`${baseUrl}/api/projects/staff-project/clipper/reaction/complete`, {
      method: "POST",
      headers: { ...auth("staff-auth"), "Content-Type": "application/json" },
      body: JSON.stringify({ upload: { ...handoff.upload, displayName: "Forged" } })
    });
    assert.equal(tampered.status, 500);
    assert.match((await tampered.json()).error, /signature|metadata/i);
  });
});

test("local authenticated manager-client users cannot access command center endpoints", async () => {
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    REQUIRE_AUTH: process.env.REQUIRE_AUTH,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
    SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD
  };
  const originalFetch = global.fetch;
  process.env.HOSTED_DEMO = "false";
  process.env.REQUIRE_AUTH = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_DATABASE_URL;
  delete process.env.SUPABASE_DB_PASSWORD;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.origin !== "https://project.supabase.co") return originalFetch(input, options);
    const token = String(options.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
    return json(token === "reviewer-auth"
      ? { id: "reviewer-auth", email: "reviewer@digitalbee.ai" }
      : { id: "admin-auth", email: "admin@digitalbee.ai" });
  };

  const server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const client = await fetch(`${baseUrl}/api/production-workers`, { headers: { Authorization: "Bearer reviewer-auth" } });
    assert.equal(client.status, 403);
    const admin = await fetch(`${baseUrl}/api/production-workers`, { headers: { Authorization: "Bearer admin-auth" } });
    assert.equal(admin.status, 200);
    const projectJobPost = await fetch(`${baseUrl}/api/projects/local-project/jobs/extra`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-auth", "Content-Type": "application/json" },
      body: JSON.stringify({ jobType: "pipeline" })
    });
    assert.equal(projectJobPost.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
