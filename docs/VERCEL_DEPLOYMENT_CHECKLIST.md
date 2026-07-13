# ContentFlow AI Vercel Deployment Checklist

## 1. Supabase

- Run `npm.cmd run seed:demo`.
- Open Supabase and confirm these tables exist:
  - `cf_users`
  - `cf_clients`
  - `cf_campaigns`
  - `cf_projects`
  - `cf_assets`
  - `cf_render_jobs`
  - `cf_clip_candidates`
  - `cf_production_jobs`
- Confirm Storage bucket exists:
  - `contentflow-media`
- Confirm demo users can log in:
  - Admin
  - Staff/editor
  - Manager/client

## 2. GitHub

- Push the project repository to GitHub.
- Do not commit `.env`.
- Confirm `.env.example`, `vercel.json`, and `api/index.js` are included.

## 3. Vercel

Import the GitHub repo into Vercel.

Add environment variables:

```txt
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DATABASE_URL=
SUPABASE_STORAGE_BUCKET=contentflow-media
REQUIRE_AUTH=true
HOSTED_DEMO=true
```

Do not add local-only production keys unless needed for a specific test.

## 4. Hosted Test

- Visit the Vercel URL.
- Log in as Admin and confirm:
  - Dashboard visible
  - Projects visible
  - Media library visible
  - Analytics visible
- Log in as Staff/editor and confirm:
  - Only assigned projects visible
  - Client/admin controls hidden
- Log in as Manager/client and confirm:
  - Only media/review dashboard visible
  - AI Generator and Auto Clipper controls hidden

## 5. Local Worker Test

On the workstation:

```bash
npm.cmd run worker
```

From the hosted app:

- Open a project.
- Click a heavy action such as render/generate/analyze.
- Confirm job appears as `queued`.
- Confirm worker changes it to `processing`.
- Confirm completed output uploads to Supabase Storage.
- Confirm hosted dashboard shows completed output.

## 6. FYP Evidence

Capture screenshots for:

- Login screen
- Admin dashboard
- Staff/editor assigned project view
- Client media library
- Analytics dashboard
- Supabase tables
- Supabase Storage bucket
- Production job queue
- Local worker terminal processing a job
