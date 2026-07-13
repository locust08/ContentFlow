# ContentFlow AI FYP Evidence Package

## System Summary

ContentFlow AI is an AI-assisted content operations management system for a small social media agency. It manages clients, campaigns, projects, uploaded media assets, AI Generator outputs, Auto Clipper outputs, approval review, mobile staff actions, and production analytics through a web dashboard, mobile PWA module, and Supabase PostgreSQL backend.

## ERD

```mermaid
erDiagram
  CF_USERS {
    text id PK
    uuid auth_user_id
    text name
    text role
    text email
    text client_id
  }
  CF_CLIENTS {
    text id PK
    text name
    text industry
    text contact
  }
  CF_CAMPAIGNS {
    text id PK
    text client_id FK
    text name
    text objective
    text status
  }
  CF_PROJECTS {
    text name PK
    text type
    text folder_id
    text client_id FK
    text campaign_id FK
    text assigned_staff_id
    text reviewer_id
    text approval_status
  }
  CF_ASSETS {
    text id PK
    text project_name FK
    text kind
    text name
    text media_type
    text local_path
    text url
  }
  CF_CLIP_CANDIDATES {
    text id PK
    text project_name FK
    text title
    numeric start_seconds
    numeric end_seconds
    numeric score
  }
  CF_RENDER_JOBS {
    text id PK
    text project_name FK
    text mode
    text status
    text output_path
    text render_type
  }
  CF_APPROVAL_EVENTS {
    uuid id PK
    text project_name FK
    text status
    text feedback
  }
  CF_ANALYTICS_EVENTS {
    uuid id PK
    text event_type
    text project_name
    jsonb metadata
  }
  CF_CLIENTS ||--o{ CF_CAMPAIGNS : owns
  CF_CLIENTS ||--o{ CF_PROJECTS : receives
  CF_CAMPAIGNS ||--o{ CF_PROJECTS : contains
  CF_PROJECTS ||--o{ CF_ASSETS : stores
  CF_PROJECTS ||--o{ CF_CLIP_CANDIDATES : generates
  CF_PROJECTS ||--o{ CF_RENDER_JOBS : renders
  CF_PROJECTS ||--o{ CF_APPROVAL_EVENTS : reviews
```

## System Flow

```mermaid
flowchart TD
  A["Admin logs in"] --> B["Create client and campaign"]
  B --> C["Create AI Generator or Auto Clipper project"]
  C --> D["Assign staff/editor and reviewer/client"]
  D --> E["Staff opens mobile or web workspace"]
  E --> F["Upload assets or prepare source media"]
  F --> G["Generate UGC or clip highlights"]
  G --> H["Render or attach prepared final MP4"]
  H --> I["Client/manager reviews media"]
  I --> J{"Approval decision"}
  J -->|Approved| K["Final output stored in media library"]
  J -->|Changes requested| E
  K --> L["Supabase analytics dashboard"]
```

## Role-Based Workflow

```mermaid
flowchart LR
  Admin["Admin / Manager"] -->|"Creates clients, campaigns, projects, assignments"| Web["Web Dashboard"]
  Staff["Staff / Editor"] -->|"Uploads assets, previews outputs, updates status"| Mobile["Mobile PWA"]
  Client["Manager / Client"] -->|"Reviews media, approves or requests changes"| ClientView["Client Media Dashboard"]
  Web --> DB["Supabase PostgreSQL"]
  Mobile --> DB
  ClientView --> DB
```

## FYP Checklist Mapping

| Requirement | Evidence in System |
|---|---|
| Real organization/domain | Small social media agency / Digital Bee content production workflow |
| Web application | Admin dashboard for projects, clients, campaigns, media, analytics |
| Mobile application | Installable mobile staff PWA at `/mobile.html` |
| Database backend | Supabase PostgreSQL schema and API write-through |
| Digital content management | Assets, source videos, final MP4s, clip candidates, approvals |
| Data analysis | Supabase analytics for projects, renders, approvals, workload, assets |
| Not rental/booking system | Content operations and digital asset management system |

## Functional Test Matrix

| Test Case | Expected Result | Status |
|---|---|---|
| Admin login | Admin dashboard, project creation, Supabase sync visible | Ready for demo account testing |
| Staff login | Only assigned projects visible | Ready for demo account testing |
| Client login | Only client/reviewer media and analytics visible | Ready for demo account testing |
| Project creation | Local project and Supabase `cf_projects` row created | Implemented |
| Asset upload | Local file saved and Supabase `cf_assets` row created | Implemented |
| Clip analysis | Highlight candidates saved and synced to Supabase | Implemented |
| Render output | Render job saved to Supabase `cf_render_jobs` | Implemented |
| Approval update | Project status and `cf_approval_events` updated | Implemented |
| Mobile route | Mobile PWA loads and uses same auth/session | Implemented |

## Screenshot Checklist

- Web login screen
- Admin dashboard
- Clients and campaigns panel
- AI Generator project view
- Auto Clipper project view
- Media library
- Analytics dashboard
- Mobile staff project list
- Mobile upload/detail view
- Client-only media/review view
- Supabase table editor showing `cf_projects`, `cf_assets`, `cf_render_jobs`, `cf_approval_events`

## Hosted Demo Notes

The hosted demo should use Supabase Auth, Supabase PostgreSQL, and prepared media outputs. Heavy generation actions such as yt-dlp download, Remotion render, LibTV, and OpenAI generation may be kept local/admin-side or disabled in hosted mode to keep the lecturer demo reliable.
