create extension if not exists pgcrypto;

create table if not exists cf_users (
  id text primary key,
  auth_user_id uuid,
  name text not null,
  role text not null default 'staff-editor',
  email text,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_clients (
  id text primary key,
  name text not null,
  industry text,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_campaigns (
  id text primary key,
  client_id text references cf_clients(id) on delete set null,
  name text not null,
  objective text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_projects (
  name text primary key,
  type text not null default 'ai-generator',
  folder_id text,
  client_id text references cf_clients(id) on delete set null,
  campaign_id text references cf_campaigns(id) on delete set null,
  assigned_staff_id text,
  reviewer_id text,
  priority text not null default 'normal',
  approval_status text not null default 'draft',
  approval_feedback text,
  selected_highlight_id text,
  local_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_assets (
  id text primary key,
  project_name text references cf_projects(name) on delete cascade,
  kind text not null,
  name text not null,
  media_type text,
  local_path text,
  url text,
  created_at timestamptz not null default now()
);

create table if not exists cf_clip_candidates (
  id text primary key,
  project_name text references cf_projects(name) on delete cascade,
  title text,
  start_seconds numeric,
  end_seconds numeric,
  score numeric,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists cf_render_jobs (
  id text primary key,
  project_name text references cf_projects(name) on delete cascade,
  mode text not null,
  status text not null default 'completed',
  output_path text not null,
  output_url text,
  render_type text,
  highlight_id text,
  reaction_id text,
  created_at timestamptz not null default now()
);

create table if not exists cf_approval_events (
  id uuid primary key default gen_random_uuid(),
  project_name text references cf_projects(name) on delete cascade,
  status text not null,
  feedback text,
  created_at timestamptz not null default now()
);

create table if not exists cf_analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  project_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists cf_production_jobs (
  id uuid primary key default gen_random_uuid(),
  project_name text references cf_projects(name) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  requested_by text,
  output_url text,
  error text,
  attempt_count integer not null default 0,
  cancelled_at timestamptz,
  progress integer not null default 0,
  progress_message text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table cf_users add column if not exists auth_user_id uuid;
alter table cf_users add column if not exists client_id text;
alter table cf_projects add column if not exists selected_highlight_id text;
alter table cf_render_jobs add column if not exists output_url text;
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
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table cf_worker_heartbeats add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_cf_users_auth_user on cf_users(auth_user_id);
create index if not exists idx_cf_users_email on cf_users(lower(email));
create index if not exists idx_cf_projects_type on cf_projects(type);
create index if not exists idx_cf_projects_approval on cf_projects(approval_status);
create index if not exists idx_cf_assets_project on cf_assets(project_name);
create index if not exists idx_cf_renders_project on cf_render_jobs(project_name);
create index if not exists idx_cf_analytics_event_type on cf_analytics_events(event_type);
create index if not exists idx_cf_analytics_events_created_at on cf_analytics_events(created_at desc);
create index if not exists idx_cf_analytics_events_project_name on cf_analytics_events(project_name);
create index if not exists idx_cf_production_jobs_status on cf_production_jobs(status, created_at);
create index if not exists idx_cf_production_jobs_project on cf_production_jobs(project_name);
create index if not exists idx_cf_worker_heartbeats_last_seen on cf_worker_heartbeats(last_seen_at desc);
