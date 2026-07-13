# Supabase Auth Setup for FYP Demo

Create these users in Supabase Authentication using email/password accounts. The app maps login emails to `projects/organization.json` staff records and their `cf_users.role`.

| Demo Role | Email | App Role | Expected View |
|---|---|---|---|
| Admin / Manager | `admin@digitalbee.ai` | `admin` | Full dashboard, clients, campaigns, assignments, analytics, Supabase sync |
| Staff / Editor | `editor@digitalbee.ai` | `staff-editor` | Assigned projects, uploads, media preview, status update |
| Manager / Client | `reviewer@digitalbee.ai` | `manager-client` | Client/reviewer media library, approvals, filtered analytics |

For hosted demo mode, set:

```env
REQUIRE_AUTH=true
HOSTED_DEMO=true
```

Hosted demo mode keeps login, role filtering, media library, approval, analytics, and prepared media outputs active. It blocks heavy local-only actions such as live Remotion rendering, yt-dlp downloading, LibTV generation, and OpenAI media generation.

For local production mode, set:

```env
REQUIRE_AUTH=false
HOSTED_DEMO=false
```

Local mode keeps the full AI/render workflow available and allows development without forcing login.
