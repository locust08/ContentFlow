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
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

do $$
declare
  legacy_uuid boolean;
  legacy_rows bigint;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cf_campaign_briefs'
      and column_name = 'id' and data_type = 'uuid'
  ) into legacy_uuid;
  if legacy_uuid then
    select
      (select count(*) from cf_campaign_briefs)
      + (select count(*) from cf_research_sources)
      + (select count(*) from cf_market_reports)
      + (select count(*) from cf_ugc_scripts)
      + (select count(*) from cf_ugc_script_versions)
      + (select count(*) from cf_script_review_events)
    into legacy_rows;
    if legacy_rows = 0 then
      drop table if exists cf_script_review_events cascade;
      drop table if exists cf_ugc_script_versions cascade;
      drop table if exists cf_ugc_scripts cascade;
      drop table if exists cf_market_reports cascade;
      drop table if exists cf_research_sources cascade;
      drop table if exists cf_campaign_briefs cascade;
    else
      raise exception 'Legacy UUID intelligence tables contain data; migrate them before applying the text-id schema.';
    end if;
  end if;
end $$;

create table if not exists cf_campaign_briefs (
  id text primary key default gen_random_uuid()::text,
  campaign_id text not null references cf_campaigns(id) on delete restrict,
  title text not null,
  product_name text,
  objective text,
  target_audience text,
  brief jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'researching', 'complete', 'archived')),
  created_by text references cf_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_research_sources (
  id text primary key default gen_random_uuid()::text,
  brief_id text not null references cf_campaign_briefs(id) on delete cascade,
  source_type text not null check (source_type in ('text', 'txt', 'md', 'csv')),
  name text not null,
  content text not null,
  passages jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  local_path text,
  created_by text references cf_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists cf_market_reports (
  id text primary key default gen_random_uuid()::text,
  brief_id text not null references cf_campaign_briefs(id) on delete restrict,
  campaign_id text not null references cf_campaigns(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'ready', 'approved', 'archived')),
  source text not null default 'fallback',
  report jsonb not null default '{}'::jsonb,
  scriptwriter_input jsonb not null default '{}'::jsonb,
  created_by text references cf_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_ugc_scripts (
  id text primary key default gen_random_uuid()::text,
  market_report_id text references cf_market_reports(id) on delete restrict,
  campaign_id text references cf_campaigns(id) on delete restrict,
  project_name text not null references cf_projects(name) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'internal-review', 'client-review', 'approved', 'changes-requested')),
  selected_hook_id text,
  selected_hook_index integer,
  current_version_number integer not null default 0 check (current_version_number >= 0),
  created_by text references cf_users(id) on delete set null,
  updated_by text references cf_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cf_ugc_script_versions (
  id text primary key default gen_random_uuid()::text,
  script_id text not null references cf_ugc_scripts(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content jsonb not null default '{}'::jsonb,
  change_note text,
  created_by text references cf_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (script_id, version_number)
);

create table if not exists cf_script_review_events (
  id text primary key default gen_random_uuid()::text,
  script_id text not null references cf_ugc_scripts(id) on delete restrict,
  version_id text not null references cf_ugc_script_versions(id) on delete restrict,
  from_status text,
  to_status text not null,
  feedback text,
  actor_id text references cf_users(id) on delete set null,
  override_reason text,
  created_at timestamptz not null default now()
);

alter table cf_users add column if not exists auth_user_id uuid;
alter table cf_users add column if not exists client_id text;
alter table cf_ugc_scripts alter column market_report_id drop not null;
alter table cf_ugc_scripts alter column campaign_id drop not null;
alter table cf_render_jobs add column if not exists output_url text;
alter table cf_production_jobs add column if not exists result jsonb not null default '{}'::jsonb;

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
create index if not exists idx_campaign_briefs_campaign on cf_campaign_briefs(campaign_id, created_at desc);
create unique index if not exists uq_campaign_briefs_campaign on cf_campaign_briefs(campaign_id);
create index if not exists idx_research_sources_brief on cf_research_sources(brief_id, created_at);
create index if not exists idx_market_reports_brief on cf_market_reports(brief_id, created_at desc);
create index if not exists idx_market_reports_campaign on cf_market_reports(campaign_id, created_at desc);
create index if not exists idx_ugc_scripts_campaign_status on cf_ugc_scripts(campaign_id, status);
create index if not exists idx_ugc_scripts_project on cf_ugc_scripts(project_name);
create index if not exists idx_ugc_script_versions_script on cf_ugc_script_versions(script_id, version_number desc);
create index if not exists idx_script_review_events_script on cf_script_review_events(script_id, created_at desc);
