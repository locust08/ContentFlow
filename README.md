# ContentFlow AI

AI-assisted content production system for Digital Bee workflows and FYP demonstration. The system supports role-based project management, AI UGC reference replication, auto clipper workflows, media review, analytics, and a hybrid hosted dashboard + local production worker architecture.

## Main Modules

- **Admin dashboard:** clients, campaigns, projects, assignment, media library, analytics, and Supabase sync.
- **Staff/editor workspace:** assigned AI Generator and Auto Clipper projects.
- **Manager/client dashboard:** final media review, approval, and campaign analytics.
- **Hybrid production engine:** Vercel queues heavy jobs, while the local workstation runs Remotion, ffmpeg, yt-dlp, LibTV, OpenAI, and ElevenLabs.

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
```

PowerShell may block `npm.ps1`; use `npm.cmd` if needed.

Start the local app:

```bash
npm.cmd run app
```

Open `http://localhost:4173`.

## Supabase Demo Setup

Seed demo Auth users, role records, client/campaign records, and the public media bucket:

```bash
npm.cmd run seed:demo
```

Default demo accounts:

```txt
admin@digitalbee.ai     admin
editor@digitalbee.ai    staff-editor
reviewer@digitalbee.ai  manager-client
```

Set `DEMO_USER_PASSWORD` in `.env` before seeding if you want a custom password.

## Hybrid Hosted Deployment

The hosted Vercel app is the control dashboard. Heavy production runs locally through the worker.

Vercel environment variables:

```txt
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DATABASE_URL=
SUPABASE_STORAGE_BUCKET=contentflow-media
REQUIRE_AUTH=true
HOSTED_DEMO=true
```

Start the local production worker:

```bash
npm.cmd run worker
```

When a hosted user requests generation/rendering, the dashboard creates a Supabase production job. The local worker picks up queued jobs, processes them, uploads outputs to Supabase Storage, and updates job status.

More details:

- [Hybrid hosting guide](docs/HYBRID_HOSTING_WORKER.md)
- [Vercel deployment checklist](docs/VERCEL_DEPLOYMENT_CHECKLIST.md)

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

## Next Phases

- Add OpenAI image generation for scene stills.
- Add libtv video generation once the API docs/request format are available.
- Add a Remotion composition that reads `edit-plan.json`.
- Add a small dashboard for upload, review, approve, and render.

## Rendering

After scene images or videos exist, render a final vertical MP4:

```bash
npm.cmd run render -- --project demo
```

Output:

```txt
projects/<project>/renders/final.mp4
```
