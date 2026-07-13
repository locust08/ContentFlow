# ContentFlow AI Production Command Center Design

## Purpose

The Production Command Center turns the existing Supabase production-job queue into a reliable operating surface for the hosted ContentFlow dashboard and the local production worker. It gives administrators clear worker health, queue visibility, safe retry and cancellation controls, output access, and an audit trail without changing the fundamental hybrid architecture.

After this feature is implemented, the complete AI Generator and Auto Clipper pipelines will be tested from authenticated project creation through production, Supabase persistence, media review, approval, analytics, and mobile access.

## Scope

Reliable Operations V1 includes:

- Worker online, busy, and offline health states.
- A worker heartbeat with a visible last-seen timestamp.
- Queue totals for queued, processing, completed, failed, and cancelled jobs.
- Automatic queue refresh while the Command Center is open.
- Filtering by status, project, and job type.
- Job details including timestamps, duration, attempt count, error, and output URL.
- Retry for failed or cancelled jobs.
- Cancellation for queued jobs.
- Project and completed-output navigation.
- Automated local-worker support for reaction-character variation jobs.
- Analytics activity records for queue, retry, cancel, claim, completion, and failure events.

V1 does not include manual queue reordering, live log streaming, pausing an active ffmpeg or Remotion process, or precise frame-level progress percentages. These features require process supervision beyond the current worker model and are deferred.

## Architecture

The existing hybrid architecture remains unchanged:

```text
Vercel dashboard
  -> creates and manages Supabase production jobs
Supabase
  -> stores queue records, worker heartbeat, outputs, and audit events
Local production worker
  -> claims queued jobs, runs local production tools, uploads outputs, updates status
```

The Command Center is a new operational view over these existing boundaries. The browser never runs Remotion, ffmpeg, yt-dlp, LibTV, OpenAI, or ElevenLabs directly in hosted mode.

## Job State Model

Allowed job statuses are:

- `queued`: ready for a worker to claim.
- `processing`: claimed by a worker and currently running.
- `completed`: finished successfully; may have an output URL.
- `failed`: stopped after an error; includes a user-readable error.
- `cancelled`: cancelled before a worker claimed it.

Allowed transitions are:

```text
queued -> processing
queued -> cancelled
processing -> completed
processing -> failed
failed -> queued       (retry)
cancelled -> queued    (retry)
```

Completed jobs cannot be retried or cancelled. Processing jobs cannot be cancelled in V1 because the current worker does not supervise child processes safely. A retry clears the previous error and timing fields and returns the same job to `queued` so its identity and history remain traceable. `attempt_count` increments atomically when a worker claims the job, so it represents actual processing attempts rather than button clicks.

## Data Model

Extend `cf_production_jobs` with:

- `attempt_count integer not null default 0`
- `cancelled_at timestamptz`
- `progress integer not null default 0`
- `progress_message text`
- `result jsonb not null default '{}'::jsonb`

`progress` is milestone-based, not a fabricated render percentage:

- `0`: queued
- `10`: claimed
- `25`: inputs prepared
- `75`: production operation completed
- `90`: output upload or persistence in progress
- `100`: completed

Add `cf_worker_heartbeats`:

- `worker_id text primary key`
- `worker_name text not null`
- `status text not null`
- `current_job_id uuid`
- `hostname text`
- `capabilities jsonb not null default '[]'::jsonb`
- `last_seen_at timestamptz not null`
- `started_at timestamptz not null`

A worker is online when `last_seen_at` is within 20 seconds, busy when online with `current_job_id`, and offline otherwise.

## Backend Interfaces

Existing job creation and listing interfaces remain compatible.

Add or extend:

- `GET /api/production-jobs?status=&project=&jobType=`
  - Admin only.
  - Returns filtered jobs, queue summary, and worker health.
- `GET /api/production-workers`
  - Admin only.
  - Returns worker heartbeat records with computed health.
- `POST /api/production-jobs/:id/retry`
  - Admin only.
  - Accepts failed or cancelled jobs and returns the updated queued job.
- `POST /api/production-jobs/:id/cancel`
  - Admin only.
  - Accepts queued jobs only and returns the cancelled job.

Invalid transitions return a clear `409` response. Missing jobs return `404`. Supabase connectivity failures return a safe operational error without exposing credentials or raw database configuration.

## Worker Behavior

The local worker will:

1. Create or update its heartbeat when it starts.
2. Refresh its heartbeat every five seconds while idle or processing.
3. Advertise the job types it supports.
4. Claim only `queued` jobs.
5. Set the heartbeat to busy with the active job ID.
6. Update milestone progress and messages.
7. Upload and persist outputs as it already does.
8. Mark the job completed or failed.
9. Clear the active job and return the heartbeat to online/idle.

