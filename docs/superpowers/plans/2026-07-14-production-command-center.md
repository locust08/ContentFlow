# Production Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable Production Command Center with worker health, queue controls, progress milestones, automated reaction-character variations, and a documented end-to-end system test.

**Architecture:** Keep Vercel as the control dashboard, Supabase as the shared queue and audit store, and the local workstation as the production worker. Add pure job-state helpers, atomic Supabase queue operations, worker heartbeats, and a focused React Command Center that polls operational state without changing existing project production APIs.

**Tech Stack:** Node.js 20+, React 19, Vite, Supabase PostgreSQL/REST, Node test runner, Vitest, React Testing Library, Remotion, ffmpeg, yt-dlp.

## Global Constraints

- Preserve the hosted-dashboard plus local-worker architecture.
- Only `queued` jobs may be cancelled.
- Only `failed` or `cancelled` jobs may be retried.
- Processing jobs cannot be cancelled in V1.
- Use milestone progress values `0`, `10`, `25`, `75`, `90`, and `100`; do not invent frame-level percentages.
- Admin has global Command Center access; staff has project-scoped job visibility; clients have no production-job access.
- Never expose API keys, access tokens, Supabase credentials, or raw external-provider responses.
- Preserve existing project data, local render files, Supabase records, and production API compatibility.
- Follow the current Studio Bee holographic glass design and 8px maximum panel radius.

---

## File Structure

- `src/services/productionJobs.js`: pure job statuses, transitions, summaries, progress, and worker-health calculations.
- `src/services/supabaseDb.js`: Supabase job and worker-heartbeat persistence with atomic status filters.
- `src/services/clipperVariations.js`: shared reaction-character discovery and variation rendering used by local HTTP and worker paths.
- `src/worker/productionWorker.js`: heartbeat lifecycle, progress updates, job processing, and variation automation.
- `src/server.js`: authenticated Command Center HTTP interfaces and use of the shared variation service.
- `src/frontend/state/useProductionCommandCenter.js`: queue polling, filters, retry, cancel, and details state.
- `src/frontend/pages/ProductionCommandCenter.jsx`: focused admin operational page.
- `src/frontend/styles/pages.css`: responsive queue, worker-health, progress, and details-drawer styles.
- `supabase/schema.sql`: production-job extensions and worker-heartbeat table.
- `test/productionJobs.test.js`: pure transition and summary tests.
- `test/productionCommandCenterApi.test.js`: route authorization and transition response tests.
- `test/clipperVariations.test.js`: multi-character rendering and partial-failure tests.
- `test/productionWorker.test.js`: heartbeat and worker lifecycle tests with injected dependencies.
- `src/frontend/pages/ProductionCommandCenter.vitest.jsx`: Command Center rendering and interaction tests.
- `docs/FYP_SYSTEM_TEST_RESULTS.md`: final manual pipeline evidence and outcomes.

---

### Task 1: Production Job Domain Rules

**Files:**
- Modify: `src/services/productionJobs.js`
- Modify: `test/productionJobs.test.js`

**Interfaces:**
- Produces: `PRODUCTION_JOB_STATUSES`, `canCancelProductionJob(job)`, `canRetryProductionJob(job)`, `productionJobSummary(jobs)`, `productionJobDuration(job, now)`, `workerHealth(worker, now, timeoutMs)`.
- Consumes: Existing `buildProductionJob()` and `jobTypeForAction()` contracts.

- [ ] **Step 1: Write failing domain tests**

Add tests that assert the exact state rules and health timeout:

```js
import {
  canCancelProductionJob,
  canRetryProductionJob,
  productionJobDuration,
  productionJobSummary,
  workerHealth
} from "../src/services/productionJobs.js";

test("enforces retry and cancellation transitions", () => {
  assert.equal(canCancelProductionJob({ status: "queued" }), true);
  assert.equal(canCancelProductionJob({ status: "processing" }), false);
  assert.equal(canRetryProductionJob({ status: "failed" }), true);
  assert.equal(canRetryProductionJob({ status: "cancelled" }), true);
  assert.equal(canRetryProductionJob({ status: "completed" }), false);
});

test("summarizes queue state and duration", () => {
  const jobs = [
    { status: "queued" },
    { status: "failed" },
    { status: "failed" }
  ];
  assert.deepEqual(productionJobSummary(jobs), {
    queued: 1,
    processing: 0,
    completed: 0,
    failed: 2,
    cancelled: 0,
    total: 3
  });
  assert.equal(productionJobDuration({ startedAt: "2026-07-14T00:00:00.000Z", completedAt: "2026-07-14T00:00:05.000Z" }), 5000);
});

test("computes worker online, busy, and offline health", () => {
  const now = Date.parse("2026-07-14T00:00:30.000Z");
  assert.equal(workerHealth({ lastSeenAt: "2026-07-14T00:00:20.000Z", currentJobId: "job-1" }, now).status, "busy");
  assert.equal(workerHealth({ lastSeenAt: "2026-07-14T00:00:20.000Z", currentJobId: "" }, now).status, "online");
  assert.equal(workerHealth({ lastSeenAt: "2026-07-14T00:00:00.000Z", currentJobId: "" }, now).status, "offline");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/productionJobs.test.js`

