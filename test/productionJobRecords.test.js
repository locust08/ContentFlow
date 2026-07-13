import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("schema stores production progress, results, and worker heartbeats", () => {
  const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
  assert.match(schema, /attempt_count integer not null default 0/i);
  assert.match(schema, /progress integer not null default 0/i);
  assert.match(schema, /result jsonb not null default '\{\}'::jsonb/i);
  assert.match(schema, /create table if not exists cf_worker_heartbeats/i);
  assert.match(schema, /cf_worker_heartbeats[\s\S]*started_at timestamptz not null default now\(\)/i);
  assert.match(schema, /alter table cf_projects add column if not exists selected_highlight_id text/i);
});

test("maps operational job and worker records", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const job = db.mapProductionJobRecord({ id: "job-1", project_name: "demo", job_type: "pipeline", status: "queued", attempt_count: 2, progress: 25, progress_message: "Preparing", result: { outputs: [] } });
  assert.equal(job.attemptCount, 2);
  assert.equal(job.progress, 25);
  assert.deepEqual(job.result, { outputs: [] });
  const worker = db.mapWorkerHeartbeatRecord({ worker_id: "worker-1", worker_name: "Main PC", status: "online", current_job_id: null, capabilities: ["pipeline"], last_seen_at: "2026-07-14T00:00:00.000Z" });
  assert.equal(worker.workerId, "worker-1");
  assert.deepEqual(worker.capabilities, ["pipeline"]);
});

test("validates worker update targets and normalizes progress milestones", async () => {
  const db = await import("../src/services/supabaseDb.js");

  assert.throws(() => db.normalizeProductionJobUpdate({ status: "queued" }), /processing, completed, or failed/i);
  assert.throws(() => db.normalizeProductionJobUpdate({ status: "cancelled" }), /processing, completed, or failed/i);
  assert.equal(db.normalizeProductionJobUpdate({ status: "processing", progress: 26 }).progress, 25);
  assert.equal(db.normalizeProductionJobUpdate({ status: "processing", progress: 99 }).progress, 90);
  assert.equal(db.normalizeProductionJobUpdate({ status: "completed", progress: 25 }).progress, 100);
});