The existing `clipper-render-variations` placeholder will be replaced with real worker automation. It will read the selected highlight and selected reaction IDs from the job payload, render one MP4 per selected reaction character, upload each result, persist each render job, and store the multi-output summary in the job's structured `result` field.

If the worker terminates while processing, the heartbeat becomes offline after the health timeout. The job remains `processing` for administrative inspection; V1 will not silently requeue it because the production process may still have produced partial local files. A failed/stale-job recovery action can be added later.

## Frontend Experience

`/manage/jobs` becomes the Production Command Center.

### Header

- Page title and short hybrid-engine explanation.
- Worker health pill with online, busy, or offline state.
- Last heartbeat time.
- Manual refresh action.

### Queue Summary

Five compact metrics:

- Queued
- Processing
- Completed
- Failed
- Cancelled

### Filters

- Status segmented control.
- Project selector.
- Job-type selector.
- Search by job ID, project, or job type.

### Job List

Each job row shows:

- Status and milestone progress.
- Job type and project.
- Requested time and duration.
- Attempt number.
- Progress message or error summary.
- Open project action.
- Open output action when available.
- Retry action for failed or cancelled jobs.
- Cancel action for queued jobs.

A focused details drawer exposes the payload, complete timestamps, full error, requested user, and job identifier. Payload values are displayed read-only and secrets are never included.

### Empty and Offline States

- No jobs: explain that hosted production requests appear here.
- Worker offline with queued jobs: show a prominent warning that jobs are safe but will not start until the local worker runs.
- Worker offline without jobs: show a neutral status rather than an alarming failure.
- API failure: preserve the last successful list where possible and provide Retry.

The page follows the existing Studio Bee holographic glass design and remains readable at desktop, tablet, and mobile widths.

## Roles and Security

- Admin can access the global Command Center, retry jobs, and cancel queued jobs.
- Staff can see job state only within an assigned project workspace; they cannot access `/manage/jobs` or mutate global jobs.
- Client users cannot see production jobs, payloads, worker health, or internal errors.
- Worker heartbeat writes use the server-side Supabase service credentials already used by the local worker.
- API authorization is enforced by the backend, not only hidden in the frontend.

## Analytics and Audit Trail

Record these events in `cf_analytics_events`:

- `production.job.queued`
- `production.job.claimed`
- `production.job.cancelled`
- `production.job.retried`
- `production.job.completed`
- `production.job.failed`
- `production.worker.online`
- `production.worker.offline` once when the backend detects a heartbeat crossing from healthy to expired

Job events include project, job type, attempt count, duration where available, and actor identity for user actions. They must not include API keys, raw access tokens, or full external-provider responses.

## Error Handling

- Expected transition conflicts use `409` with a clear message.
- Worker failures store a concise error on the job and preserve successful outputs from earlier batch items.
- Retry does not delete prior render records or files.
- Cancellation is atomic and succeeds only while the job is still queued.
- Character-variation batches continue after an individual variation fails, preserve successful renders, and finish as failed with a summary when any requested output failed.
- Frontend actions are disabled while their request is pending to prevent duplicate transitions.

## Testing

### Automated Tests

- Job state-transition unit tests.
- Retry and cancellation authorization/API tests.
- Worker heartbeat health calculation tests.
- Worker claim excludes cancelled jobs.
- Worker heartbeat updates while idle and busy.
- Character-variation worker test with mocked render/upload services.
- Command Center role visibility tests.
- Command Center filters and action-state tests.
- Existing frontend, backend, Supabase, mobile, and Remotion tests remain passing.

### Full-System Pipeline Test

After implementation, validate:

```text
Admin login
-> create client and campaign
-> create AI Generator or Auto Clipper project
-> assign staff and client reviewer
-> prepare or upload source assets
-> queue a hosted production job
-> observe queued state while the worker is offline
-> start the local worker
-> observe worker online, claim, progress, and completion
-> verify Supabase job, asset, render, and analytics records
-> play the uploaded final media in the hosted dashboard
-> review and approve as the client
-> verify approval and analytics changes
-> verify assigned staff access in the mobile module
```

Run this once for AI Generator and once for Auto Clipper. The Auto Clipper test includes one selected highlight and at least two reaction characters, producing one output per character. Also queue an intentionally invalid job, confirm failure visibility, repair the input, retry it, and confirm successful completion.

## Acceptance Criteria

- Admin sees accurate queue totals and worker health.
- Offline jobs remain queued without data loss.
- Starting the worker changes health to online and claims a queued job.
- Retry and cancel enforce the allowed state transitions.
- Completed outputs link to playable hosted media.
- Character variations run through the local worker without using the local-only dashboard action.
- Job and worker actions appear in the analytics audit trail.
- Staff and clients cannot access administrator production controls.
- The full AI Generator and Auto Clipper pipeline test passes with documented evidence.
