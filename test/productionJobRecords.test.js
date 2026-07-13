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
