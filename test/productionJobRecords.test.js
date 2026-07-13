import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("schema stores production progress, results, and worker heartbeats", () => {
  const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
  assert.match(schema, /attempt_count integer not null default 0/i);
  assert.match(schema, /progress integer not null default 0/i);
  assert.match(schema, /result jsonb not null default '\{\}'::jsonb/i);
  assert.match(schema, /create table if not exists cf_worker_heartbeats/i);
  assert.match(schema, /cf_worker_heartbeats[\s\S]*started_at timestamptz not null default now\(\)/i);
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
    hosted: process.env.HOSTED_DEMO,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
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
    process.env.HOSTED_DEMO = previous.hosted;
    process.env.SUPABASE_URL = previous.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
