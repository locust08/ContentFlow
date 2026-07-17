# ContentFlow AI

AI-assisted content production system for Digital Bee workflows and FYP demonstration. The system supports role-based project management, AI UGC reference replication, auto clipper workflows, media review, analytics, and a hybrid hosted dashboard + local production worker architecture.

## Main Modules

- **Admin dashboard:** clients, campaigns, projects, assignment, media library, analytics, and D1-backed management.
- **Staff/editor workspace:** assigned AI Generator and Auto Clipper projects.
- **Manager/client dashboard:** final media review, approval, and campaign analytics.
- **Hybrid production engine:** Cloudflare queues heavy jobs, while the local workstation runs Remotion, ffmpeg, yt-dlp, external AI services, and voice generation.
- **Cloudflare data layer:** D1 stores structured operational records and private R2 stores uploaded and generated media.

## Local Setup

Copy `.env.example` to `.env` and add keys:

```bash
OPENAI_API_KEY=...
LIBTV_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DATABASE_URL=...
CLOUDFLARE_WORKER_URL=...
CONTENTFLOW_PRODUCTION_TOKEN=...
```

PowerShell may block `npm.ps1`; use `npm.cmd` if needed.

Start the local app:

```bash
npm.cmd run app
```

Open `http://localhost:4173`.

## Authentication Setup

Seed the existing Supabase Auth demo identities before importing role and project records into D1:

```bash
DEMO_ADMIN_PASSWORD=<set-in-your-.env>
DEMO_STAFF_PASSWORD=<set-in-your-.env>
DEMO_CLIENT_PASSWORD=<set-in-your-.env>
npm.cmd run seed:demo
```

Demo account emails and roles:

```txt
admin@digitalbee.ai     admin
editor@digitalbee.ai    staff-editor
reviewer@digitalbee.ai  manager-client
```

All three demo password variables are mandatory and have no defaults. Give Admin, Staff, and Client distinct passwords with at least 12 characters, including uppercase, lowercase, number, and symbol characters. The seed command also makes the legacy Supabase media bucket private. Do not commit passwords.

## Cloudflare Hosted Deployment

The Cloudflare Worker hosts the web app and authenticated API. D1 stores application data, R2 stores private media, and heavy production remains on the local workstation.

Local deployment and worker variables:

```txt
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_WORKER_URL=
CONTENTFLOW_PRODUCTION_TOKEN=
SUPABASE_URL=
SUPABASE_ANON_KEY=
REQUIRE_AUTH=true
```

Start the local production worker:

```bash
npm.cmd run worker
```

When a hosted user requests generation or rendering, the dashboard creates a D1 production job. The local worker claims the job through a protected API, processes it, uploads outputs to private R2, and updates the D1 job status.

More details:

- [Cloudflare deployment and migration guide](docs/CLOUDFLARE_DEPLOYMENT.md)
- [Legacy Supabase/Vercel rollback guide](docs/HYBRID_HOSTING_WORKER.md)

## CLI Usage

Create a project:

```bash
npm.cmd run project -- --name ai-video-prompts
```

Place your reference video at:

```txt
projects/ai-video-prompts/reference/reference.mp4
```

Analyze the reference:

```bash
npm.cmd run analyze -- --project ai-video-prompts
```

Generate ideas and prompts:

```bash
npm.cmd run generate -- --project ai-video-prompts --topic "AI video prompting for creators"
```

Or run both:

```bash
npm.cmd run pipeline -- --project ai-video-prompts --topic "AI video prompting for creators"
```

## Output Files

```txt
projects/<project>/
  analysis/
    frames/
    transcript.json
    metadata.json
    style-analysis.json
  generated/
    content-ideas.json
    script-plan.json
    image-prompts.json
    image-assets.json
    video-prompts.json
    libtv-video-assets.json
    edit-plan.json
```

## Rendering

After scene images or videos exist, render a final vertical MP4:

```bash
npm.cmd run render -- --project demo
```

Output:

```txt
projects/<project>/renders/final.mp4
```
