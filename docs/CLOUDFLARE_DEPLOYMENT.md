# ContentFlow AI Cloudflare Deployment

## Architecture

ContentFlow AI uses Cloudflare as the hosted control plane while the workstation remains the production engine.

```text
Browser / mobile UI
  -> Cloudflare Worker + static assets
  -> D1: users, clients, campaigns, projects, scripts, jobs, approvals, analytics
  -> R2: reference videos, product assets, reaction characters, generated media, final MP4 files

Local production worker
  -> claims queued jobs from the protected Worker API
  -> runs OpenAI, ffmpeg, yt-dlp, Remotion, and other heavy tools locally
  -> uploads outputs to private R2
  -> updates D1 job and media records

Supabase Auth
  -> remains the login identity provider during this migration
```

D1 stores structured relational records. R2 stores binary media. An R2 object is never treated as a database row: `cf_assets` and `cf_render_jobs` in D1 hold its metadata, ownership, status, checksum, and private playback route.

## Required Local Environment

Create `.env` from `.env.example` and set:

```dotenv
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_WORKER_URL=https://your-worker.workers.dev
CONTENTFLOW_PRODUCTION_TOKEN=

SUPABASE_URL=
SUPABASE_ANON_KEY=
```

`CONTENTFLOW_PRODUCTION_TOKEN` must be a long random value shared only by the deployed Worker and the local production worker. Never expose the Cloudflare API token or production token in frontend variables, Git, screenshots, or lecturer documentation.

Supabase service-role credentials are only needed while importing old data. Hosted login currently continues to use the Supabase URL and anon key. During structured migration, Supabase Auth users are exported through the Admin API and matched by normalized email. Every role account must resolve to its immutable Supabase Auth `auth_user_id`; unresolved or duplicate identities abort the preflight before D1 writes begin.

## Cloudflare API Token

Create a custom API token for the selected Cloudflare account with these account permissions:

- Workers Scripts: Edit
- D1: Edit
- Workers R2 Storage: Edit

`Account Settings: Edit` is not required. A zone permission is not required while using the default `workers.dev` address. Add `Workers Routes: Edit` for the `digitalbee.ai` zone only when a custom domain route is configured.

The token belongs in the local `.env` only. Runtime application access uses D1 and R2 bindings, not the account API token.

## Preview Deployment

1. Install dependencies.

   ```powershell
   npm install
   ```

2. Create preview resources once.

   ```powershell
   node node_modules/wrangler/bin/wrangler.js d1 create contentflow-ai-preview
   node node_modules/wrangler/bin/wrangler.js r2 bucket create contentflow-media-preview
   ```

3. Put the returned D1 database ID in the `preview` binding in `wrangler.jsonc`.

4. Apply D1 migrations.

   ```powershell
   node node_modules/wrangler/bin/wrangler.js d1 migrations apply contentflow-ai-preview --remote --env preview --env-file .env
   ```

5. Upload Worker secrets.

   ```powershell
   node node_modules/wrangler/bin/wrangler.js secret put SUPABASE_URL --env preview
   node node_modules/wrangler/bin/wrangler.js secret put SUPABASE_ANON_KEY --env preview
   node node_modules/wrangler/bin/wrangler.js secret put CONTENTFLOW_PRODUCTION_TOKEN --env preview
   ```

6. Build and deploy.

   ```powershell
   npm run build
   node node_modules/wrangler/bin/wrangler.js deploy --env preview --env-file .env
   ```

7. Import existing structured records and media.

   ```powershell
   node scripts/cloudflare/migrateSupabaseData.js --env-file .env --environment preview
   node scripts/cloudflare/migrateLocalMedia.js --env-file .env --environment preview --projects-dir projects
   ```

The media migration is content-addressed, deduplicated, and checkpointed. Files above 300 MiB use the protected multipart Worker channel. Progress is stored under `.wrangler/`, which is ignored by Git.

A checkpoint is only a candidate for skipping. On every rerun, the migration requires matching D1 asset metadata and performs an authenticated remote `HEAD` against the R2-backed Worker route. A missing object or a size/content-type mismatch is uploaded again. Verification failures abort rather than silently trusting the checkpoint. The structured migration also validates every project `folder_id` against `projects/folders.json` before its first D1 write.

## Local Production Worker