Expected: FAIL because the new helpers are not exported.

- [ ] **Step 3: Implement the pure job helpers**

Add:

```js
export const PRODUCTION_JOB_STATUSES = Object.freeze(["queued", "processing", "completed", "failed", "cancelled"]);

export function canCancelProductionJob(job) {
  return job?.status === "queued";
}

export function canRetryProductionJob(job) {
  return job?.status === "failed" || job?.status === "cancelled";
}

export function productionJobSummary(jobs = []) {
  const summary = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, total: jobs.length };
  for (const job of jobs) {
    if (Object.hasOwn(summary, job?.status)) summary[job.status] += 1;
  }
  return summary;
}

export function productionJobDuration(job, now = Date.now()) {
  if (!job?.startedAt) return 0;
  const start = Date.parse(job.startedAt);
  const end = job.completedAt ? Date.parse(job.completedAt) : Number(now);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export function workerHealth(worker, now = Date.now(), timeoutMs = 20000) {
  if (!worker?.lastSeenAt) return { status: "offline", ageMs: Infinity };
  const ageMs = Math.max(0, Number(now) - Date.parse(worker.lastSeenAt));
  if (!Number.isFinite(ageMs) || ageMs > timeoutMs) return { status: "offline", ageMs };
  return { status: worker.currentJobId ? "busy" : "online", ageMs };
}
```

- [ ] **Step 4: Run the domain tests and verify GREEN**

Run: `node --test test/productionJobs.test.js`

Expected: all production-job domain tests pass.

- [ ] **Step 5: Commit the domain rules**

```powershell
git add src/services/productionJobs.js test/productionJobs.test.js
git commit -m "feat: define production job state rules"
```

---

### Task 2: Supabase Queue and Worker Persistence

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/services/supabaseDb.js`
- Create: `test/productionJobRecords.test.js`

**Interfaces:**
- Consumes: Task 1 state names and health semantics.
- Produces: `getSupabaseProductionJob(id)`, `retrySupabaseProductionJob(id)`, `cancelSupabaseProductionJob(id)`, `upsertSupabaseWorkerHeartbeat(worker)`, `listSupabaseWorkerHeartbeats()`, `setSupabaseWorkerHeartbeatStatus(workerId, status)`, and extended `updateSupabaseProductionJob(id, patch)`.

- [ ] **Step 1: Write failing schema and mapping tests**

Create a test that reads `supabase/schema.sql` and imports the exported record mappers:

```js
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
```

- [ ] **Step 2: Run the record tests and verify RED**

Run: `node --test test/productionJobRecords.test.js`

Expected: FAIL because the schema columns and exported mappers are missing.

- [ ] **Step 3: Extend the schema and repository**

Add idempotent columns and the worker table:

```sql
alter table cf_production_jobs add column if not exists attempt_count integer not null default 0;
alter table cf_production_jobs add column if not exists cancelled_at timestamptz;
alter table cf_production_jobs add column if not exists progress integer not null default 0;
alter table cf_production_jobs add column if not exists progress_message text;
alter table cf_production_jobs add column if not exists result jsonb not null default '{}'::jsonb;

