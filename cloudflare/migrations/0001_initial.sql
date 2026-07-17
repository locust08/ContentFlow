PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cf_users (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff-editor' CHECK (role IN ('admin', 'staff-editor', 'manager-client')),
  email TEXT,
  client_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  contact TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_campaigns (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES cf_clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_projects (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'ai-generator' CHECK (type IN ('ai-generator', 'auto-clipper')),
  folder_id TEXT REFERENCES cf_folders(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES cf_clients(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES cf_campaigns(id) ON DELETE SET NULL,
  assigned_staff_id TEXT,
  reviewer_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  approval_status TEXT NOT NULL DEFAULT 'draft',
  approval_feedback TEXT,
  local_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_assets (
  id TEXT PRIMARY KEY,
  project_name TEXT REFERENCES cf_projects(name) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT,
  local_path TEXT,
  object_key TEXT,
  url TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_clip_candidates (
  id TEXT PRIMARY KEY,
  project_name TEXT REFERENCES cf_projects(name) ON DELETE CASCADE,
  title TEXT,
  start_seconds REAL,
  end_seconds REAL,
  score REAL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_render_jobs (
  id TEXT PRIMARY KEY,
  project_name TEXT REFERENCES cf_projects(name) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  output_path TEXT NOT NULL,
  object_key TEXT,
  output_url TEXT,
  render_type TEXT,
  highlight_id TEXT,
  reaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_approval_events (
  id TEXT PRIMARY KEY,
  project_name TEXT REFERENCES cf_projects(name) ON DELETE CASCADE,
  status TEXT NOT NULL,
  feedback TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  project_name TEXT,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_production_jobs (
  id TEXT PRIMARY KEY,
  project_name TEXT REFERENCES cf_projects(name) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  payload_object_key TEXT,
  requested_by TEXT,
  output_url TEXT,
  result TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result)),
  result_object_key TEXT,
  error TEXT,
  lease_token TEXT,
  claimed_by TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_campaign_briefs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  product_name TEXT,
  objective TEXT,
  target_audience TEXT,
  brief TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(brief)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'researching', 'complete', 'archived')),
  created_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_research_sources (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES cf_campaign_briefs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'txt', 'md', 'csv')),
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  passages TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(passages)),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  content_object_key TEXT,
  local_path TEXT,
  created_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_research_source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES cf_research_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  byte_length INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS cf_market_reports (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES cf_campaign_briefs(id) ON DELETE RESTRICT,
  campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved', 'archived')),
  source TEXT NOT NULL DEFAULT 'fallback',
  report TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(report)),
  report_object_key TEXT,
  scriptwriter_input TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scriptwriter_input)),
  created_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_ugc_scripts (
  id TEXT PRIMARY KEY,
  market_report_id TEXT REFERENCES cf_market_reports(id) ON DELETE RESTRICT,
  campaign_id TEXT REFERENCES cf_campaigns(id) ON DELETE RESTRICT,
  project_name TEXT NOT NULL REFERENCES cf_projects(name) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'internal-review', 'client-review', 'approved', 'changes-requested')),
  selected_hook_id TEXT,
  selected_hook_index INTEGER,
  current_version_number INTEGER NOT NULL DEFAULT 0 CHECK (current_version_number >= 0),
  created_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cf_ugc_script_versions (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES cf_ugc_scripts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  content TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(content)),
  content_object_key TEXT,
  change_note TEXT,
  created_by TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (script_id, version_number)
);

CREATE TABLE IF NOT EXISTS cf_script_review_events (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES cf_ugc_scripts(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES cf_ugc_script_versions(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  feedback TEXT,
  actor_id TEXT REFERENCES cf_users(id) ON DELETE SET NULL,
  override_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cf_users_auth_user ON cf_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_cf_users_email ON cf_users(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cf_projects_type ON cf_projects(type);
CREATE INDEX IF NOT EXISTS idx_cf_projects_folder ON cf_projects(folder_id);
CREATE INDEX IF NOT EXISTS idx_cf_projects_approval ON cf_projects(approval_status);
CREATE INDEX IF NOT EXISTS idx_cf_assets_project ON cf_assets(project_name);
CREATE INDEX IF NOT EXISTS idx_cf_assets_object_key ON cf_assets(object_key);
CREATE INDEX IF NOT EXISTS idx_cf_renders_project ON cf_render_jobs(project_name);
CREATE INDEX IF NOT EXISTS idx_cf_analytics_event_type ON cf_analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_cf_analytics_created_at ON cf_analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cf_analytics_project ON cf_analytics_events(project_name);
CREATE INDEX IF NOT EXISTS idx_cf_production_jobs_status ON cf_production_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_cf_production_jobs_lease ON cf_production_jobs(status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_cf_production_jobs_project ON cf_production_jobs(project_name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cf_production_jobs_idempotency ON cf_production_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cf_campaign_briefs_campaign ON cf_campaign_briefs(campaign_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cf_campaign_briefs_campaign ON cf_campaign_briefs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cf_research_sources_brief ON cf_research_sources(brief_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cf_research_chunks_source ON cf_research_source_chunks(source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_cf_market_reports_brief ON cf_market_reports(brief_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cf_market_reports_campaign ON cf_market_reports(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cf_ugc_scripts_campaign_status ON cf_ugc_scripts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_cf_ugc_scripts_project ON cf_ugc_scripts(project_name);
CREATE INDEX IF NOT EXISTS idx_cf_script_versions_script ON cf_ugc_script_versions(script_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_cf_review_events_script ON cf_script_review_events(script_id, created_at DESC);