test("hosted updates target processing jobs and ignore caller heartbeat start times", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  const requests = [];

  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify([{ id: "job-1", status: body.status, progress: body.progress, worker_id: body.worker_id, worker_name: body.worker_name }]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    await db.updateSupabaseProductionJob("job-1", { status: "processing", progress: 26 });
    await db.upsertSupabaseWorkerHeartbeat({ workerId: "worker-1", workerName: "Main PC", startedAt: "2000-01-01T00:00:00.000Z" });

    assert.match(requests[0].url, /cf_production_jobs\?id=eq\.job-1&status=eq\.processing/);
    assert.equal(JSON.parse(requests[0].options.body).progress, 25);
    assert.equal(Object.hasOwn(JSON.parse(requests[1].options.body), "started_at"), false);
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("hosted claims compare the queued attempt count and return null after a stale patch", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  const requests = [];

  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const requestUrl = new URL(url);
    const isClaimLookup = options.method === "GET" && requestUrl.searchParams.get("status") === "eq.queued";
    return new Response(JSON.stringify(isClaimLookup ? [{ id: "job-1", attempt_count: 3 }] : []), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    assert.equal(await db.claimNextSupabaseProductionJob(), null);
    const patchUrl = new URL(requests[1].url);
    assert.equal(patchUrl.searchParams.get("id"), "eq.job-1");
    assert.equal(patchUrl.searchParams.get("status"), "eq.queued");
    assert.equal(patchUrl.searchParams.get("attempt_count"), "eq.3");
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("hosted job lists apply job type filters before the limit", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  const requests = [];

  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await db.listSupabaseProductionJobs({ projectName: "demo", status: "failed", jobType: "pipeline", limit: 1 });
    const request = requests[0].url;
    assert.equal(request.searchParams.get("project_name"), "eq.demo");
    assert.equal(request.searchParams.get("status"), "eq.failed");
    assert.equal(request.searchParams.get("job_type"), "eq.pipeline");
    assert.equal(request.searchParams.get("limit"), "1");
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("hosted worker status transition compares the observed heartbeat timestamp", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  let storedStatus = "online";

  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async (url, options) => {
    const request = new URL(url);
    const body = JSON.parse(options.body);
    assert.equal(request.searchParams.get("last_seen_at"), "eq.2026-07-14T00:00:00.000Z");
    if (request.searchParams.get("status") !== `neq.${body.status}` || storedStatus === body.status) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    storedStatus = body.status;
    return new Response(JSON.stringify([{ worker_id: "worker-1", status: storedStatus }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const results = await Promise.all([
      db.setSupabaseWorkerHeartbeatStatus("worker-1", "offline", "2026-07-14T00:00:00.000Z"),
      db.setSupabaseWorkerHeartbeatStatus("worker-1", "offline", "2026-07-14T00:00:00.000Z")
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(storedStatus, "offline");
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("records claimed and completed production job audit events with attempt metadata", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  const events = [];
  const row = {
    id: "job-audit",
    project_name: "demo",
    job_type: "pipeline",
    status: "queued",
    attempt_count: 1,
    created_at: "2026-07-14T00:00:00.000Z"
  };

  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async (url, options = {}) => {
    const request = new URL(url);
    if (request.pathname.endsWith("/cf_analytics_events")) {
      events.push(JSON.parse(options.body));
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (options.method === "GET") return new Response(JSON.stringify([row]), { status: 200, headers: { "Content-Type": "application/json" } });
    Object.assign(row, JSON.parse(options.body));
    return new Response(JSON.stringify([row]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const claimed = await db.claimNextSupabaseProductionJob();
    assert.equal(claimed.attemptCount, 2);
    await db.updateSupabaseProductionJob("job-audit", { status: "completed", progress: 100, result: { ok: true } });
    assert.deepEqual(events.map((event) => event.event_type), ["production.job.claimed", "production.job.completed"]);
    assert.equal(events[0].metadata.attemptCount, 2);
    assert.equal(events[1].metadata.attemptCount, 2);
    assert.equal(typeof events[1].metadata.durationMs, "number");
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("hosted project upserts preserve an omitted highlight selection and allow explicit clearing", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const previous = {
    HOSTED_DEMO: process.env.HOSTED_DEMO,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  const bodies = [];
  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return new Response(JSON.stringify([body]), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await db.upsertSupabaseProject({ name: "demo", type: "auto-clipper" });
    await db.upsertSupabaseProject({ name: "demo", type: "auto-clipper", selectedHighlightId: "" });
    assert.equal(Object.hasOwn(bodies[0], "selected_highlight_id"), false);
    assert.equal(Object.hasOwn(bodies[1], "selected_highlight_id"), true);
    assert.equal(bodies[1].selected_highlight_id, null);
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("direct project upserts distinguish omitted, replaced, and cleared highlight selections", async () => {
  const db = await import("../src/services/supabaseDb.js");
  const omitted = db.buildSupabaseProjectUpsert({ name: "demo" });
  const replaced = db.buildSupabaseProjectUpsert({ name: "demo", selectedHighlightId: "highlight-4" });
  const cleared = db.buildSupabaseProjectUpsert({ name: "demo", selectedHighlightId: "" });

  assert.match(omitted.text, /case when \$14 then excluded\.selected_highlight_id else cf_projects\.selected_highlight_id end/);
  assert.equal(omitted.values[10], null);
  assert.equal(omitted.values[13], false);
  assert.equal(replaced.values[10], "highlight-4");
  assert.equal(replaced.values[13], true);
  assert.equal(cleared.values[10], null);
  assert.equal(cleared.values[13], true);
});

test("uploads project assets to a worker-reachable Supabase Storage URL", async (t) => {
  const db = await import("../src/services/supabaseDb.js");
  const root = fs.mkdtempSync(path.join(process.cwd(), "tmp-asset-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const localPath = path.join(root, "clipper", "reaction", "maya.png");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, "maya");
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const originalFetch = global.fetch;
  let uploadCount = 0;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  global.fetch = async () => {
    uploadCount += 1;
    return new Response(JSON.stringify({ Key: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const asset = await db.uploadSupabaseProjectAsset("demo", root, {
      id: "demo:reaction-character:r-1",
      kind: "reaction-character",
      name: "Maya",
      localPath: "clipper/reaction/maya.png",
      url: "/media/demo/clipper/reaction/maya.png",
      mediaType: "image"
    });
    assert.equal(asset.url, "https://project.supabase.co/storage/v1/object/public/contentflow-media/projects/demo/assets/clipper/reaction/maya.png");
    const privateSource = await db.uploadSupabaseProjectAsset("demo", root, {
      id: "demo:clipper-source:source-video.mp4",
      kind: "clipper-source",
      name: "source-video.mp4",
      localPath: "clipper/source/source-video.mp4",
      url: "/media/demo/clipper/source/source-video.mp4",
      mediaType: "video/mp4"
    });
    assert.equal(privateSource.url, "/media/demo/clipper/source/source-video.mp4");
    assert.equal(uploadCount, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});