create table if not exists cf_worker_heartbeats (
  worker_id text primary key,
  worker_name text not null,
  status text not null default 'online',
  current_job_id uuid references cf_production_jobs(id) on delete set null,
  hostname text,
  capabilities jsonb not null default '[]'::jsonb,
  last_seen_at timestamptz not null default now(),
  started_at timestamptz not null default now()
);
```

Implement both PostgreSQL and hosted REST branches. Atomic cancellation must filter by `id` and `status = 'queued'`; retry must filter by `id` and `status in ('failed','cancelled')`. Claiming must increment `attempt_count`, clear stale completion fields, and set progress to `10`. `setSupabaseWorkerHeartbeatStatus(workerId, status)` must update only the status and last database update timestamp; it must not refresh `last_seen_at`, because an expired worker is still offline.

Map these exact fields:

```js
export function mapProductionJobRecord(row) {
  return row ? {
    id: row.id,
    projectName: row.project_name,
    jobType: row.job_type,
    status: row.status,
    payload: row.payload || {},
    requestedBy: row.requested_by || "",
    outputUrl: row.output_url || "",
    error: row.error || "",
    attemptCount: Number(row.attempt_count || 0),
    progress: Number(row.progress || 0),
    progressMessage: row.progress_message || "",
    result: row.result || {},
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    updatedAt: row.updated_at
  } : null;
}
```

- [ ] **Step 4: Run record and existing Supabase tests**

Run: `node --test test/productionJobRecords.test.js test/hostedAnalytics.test.js test/activityFeed.test.js`

Expected: all selected tests pass.

- [ ] **Step 5: Commit persistence changes**

```powershell
git add supabase/schema.sql src/services/supabaseDb.js test/productionJobRecords.test.js
git commit -m "feat: persist production operations and worker health"
```

---

### Task 3: Command Center Admin APIs

**Files:**
- Modify: `src/server.js`
- Create: `test/productionCommandCenterApi.test.js`

**Interfaces:**
- Consumes: Task 2 repository functions.
- Produces: `GET /api/production-jobs`, `GET /api/production-workers`, `POST /api/production-jobs/:id/retry`, and `POST /api/production-jobs/:id/cancel`.

- [ ] **Step 1: Write failing route-contract tests**

Use the existing `handleRequest` server harness. Assert that list responses contain `jobs`, `summary`, and `workers`; invalid retry/cancel IDs return `404`; invalid transitions use `409`; and client-role requests receive `403` when auth fixtures are enabled.

Core assertions:

```js
const list = await fetch(`${baseUrl}/api/production-jobs`);
assert.equal(list.status, 200);
const body = await list.json();
assert.ok(Array.isArray(body.jobs));
assert.equal(typeof body.summary.queued, "number");
assert.ok(Array.isArray(body.workers));