Set `CLOUDFLARE_WORKER_URL` and `CONTENTFLOW_PRODUCTION_TOKEN` in the workstation `.env`, then run:

```powershell
npm run worker
```

When both variables are present, the worker uses the Cloudflare queue. If they are absent, the existing Supabase queue remains available as a temporary rollback path.

## Production Promotion

Promote only after preview authentication, role access, CRUD, media playback, queuing, and local-worker output upload pass.

1. Create `contentflow-ai-production` D1 and `contentflow-media-production` R2 resources.
2. Replace `__D1_PRODUCTION_DATABASE_ID__` in `wrangler.jsonc`.
3. Apply migrations to the top-level production binding without `--env preview`.
4. Upload the three runtime secrets to the production Worker.
5. Import structured data and media with the explicit production environment. `SUPABASE_SERVICE_ROLE_KEY` must be available in the local `.env` for the structured import only.

   ```powershell
   node scripts/cloudflare/migrateSupabaseData.js --env-file .env --environment production
   node scripts/cloudflare/migrateLocalMedia.js --env-file .env --environment production --projects-dir projects
   ```

   The production migration resolves D1 and R2 from the top-level `wrangler.jsonc` bindings. Preview continues to resolve resources from `env.preview`.
6. Run `npm run cloudflare:deploy`.
7. Point the desired `digitalbee.ai` subdomain to the Worker only after the `workers.dev` production URL passes QA.

### Mandatory Cutover Gate

Do not switch the production domain or hosted application until all of these steps are complete:

1. Pause management writes for the short cutover window and finish the final structured/media import.
2. Export the fully migrated production D1 database before routing users to Cloudflare:

   ```powershell
   New-Item -ItemType Directory -Force backups | Out-Null
   node node_modules/wrangler/bin/wrangler.js d1 export contentflow-ai-production --remote --output=backups/contentflow-d1-pre-cutover.sql
   ```

3. Confirm the SQL export exists and is non-empty. This export protects D1 structured records only; it is not an R2 media archive or an automatic Supabase restore package.
4. Keep the existing Supabase database and storage available in read-only mode. Do not delete or rewrite them during the acceptance and rollback window.
5. Retain the local `projects/` tree, local generated outputs, and the preview D1/R2/Worker resources until production acceptance is signed off.
6. Record the previous hosted route and keep a copy of the pre-cutover workstation `.env` so engine routing can be restored exactly.

## Security And Media Access

- R2 buckets remain private.
- Browser playback uses authenticated `/media/assets/:id` routes.
- Video byte-range requests are supported for seeking.
- Users only receive assets linked to projects allowed by their role and client assignment.
- The internal production API requires `CONTENTFLOW_PRODUCTION_TOKEN`.
- Production jobs use renewable leases and guarded terminal transitions to reduce duplicate processing.
- Multipart uploads only accept content-addressed `objects/sha256/...` keys.

## Rollback

Keep Supabase tables and storage unchanged until Cloudflare production has passed acceptance testing. To restore production-engine routing, restore the pre-cutover `.env` (or remove `CLOUDFLARE_WORKER_URL` and `CONTENTFLOW_PRODUCTION_TOKEN` from it), stop the current worker process, and restart `npm run worker`. With those Cloudflare variables absent, the workstation uses the legacy Supabase queue.

This restores engine routing only. It is not a full data rollback and there is no automatic reverse migration. Jobs and outputs created after Cloudflare cutover remain authoritative in D1 and R2 and are not automatically copied back to Supabase. Before restoring the previous Vercel deployment as the primary application, export the required D1 records and download the required R2 objects, then reconcile them manually with the legacy system. The pre-cutover D1 SQL file is evidence and recovery material for Cloudflare structured state; it does not populate Supabase. Keep preview resources online during the rollback window, and do not delete D1, R2, Supabase data, or local project folders until reconciliation is complete.

## Verification Checklist

- `/api/health` returns `200`.
- Unauthenticated project and media requests return `401`.
- Admin, staff, and client accounts see only allowed records.
- D1 project/client/campaign CRUD persists after refresh.
- R2 video playback supports seeking.
- Market report and script jobs move from queued to processing to completed.
- Auto Clipper candidates and active selection persist in D1.
- Local worker output appears in the hosted Media Library.
- Worker-offline jobs remain queued and resume when the workstation returns.
