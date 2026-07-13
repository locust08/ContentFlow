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
  const jobs = [
    { id: "failed-job", project_name: "staff-project", job_type: "pipeline", status: "failed", attempt_count: 1 },
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

    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "cf_users") {
      const encodedAuthId = url.searchParams.get("or") || "";
      const profile = Object.values(profiles).find((candidate) => encodedAuthId.includes(candidate.auth_user_id));
      return json(profile ? [profile] : []);
    }
    if (table === "cf_projects") return json(projects);
    if (table === "cf_production_jobs") {
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
    await run({ baseUrl, auth, events, jobs, workers, requests });
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

    const otherProjectJobs = await fetch(`${baseUrl}/api/projects/other-project/jobs`, { headers: auth("staff-auth") });
    assert.equal(otherProjectJobs.status, 403);
  });
});

test("production command center rejects trailing route segments", async () => {
  await withCommandCenter(async ({ baseUrl, auth }) => {
    const retry = await fetch(`${baseUrl}/api/production-jobs/queued-job/retry/extra`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(retry.status, 404);

    const cancel = await fetch(`${baseUrl}/api/production-jobs/queued-job/cancel/extra`, { method: "POST", headers: auth("admin-auth") });
    assert.equal(cancel.status, 404);

    const projectJobs = await fetch(`${baseUrl}/api/projects/staff-project/jobs/extra`, { headers: auth("staff-auth") });
    assert.equal(projectJobs.status, 404);
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
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