const retry = await fetch(`${baseUrl}/api/production-jobs/00000000-0000-0000-0000-000000000000/retry`, { method: "POST" });
assert.equal(retry.status, 404);
```

- [ ] **Step 2: Run the API test and verify RED**

Run: `node --test test/productionCommandCenterApi.test.js`

Expected: FAIL because mutation routes and operational response fields do not exist.

- [ ] **Step 3: Implement authenticated routes**

Update imports and route handling. The list route must call `requireAdmin()`, accept `status`, `project`, and `jobType`, compute `productionJobSummary(jobs)`, and attach worker records with `workerHealth()` results.

Mutation behavior:

```js
if (req.method === "POST" && parts[1] === "production-jobs" && parts[3] === "retry") {
  requireAdmin();
  const current = await getSupabaseProductionJob(parts[2]);
  if (!current) return sendJson(res, 404, { error: "Production job was not found." });
  if (!canRetryProductionJob(current)) return sendJson(res, 409, { error: `A ${current.status} production job cannot be retried.` });
  const job = await retrySupabaseProductionJob(parts[2]);
  await recordSupabaseActivityEvent({ eventType: "production.job.retried", projectName: job.projectName, actor: requestUser, summary: `${job.jobType} queued for retry`, metadata: { jobId: job.id, jobType: job.jobType, attemptCount: job.attemptCount } });
  return sendJson(res, 200, { job });
}
```

Implement cancellation with the same shape and event type `production.job.cancelled`. Return `409` when the job exists but its state disallows the transition; use `getSupabaseProductionJob(id)` to distinguish that case from `404`.

When the list route computes an expired worker whose stored `status` is not `offline`, call `setSupabaseWorkerHeartbeatStatus(workerId, "offline")` and record one `production.worker.offline` event. Subsequent refreshes see the persisted offline status and must not create duplicate events. A new worker heartbeat changes the stored status back to `online` or `busy`.

- [ ] **Step 4: Run API and access tests**

Run: `node --test test/productionCommandCenterApi.test.js test/access.test.js test/activityFeed.test.js`

Expected: all selected tests pass.

- [ ] **Step 5: Commit the Command Center APIs**

```powershell
git add src/server.js test/productionCommandCenterApi.test.js
git commit -m "feat: add production command center APIs"
```

---

### Task 4: Shared Reaction Variation Renderer

**Files:**
- Create: `src/services/clipperVariations.js`
- Modify: `src/server.js`
- Modify: `src/worker/productionWorker.js`
- Create: `test/clipperVariations.test.js`

**Interfaces:**
- Consumes: `renderClipperVideo()`, selected highlight JSON, reaction manifest and legacy reaction assets.
- Produces: `listClipperReactions(projectDir, project)`, `renderClipperVariations(options)` returning `{ renderedAt, mode, selectedHighlight, count, completed, failed, outputs }`.

- [ ] **Step 1: Write failing variation-service tests**

Create temporary project manifests with two reaction IDs. Inject a render function that succeeds for one reaction and throws for the other. Assert identical highlight metadata, stable output naming, one completed output, one failed output, and a written manifest.

```js
const result = await renderClipperVariations({
  project: "demo",
  projectDir,
  port: 4173,
  cwd: root,
  reactionIds: ["r-1", "r-2"],
  renderClip: async ({ outputName, reactionAsset }) => {
    if (reactionAsset.id === "r-2") throw new Error("render failed");
    return { output: `renders/clips/${outputName}`, clipStart: 4, clipEnd: 34 };
  }
});
assert.equal(result.completed, 1);
assert.equal(result.failed, 1);
assert.equal(result.outputs[0].reactionId, "r-1");
assert.match(result.outputs[0].output, /^renders\/clips\/char-01-/);
```

- [ ] **Step 2: Run the variation test and verify RED**

Run: `node --test test/clipperVariations.test.js`

Expected: FAIL because the shared service does not exist.

- [ ] **Step 3: Extract and implement shared rendering**

Move reaction discovery, slug-safe output naming, per-character error preservation, and manifest writing out of `src/server.js`. The service must throw before rendering when no selected highlight or no matching reaction IDs exist. It must continue after one variation fails.

Replace the local HTTP route loop with:

```js
const result = await renderClipperVariations({ project, projectDir: safeProject(project), port, cwd: rootDir, reactionIds: body.reactionIds });
const supabaseWarning = await trySupabaseWrite(() => syncProjectRendersToSupabase(project));
return sendJson(res, result.failed ? 207 : 200, { ok: result.failed === 0, result, data: projectData(project), supabaseWarning });
```

Replace the worker placeholder with the same service and upload/persist every completed output before returning the structured result.

- [ ] **Step 4: Run variation, workspace, and production tests**

Run: `node --test test/clipperVariations.test.js test/productionJobs.test.js; npm.cmd run test:frontend -- --run src/frontend/pages/ProjectWorkspaces.vitest.jsx`

Expected: all selected tests pass.

- [ ] **Step 5: Commit shared variation automation**

```powershell
git add src/services/clipperVariations.js src/server.js src/worker/productionWorker.js test/clipperVariations.test.js
git commit -m "feat: automate worker character variations"
```

---

### Task 5: Worker Heartbeat and Progress Lifecycle

**Files:**
- Modify: `src/worker/productionWorker.js`
- Create: `test/productionWorker.test.js`

**Interfaces:**
- Consumes: Task 2 `upsertSupabaseWorkerHeartbeat()` and extended `updateSupabaseProductionJob()`.
- Produces: exported `createProductionWorker(dependencies)` and `runWorker(options)` with testable tick, heartbeat, and shutdown behavior.

- [ ] **Step 1: Write failing worker lifecycle tests**

Use dependency injection with in-memory arrays. Verify idle heartbeat, busy heartbeat, progress order, completion cleanup, and failure cleanup.

```js
const heartbeats = [];
const updates = [];
const worker = createProductionWorker({
  workerId: "test-worker",
  workerName: "Test Worker",
  claimJob: async () => ({ id: "job-1", projectName: "demo", jobType: "pipeline", payload: {} }),
  updateJob: async (id, patch) => updates.push({ id, patch }),
  updateHeartbeat: async (heartbeat) => heartbeats.push(heartbeat),
  processJob: async () => ({ outputUrl: "https://example.test/final.mp4" }),
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
await worker.tick();
assert.equal(heartbeats.some((item) => item.currentJobId === "job-1" && item.status === "busy"), true);
assert.equal(heartbeats.at(-1).status, "online");
assert.deepEqual(updates.map((item) => item.patch.progress), [25, 75, 90, 100]);
```

- [ ] **Step 2: Run the worker test and verify RED**

Run: `node --test test/productionWorker.test.js`

Expected: FAIL because the injectable worker factory does not exist.

- [ ] **Step 3: Implement the worker runtime**

Create a stable worker ID from `CONTENTFLOW_WORKER_ID` or hostname, advertise `PRODUCTION_JOB_TYPES`, and update heartbeat every five seconds. Use `try/finally` so the active job ID is always cleared.

Required milestone calls inside `tick()`:

```js
await updateJob(job.id, { status: "processing", progress: 25, progressMessage: "Preparing production inputs" });
const result = await processJob(job);
await updateJob(job.id, { status: "processing", progress: 75, progressMessage: "Production operation completed", result });
await updateJob(job.id, { status: "processing", progress: 90, progressMessage: "Saving output records", result });
await updateJob(job.id, { status: "completed", progress: 100, progressMessage: "Completed", outputUrl: result?.outputUrl || "", result });
```

On error, set `status: "failed"`, retain the last milestone, and store only `error.message`. Ensure the process entry point remains `npm run worker` compatible.

- [ ] **Step 4: Run worker and repository tests**

Run: `node --test test/productionWorker.test.js test/productionJobRecords.test.js test/productionJobs.test.js`

Expected: all selected tests pass.

- [ ] **Step 5: Commit worker lifecycle changes**

```powershell
git add src/worker/productionWorker.js test/productionWorker.test.js
git commit -m "feat: report worker health and job progress"
```

---

### Task 6: React Production Command Center

**Files:**
- Create: `src/frontend/state/useProductionCommandCenter.js`
- Create: `src/frontend/pages/ProductionCommandCenter.jsx`
- Create: `src/frontend/pages/ProductionCommandCenter.vitest.jsx`
- Modify: `src/frontend/App.jsx`
- Modify: `src/frontend/pages/ManagementPages.jsx`
- Modify: `src/frontend/styles/pages.css`
- Modify: `src/frontend/styles/components.css`

**Interfaces:**
- Consumes: Task 3 Command Center APIs and existing `Button`, `Badge`, `Card`, `EmptyState`, and `MetricCard` components.
- Produces: `/manage/jobs` operational UI with polling, filters, job details, retry, and cancel.

- [ ] **Step 1: Write failing page interaction tests**

Mock the Command Center hook data and assert:

```jsx
expect(screen.getByRole("heading", { name: "Production Command Center" })).toBeInTheDocument();
expect(screen.getByText("Worker offline")).toBeInTheDocument();
expect(within(screen.getByText("Failed").closest("article")).getByText("1")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "Retry failed job" }));
expect(retryJob).toHaveBeenCalledWith("job-failed");
fireEvent.click(screen.getByRole("button", { name: "Cancel queued job" }));
expect(cancelJob).toHaveBeenCalledWith("job-queued");
```

Also verify completed jobs expose an output link, processing jobs have neither retry nor cancel, and opening a job shows payload/timestamps without rendering a key named `apiKey`, `token`, or `authorization`.

- [ ] **Step 2: Run the page test and verify RED**

Run: `npm.cmd run test:frontend -- --run src/frontend/pages/ProductionCommandCenter.vitest.jsx`

Expected: FAIL because the page and hook do not exist.

- [ ] **Step 3: Implement the polling hook**

The hook owns filters and refreshes every five seconds only while mounted:

```js
export function useProductionCommandCenter() {
  const [filters, setFilters] = useState({ status: "", project: "", jobType: "", search: "" });
  const [data, setData] = useState({ jobs: [], summary: productionJobSummary([]), workers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    const result = await api(`/api/production-jobs?${params}`);
    setData(result);
    setError("");
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    refresh().catch((reason) => { setError(reason.message); setLoading(false); });
    const timer = window.setInterval(() => refresh().catch((reason) => setError(reason.message)), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { ...data, filters, setFilters, loading, error, refresh };
}
```

Add retry and cancel methods that disable only the active job action, call the mutation API, and refresh once.

- [ ] **Step 4: Implement the focused page and styles**

Render worker health, five summary metrics, filters, responsive job rows, progress bars, action buttons, and a read-only details drawer. Replace `JobsPage` routing in `App.jsx` with `ProductionCommandCenter`. Delete the old inline `JobsPage` export only after the new route test passes.

Use status-aware classes and add `badge--cancelled` styling. At widths below 650px, stack job metadata and keep buttons at least 44px high.

- [ ] **Step 5: Run frontend tests and build**

Run: `npm.cmd run test:frontend; npm.cmd run build`

Expected: all frontend tests pass and Vite exits successfully.

- [ ] **Step 6: Commit the Command Center frontend**

```powershell
git add src/frontend/state/useProductionCommandCenter.js src/frontend/pages/ProductionCommandCenter.jsx src/frontend/pages/ProductionCommandCenter.vitest.jsx src/frontend/App.jsx src/frontend/pages/ManagementPages.jsx src/frontend/styles/pages.css src/frontend/styles/components.css
git commit -m "feat: build production command center"
```

---

### Task 7: Full-System Pipeline Validation and Evidence

**Files:**
- Create: `docs/FYP_SYSTEM_TEST_RESULTS.md`
- Modify: `docs/FYP_EVIDENCE_PACKAGE.md`

**Interfaces:**
- Consumes: the complete hosted app, Supabase project, local worker, prepared test media, and demo user accounts.
- Produces: repeatable FYP test evidence with timestamps, project IDs, job IDs, output URLs, and pass/fail results.

- [ ] **Step 1: Run the complete automated verification gate**

Run:

```powershell
npm.cmd run test:frontend
node --test
npm.cmd run build
npx.cmd remotion compositions src/remotion/index.jsx --log=error
npm.cmd audit --omit=dev
```

Expected: zero test failures, successful build and composition discovery, and zero production dependency vulnerabilities.

- [ ] **Step 2: Initialize the Supabase schema extension**

Run the existing schema initialization action from `/manage/settings`, then verify `cf_production_jobs` contains the new columns and `cf_worker_heartbeats` exists. Record the timestamp and result in `docs/FYP_SYSTEM_TEST_RESULTS.md`.

- [ ] **Step 3: Validate offline queue behavior**

Stop the local worker, create one hosted production request, and verify:

- Job status remains `queued`.
- Command Center shows worker offline.
- Offline warning explains that the queued job is safe.
- Supabase retains the job record after page refresh.

- [ ] **Step 4: Validate worker processing behavior**

Run: `npm.cmd run worker`

Verify worker health becomes online/busy, milestone progress advances, the job completes, output records persist, and the media URL plays in the hosted dashboard.

- [ ] **Step 5: Validate retry and cancellation**

Queue one job and cancel it before the worker claims it. Confirm it is never processed. Queue an intentionally invalid job, confirm the stored failure, repair the input, retry the same job, and confirm its next claim increments `attempt_count` and completes.

- [ ] **Step 6: Validate both production workflows**

AI Generator:

```text
reference + product + character
-> analyze reference
-> generate UGC
-> transcribe generated video
-> render final MP4
```

Auto Clipper:

```text
source link
-> analyze highlights
-> select one highlight
-> select at least two reaction characters
-> render character variations
-> receive one MP4 per character
```

Record job IDs, result counts, output URLs, and playback results.

- [ ] **Step 7: Validate roles, approval, analytics, and mobile**

Verify:

- Admin sees Command Center controls.
- Staff sees only assigned projects and project-scoped job status.
- Client sees no internal job data.
- Client approves one final output.
- Approval and production activity appear in analytics.
- `/mobile.html` loads assigned staff projects and permits the expected upload/review actions.

- [ ] **Step 8: Write the evidence report**

Create a table with columns `Test ID`, `Module`, `Input`, `Expected`, `Actual`, `Status`, and `Evidence`. Include environment, commit hash, test timestamp, Supabase verification, job IDs, worker ID, and final output URLs. Update `docs/FYP_EVIDENCE_PACKAGE.md` to link the results.

- [ ] **Step 9: Commit the evidence**

```powershell
git add docs/FYP_SYSTEM_TEST_RESULTS.md docs/FYP_EVIDENCE_PACKAGE.md
git commit -m "docs: record full ContentFlow pipeline validation"
```

---

## Final Delivery Gate

- [ ] Re-run `git diff --check` and confirm a clean worktree after commits.
- [ ] Push `codex/production-command-center` to GitHub.
- [ ] Merge through the normal review path into `main`.
- [ ] Deploy the production Vercel project.
- [ ] Verify `https://contentflow-ai-phi.vercel.app/manage/jobs` returns HTTP 200 and the authenticated admin view loads.
- [ ] Keep the local worker command and workstation setup documented for the live FYP demonstration.
