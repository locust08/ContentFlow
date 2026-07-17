# ContentFlow AI Hybrid Hosting and Worker Guide

## Goal

ContentFlow AI can run as a hosted FYP/demo system on Vercel while the real production engine stays on the local workstation.

Vercel handles:

- Supabase Auth login
- Admin, staff/editor, and client dashboards
- Project and campaign management
- Media library, approvals, and analytics
- Production job requests

The local worker handles:

- Remotion rendering
- ffmpeg processing
- yt-dlp source downloads
- LibTV video generation
- OpenAI analysis/transcription
- ElevenLabs voiceover
- Uploading completed media to Supabase Storage

## Supabase Setup

Run the schema from `supabase/schema.sql`, or use the dashboard `Initialize Supabase` action.

Required table for the hybrid bridge:

- `cf_production_jobs`

Required Supabase Storage bucket:

- `contentflow-media`

For the current prototype, make the bucket public so final media URLs can play in the dashboard. A future production version can replace this with signed URLs.

## Demo User Seeding

Create or refresh the FYP demo users with:

```bash
npm.cmd run seed:demo
```

The seed command:

- Creates/updates Supabase Auth users.
- Writes matching rows to `cf_users`.
- Syncs local clients and campaigns.
- Ensures the `contentflow-media` bucket exists and is public.

Default demo accounts:

```txt
admin@digitalbee.ai     -> admin
editor@digitalbee.ai    -> staff-editor
reviewer@digitalbee.ai  -> manager-client
```

Set three distinct strong passwords before seeding:

```txt
DEMO_ADMIN_PASSWORD=
DEMO_STAFF_PASSWORD=
DEMO_CLIENT_PASSWORD=
```

Each password must be at least 12 characters and include uppercase, lowercase,
number, and symbol characters. The seed command fails before making network or
filesystem changes when any password is missing, weak, or reused.

## Vercel Environment Variables

Set these in the Vercel project:

```txt
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DATABASE_URL=
SUPABASE_STORAGE_BUCKET=contentflow-media
REQUIRE_AUTH=true
HOSTED_DEMO=true
```

Do not put local-only production keys in Vercel unless you intentionally want hosted serverless functions to access them.

Keep these on the local workstation:

```txt
OPENAI_API_KEY=
LIBTV_API_KEY=
ELEVENLABS_API_KEY=
WORKER_POLL_MS=5000
HOSTED_DEMO=false
```

## Local Worker

Start the production worker on the workstation:

```bash
npm run worker
```

For a single polling attempt during testing:

```bash
npm run worker:once
```

The worker checks Supabase for queued jobs, marks one as `processing`, runs the local engine, uploads output media to Supabase Storage when available, then marks the job as `completed` or `failed`.

## Hosted Workflow

1. User logs in to the hosted Vercel app.
2. User opens an assigned project.
3. User clicks a heavy action such as render, analyze, generate UGC, or analyze clipper.
4. Vercel creates a `cf_production_jobs` row with status `queued`.
5. The project page shows the job in the Production Engine panel.
6. Local worker picks up the job when online.
7. Output URL is saved back to Supabase.
8. Hosted dashboard can show completed media from Supabase Storage.

If the local PC is offline, jobs safely remain `queued`.

## Current Worker Job Types

- `analyze-reference`
- `generate-content`
- `generate-images`
- `generate-videos`
- `generate-ugc-video`
- `transcribe-generated-video`
- `generate-voiceover`
- `render-final-video`
- `clipper-source-link`
- `clipper-analyze`
- `clipper-render`
- `clipper-render-bulk`
- `pipeline`

Note: `clipper-render-variations` is queued and visible, but worker automation for multiple reaction-character variation rendering is still marked as future work.

## Deployment Notes

Vercel uses `api/index.js` as the serverless adapter and `vercel.json` for routing.

The local full-power version still runs with:

```bash
npm run app
```

Recommended final FYP demo setup:

- Hosted Vercel app for lecturer login, dashboard, media library, approval, and analytics.
- Local worker running on the workstation during live demo.
- Prepared successful media outputs already synced to Supabase, so the demo remains reliable even if a heavy AI provider is slow.
