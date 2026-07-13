import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { rootDir } from "../config.js";

const { Pool } = pg;

let pool = null;

function value(key) {
  return String(process.env[key] || "").trim();
}

export function isSupabaseConfigured() {
  return Boolean(value("SUPABASE_URL") && value("SUPABASE_SERVICE_ROLE_KEY") && (value("SUPABASE_DATABASE_URL") || value("SUPABASE_DB_PASSWORD")));
}

function projectRef() {
  const raw = value("SUPABASE_URL");
  if (/^[a-z0-9]{15,}$/i.test(raw) && !raw.includes(".")) return raw;
  try {
    return new URL(raw).hostname.split(".")[0];
  } catch {
    return "";
  }
}

function supabasePublicUrl() {
  const raw = value("SUPABASE_URL");
  if (raw.startsWith("http")) return raw.replace(/\/$/, "");
  const ref = projectRef();
  return ref ? `https://${ref}.supabase.co` : "";
}

function databaseUrl() {
  if (value("SUPABASE_DATABASE_URL")) return value("SUPABASE_DATABASE_URL");
  const ref = projectRef();
  const password = encodeURIComponent(value("SUPABASE_DB_PASSWORD"));
  if (!ref || !password) return "";
  return `postgresql://postgres:${password}@db.${ref}.supabase.co:5432/postgres`;
}

function getPool() {
  if (!pool) {
    const connectionString = databaseUrl();
    if (!connectionString) throw new Error("Missing Supabase database connection settings.");
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3
    });
  }
  return pool;
}

export async function supabaseStatus() {
  const configured = isSupabaseConfigured();
  if (!configured) return { configured: false, connected: false, schemaReady: false };
  try {
    const result = await getPool().query("select to_regclass('public.cf_projects') as projects_table");
    return {
      configured: true,
      connected: true,
      schemaReady: Boolean(result.rows[0]?.projects_table),
      projectRef: projectRef()
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      schemaReady: false,
      projectRef: projectRef(),
      error: error.message
    };
  }
}

export async function initializeSupabaseSchema() {
  const sql = fs.readFileSync(path.join(rootDir, "supabase", "schema.sql"), "utf8");
  await getPool().query(sql);
  return supabaseStatus();
}

function safeDate(value) {
  return value || new Date().toISOString();
}

async function ensureSupabaseReady() {
  if (!isSupabaseConfigured()) return false;
  await initializeSupabaseSchema();
  return true;
}

export async function upsertSupabaseClient(orgClient) {
  if (!await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_clients (id, name, industry, contact, created_at, updated_at)
    values ($1, $2, $3, $4, $5, now())
    on conflict (id) do update set
      name = excluded.name,
      industry = excluded.industry,
      contact = excluded.contact,
      updated_at = now()
  `, [orgClient.id, orgClient.name, orgClient.industry || null, orgClient.contact || null, safeDate(orgClient.createdAt)]);
  return { skipped: false };
}

export async function upsertSupabaseCampaign(campaign) {
  if (!await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_campaigns (id, client_id, name, objective, status, created_at, updated_at)
    values ($1, $2, $3, $4, $5, $6, now())
    on conflict (id) do update set
      client_id = excluded.client_id,
      name = excluded.name,
      objective = excluded.objective,
      status = excluded.status,
      updated_at = now()
  `, [campaign.id, campaign.clientId || null, campaign.name, campaign.objective || null, campaign.status || "active", safeDate(campaign.createdAt)]);
  return { skipped: false };
}

export async function upsertSupabaseProject(project) {
  if (!await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_projects (
      name, type, folder_id, client_id, campaign_id, assigned_staff_id, reviewer_id,
      priority, approval_status, approval_feedback, local_path, created_at, updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
    on conflict (name) do update set
      type = excluded.type,
      folder_id = excluded.folder_id,
      client_id = excluded.client_id,
      campaign_id = excluded.campaign_id,
      assigned_staff_id = excluded.assigned_staff_id,
      reviewer_id = excluded.reviewer_id,
      priority = excluded.priority,
      approval_status = excluded.approval_status,
      approval_feedback = excluded.approval_feedback,
      local_path = excluded.local_path,
      updated_at = now()
  `, [
    project.name,
    project.type || "ai-generator",
    project.folderId || null,
    project.clientId || null,
    project.campaignId || null,
    project.assignedStaffId || null,
    project.reviewerId || null,
    project.priority || "normal",
    project.approvalStatus || "draft",
    project.approvalFeedback || null,
    `projects/${project.name}`,
    safeDate(project.createdAt)
  ]);
  return { skipped: false };
}

export async function deleteSupabaseProject(projectName) {
  if (!await ensureSupabaseReady()) return { skipped: true };
  await getPool().query("delete from cf_projects where name = $1", [projectName]);
  return { skipped: false };
}

function mapProjectSummary(row) {
  return row ? {
    name: row.name,
    type: row.type || "ai-generator",
    folderId: row.folder_id || "",
    clientId: row.client_id || "",
    campaignId: row.campaign_id || "",
    assignedStaffId: row.assigned_staff_id || "",
    reviewerId: row.reviewer_id || "",
    priority: row.priority || "normal",
    approvalStatus: row.approval_status || "draft",
    approvalFeedback: row.approval_feedback || "",
    reviewSubmittedAt: "",
    reviewedAt: "",
    hasReference: Number(row.reference_count || 0) > 0,
    hasProduct: Number(row.product_count || 0) > 0,
    hasCharacter: Number(row.character_count || 0) > 0,
    frameCount: 0,
    imageCount: Number(row.image_count || 0),
    videoCount: Number(row.video_count || 0),
    audioCount: Number(row.audio_count || 0),
    renderCount: Number(row.render_count || 0),
    hasStyleAnalysis: false,
    hasReferenceBlueprint: false,
    hasUgcVideo: Number(row.ugc_count || 0) > 0,
    hasGeneratedTranscript: false,
    hasSubtitlePlan: false,
    hasGeneratedPlan: false,
    hasClipperSource: Number(row.clipper_source_count || 0) > 0,
    hasClipperTranscript: false,
    hasClipperHighlights: Number(row.clip_candidate_count || 0) > 0,
    hasClipperSelection: false,
    hasClipperReaction: Number(row.reaction_count || 0) > 0,
    hasClipperRender: Number(row.clip_render_count || 0) > 0,
    assets: [],
    clipCandidates: []
  } : null;
}

export async function listSupabaseProjectSummaries() {
  if (!await ensureSupabaseReady()) return [];
  const result = await getPool().query(`
    select
      p.*,
      count(distinct a.id) filter (where a.kind = 'reference-video') as reference_count,
      count(distinct a.id) filter (where a.kind = 'product-image') as product_count,
      count(distinct a.id) filter (where a.kind = 'character-reference') as character_count,
      count(distinct a.id) filter (where a.kind = 'reaction-character') as reaction_count,
      count(distinct a.id) filter (where a.kind = 'clipper-source') as clipper_source_count,
      count(distinct a.id) filter (where a.media_type = 'image') as image_count,
      count(distinct a.id) filter (where a.media_type = 'video') as video_count,
      count(distinct a.id) filter (where a.media_type = 'audio') as audio_count,
      count(distinct r.id) as render_count,
      count(distinct r.id) filter (where r.render_type = 'clip' or r.output_path like 'clips/%' or r.output_path = 'final-clip.mp4') as clip_render_count,
      count(distinct r.id) filter (where r.output_path = 'final.mp4' or r.output_path like '%ugc%') as ugc_count,
      count(distinct cc.id) as clip_candidate_count
    from cf_projects p
    left join cf_assets a on a.project_name = p.name
    left join cf_render_jobs r on r.project_name = p.name
    left join cf_clip_candidates cc on cc.project_name = p.name
    group by p.name
    order by p.created_at desc, p.name asc
  `);
  return result.rows.map(mapProjectSummary);
}

export async function listSupabaseOrganization() {
  if (!await ensureSupabaseReady()) return { clients: [], campaigns: [], staff: [] };
  const [clients, campaigns, staff] = await Promise.all([
    getPool().query("select id, name, industry, contact, created_at from cf_clients order by name asc"),
    getPool().query("select id, client_id, name, objective, status, created_at from cf_campaigns order by created_at desc"),
    getPool().query("select id, name, role, email, client_id from cf_users order by name asc")
  ]);
  return {
    clients: clients.rows.map((row) => ({
      id: row.id,
      name: row.name,
      industry: row.industry || "",
      contact: row.contact || "",
      createdAt: row.created_at
    })),
    campaigns: campaigns.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id || "",
      name: row.name,
      objective: row.objective || "",
      status: row.status || "active",
      createdAt: row.created_at
    })),
    staff: staff.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role || "staff-editor",
      email: row.email || "",
      clientId: row.client_id || ""
    }))
  };
}

export async function listSupabaseMediaItems() {
  if (!await ensureSupabaseReady()) return [];
  const result = await getPool().query(`
    select
      r.id,
      r.project_name,
      r.mode,
      r.output_path,
      r.output_url,
      r.render_type,
      r.status,
      r.created_at,
      p.type,
      p.client_id,
      p.campaign_id,
      p.assigned_staff_id,
      p.reviewer_id,
      p.approval_status,
      p.approval_feedback
    from cf_render_jobs r
    join cf_projects p on p.name = r.project_name
    order by r.created_at desc
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.output_path,
    project: row.project_name,
    projectType: row.type || row.mode || "ai-generator",
    clientId: row.client_id || "",
    campaignId: row.campaign_id || "",
    assignedStaffId: row.assigned_staff_id || "",
    reviewerId: row.reviewer_id || "",
    approvalStatus: row.approval_status || "draft",
    approvalFeedback: row.approval_feedback || "",
    status: row.status || "completed",
    renderType: row.render_type || "",
    url: row.output_url || "",
    createdAt: row.created_at
  }));
}

export async function supabaseProjectData(projectName) {
  if (!await ensureSupabaseReady()) return null;
  const summaries = await listSupabaseProjectSummaries();
  const summary = summaries.find((project) => project.name === projectName);
  if (!summary) return null;
  const [organization, assets, renders, candidates] = await Promise.all([
    listSupabaseOrganization(),
    getPool().query("select * from cf_assets where project_name = $1 order by created_at desc", [projectName]),
    getPool().query("select * from cf_render_jobs where project_name = $1 order by created_at desc", [projectName]),
    getPool().query("select * from cf_clip_candidates where project_name = $1 order by score desc, start_seconds asc", [projectName])
  ]);
  const assetItems = assets.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    localPath: row.local_path || "",
    url: row.url || "",
    mediaType: row.media_type || ""
  }));
  const renderItems = renders.rows.map((row) => ({
    name: row.output_path,
    url: row.output_url || "",
    status: row.status,
    renderType: row.render_type || "",
    createdAt: row.created_at
  }));
  const clipCandidates = candidates.rows.map((row) => ({
    id: String(row.id).includes(":") ? String(row.id).split(":").pop() : row.id,
    title: row.title || "Highlight",
    start: Number(row.start_seconds || 0),
    end: Number(row.end_seconds || 0),
    score: Number(row.score || 0),
    reason: row.reason || ""
  }));
  const products = assetItems.filter((item) => item.kind === "product-image");
  const characters = assetItems.filter((item) => item.kind === "character-reference");
  const reactions = assetItems.filter((item) => item.kind === "reaction-character").map((item) => ({
    ...item,
    type: item.mediaType === "video" ? "video" : "image"
  }));
  const videos = assetItems
    .filter((item) => item.mediaType === "video" && item.kind !== "reference-video" && item.kind !== "clipper-source" && item.url)
    .map((item) => ({ name: item.name, url: item.url }));
  return {
    summary: {
      ...summary,
      assets: assetItems,
      clipCandidates
    },
    folders: [],
    organization,
    products,
    characters,
    frames: [],
    images: assetItems.filter((item) => item.mediaType === "image" && item.url),
    videos,
    audio: assetItems.filter((item) => item.mediaType === "audio" && item.url),
    renders: renderItems,
    clipper: {
      sourceUrl: assetItems.find((item) => item.kind === "clipper-source")?.url || null,
      reactions
    },
    referenceUrl: assetItems.find((item) => item.kind === "reference-video")?.url || null,
    files: {
      clipperHighlights: clipCandidates.length ? { candidates: clipCandidates } : null
    }
  };
}

export async function recordSupabaseApprovalEvent({ projectName, status, feedback = "" }) {
  if (!projectName || !status || !await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_approval_events (project_name, status, feedback)
    values ($1, $2, $3)
  `, [projectName, status, feedback || null]);
  return { skipped: false };
}

export async function upsertSupabaseAsset(projectName, asset) {
  if (!projectName || !asset?.id || !await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_assets (id, project_name, kind, name, media_type, local_path, url, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (id) do update set
      kind = excluded.kind,
      name = excluded.name,
      media_type = excluded.media_type,
      local_path = excluded.local_path,
      url = excluded.url
  `, [asset.id, projectName, asset.kind, asset.name, asset.mediaType || null, asset.localPath || null, asset.url || null]);
  return { skipped: false };
}

export async function upsertSupabaseRenderJob(item) {
  if (!item?.project || !item?.name || !await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_render_jobs (id, project_name, mode, status, output_path, output_url, render_type, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (id) do update set
      status = excluded.status,
      output_path = excluded.output_path,
      output_url = excluded.output_url,
      render_type = excluded.render_type
  `, [
    `${item.project}:${item.name}`,
    item.project,
    item.projectType || "unknown",
    item.status || "completed",
    item.name,
    item.outputUrl || item.url || null,
    item.name?.startsWith("clips/") ? "clip" : "final"
  ]);
  return { skipped: false };
}

export async function upsertSupabaseClipCandidates(projectName, candidates = []) {
  if (!projectName || !Array.isArray(candidates) || !candidates.length || !await ensureSupabaseReady()) return { skipped: true };
  for (const clip of candidates) {
    await getPool().query(`
      insert into cf_clip_candidates (id, project_name, title, start_seconds, end_seconds, score, reason, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, now())
      on conflict (id) do update set
        title = excluded.title,
        start_seconds = excluded.start_seconds,
        end_seconds = excluded.end_seconds,
        score = excluded.score,
        reason = excluded.reason
    `, [
      `${projectName}:${clip.id}`,
      projectName,
      clip.title || clip.id,
      Number(clip.start || clip.startSeconds || 0),
      Number(clip.end || clip.endSeconds || 0),
      Number(clip.score || 0),
      clip.reason || ""
    ]);
  }
  return { skipped: false };
}

function mapSupabaseUser(row) {
  return row ? {
    id: row.id,
    authUserId: row.auth_user_id || "",
    name: row.name,
    role: row.role || "staff-editor",
    email: row.email || "",
    clientId: row.client_id || ""
  } : null;
}

export async function upsertSupabaseUser(user) {
  if (!user?.id || !user?.name || !await ensureSupabaseReady()) return { skipped: true };
  const result = await getPool().query(`
    insert into cf_users (id, auth_user_id, name, role, email, client_id, updated_at)
    values ($1, $2, $3, $4, $5, $6, now())
    on conflict (id) do update set
      auth_user_id = excluded.auth_user_id,
      name = excluded.name,
      role = excluded.role,
      email = excluded.email,
      client_id = excluded.client_id,
      updated_at = now()
    returning *
  `, [
    user.id,
    user.authUserId || null,
    user.name,
    user.role || "staff-editor",
    user.email || null,
    user.clientId || null
  ]);
  return mapSupabaseUser(result.rows[0]);
}

export async function findSupabaseUserProfile({ authUserId = "", email = "" } = {}) {
  if (!isSupabaseConfigured()) return null;
  try {
    const result = await getPool().query(`
      select *
      from cf_users
      where ($1::uuid is not null and auth_user_id = $1::uuid)
        or ($2::text <> '' and lower(email) = lower($2))
      order by case when auth_user_id = $1::uuid then 0 else 1 end
      limit 1
    `, [authUserId || null, email || ""]);
    return mapSupabaseUser(result.rows[0]);
  } catch {
    return null;
  }
}

function mapProductionJob(row) {
  return row ? {
    id: row.id,
    projectName: row.project_name,
    jobType: row.job_type,
    status: row.status,
    payload: row.payload || {},
    requestedBy: row.requested_by || "",
    outputUrl: row.output_url || "",
    error: row.error || "",
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  } : null;
}

export async function createSupabaseProductionJob(job) {
  if (!await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
  const result = await getPool().query(`
    insert into cf_production_jobs (project_name, job_type, status, payload, requested_by, updated_at)
    values ($1, $2, $3, $4::jsonb, $5, now())
    returning *
  `, [job.projectName, job.jobType, job.status || "queued", JSON.stringify(job.payload || {}), job.requestedBy || null]);
  return mapProductionJob(result.rows[0]);
}

export async function listSupabaseProductionJobs({ projectName = "", status = "", limit = 50 } = {}) {
  if (!await ensureSupabaseReady()) return [];
  const clauses = [];
  const params = [];
  if (projectName) {
    params.push(projectName);
    clauses.push(`project_name = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const result = await getPool().query(`
    select *
    from cf_production_jobs
    ${where}
    order by created_at desc
    limit $${params.length}
  `, params);
  return result.rows.map(mapProductionJob);
}

export async function claimNextSupabaseProductionJob() {
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    update cf_production_jobs
    set status = 'processing',
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where id = (
      select id
      from cf_production_jobs
      where status = 'queued'
      order by created_at asc
      limit 1
      for update skip locked
    )
    returning *
  `);
  return mapProductionJob(result.rows[0]);
}

export async function updateSupabaseProductionJob(id, patch = {}) {
  if (!id || !await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
  const status = patch.status || "processing";
  const completedAt = ["completed", "failed"].includes(status) ? new Date().toISOString() : null;
  const result = await getPool().query(`
    update cf_production_jobs
    set status = $2,
      output_url = $3,
      error = $4,
      completed_at = coalesce($5::timestamptz, completed_at),
      updated_at = now()
    where id = $1
    returning *
  `, [id, status, patch.outputUrl || null, patch.error || null, completedAt]);
  return mapProductionJob(result.rows[0]);
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}

export async function uploadSupabaseStorageFile(localPath, storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media"
} = {}) {
  const baseUrl = supabasePublicUrl();
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey || !fs.existsSync(localPath)) return "";
  const cleanPath = storagePath.split(/[\\/]+/).map(encodeURIComponent).join("/");
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${cleanPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentTypeForPath(localPath),
      "x-upsert": "true"
    },
    body: fs.readFileSync(localPath)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Storage upload failed: ${response.status} ${text}`);
  }
  return `${baseUrl}/storage/v1/object/public/${bucket}/${cleanPath}`;
}

export async function syncLocalSnapshotToSupabase({ organization, projects, mediaItems }) {
  await initializeSupabaseSchema();
  const client = await getPool().connect();
  try {
    await client.query("begin");

    for (const staff of organization.staff || []) {
      await client.query(`
        insert into cf_users (id, auth_user_id, name, role, email, client_id, updated_at)
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (id) do update set
          auth_user_id = excluded.auth_user_id,
          name = excluded.name,
          role = excluded.role,
          email = excluded.email,
          client_id = excluded.client_id,
          updated_at = now()
      `, [staff.id, staff.authUserId || null, staff.name, staff.role || "staff-editor", staff.email || null, staff.clientId || null]);
    }

    for (const orgClient of organization.clients || []) {
      await client.query(`
        insert into cf_clients (id, name, industry, contact, created_at, updated_at)
        values ($1, $2, $3, $4, $5, now())
        on conflict (id) do update set
          name = excluded.name,
          industry = excluded.industry,
          contact = excluded.contact,
          updated_at = now()
      `, [orgClient.id, orgClient.name, orgClient.industry || null, orgClient.contact || null, safeDate(orgClient.createdAt)]);
    }

    for (const campaign of organization.campaigns || []) {
      await client.query(`
        insert into cf_campaigns (id, client_id, name, objective, status, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (id) do update set
          client_id = excluded.client_id,
          name = excluded.name,
          objective = excluded.objective,
          status = excluded.status,
          updated_at = now()
      `, [campaign.id, campaign.clientId || null, campaign.name, campaign.objective || null, campaign.status || "active", safeDate(campaign.createdAt)]);
    }

    for (const project of projects || []) {
      await client.query(`
        insert into cf_projects (
          name, type, folder_id, client_id, campaign_id, assigned_staff_id, reviewer_id,
          priority, approval_status, approval_feedback, local_path, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        on conflict (name) do update set
          type = excluded.type,
          folder_id = excluded.folder_id,
          client_id = excluded.client_id,
          campaign_id = excluded.campaign_id,
          assigned_staff_id = excluded.assigned_staff_id,
          reviewer_id = excluded.reviewer_id,
          priority = excluded.priority,
          approval_status = excluded.approval_status,
          approval_feedback = excluded.approval_feedback,
          local_path = excluded.local_path,
          updated_at = now()
      `, [
        project.name,
        project.type || "ai-generator",
        project.folderId || null,
        project.clientId || null,
        project.campaignId || null,
        project.assignedStaffId || null,
        project.reviewerId || null,
        project.priority || "normal",
        project.approvalStatus || "draft",
        project.approvalFeedback || null,
        `projects/${project.name}`
      ]);

      await client.query(`
        insert into cf_analytics_events (event_type, project_name, metadata)
        values ($1, $2, $3::jsonb)
      `, ["project_synced", project.name, JSON.stringify({
        type: project.type,
        renderCount: project.renderCount || 0,
        approvalStatus: project.approvalStatus || "draft"
      })]);
    }

    for (const item of mediaItems || []) {
      await client.query(`
        insert into cf_render_jobs (id, project_name, mode, status, output_path, output_url, render_type, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, now())
        on conflict (id) do update set
          status = excluded.status,
          output_path = excluded.output_path,
          output_url = excluded.output_url,
          render_type = excluded.render_type
      `, [
        `${item.project}:${item.name}`,
        item.project,
        item.projectType || "unknown",
        "completed",
        item.name,
        item.outputUrl || item.url || null,
        item.name?.startsWith("clips/") ? "clip" : "final"
      ]);
    }

    for (const project of projects || []) {
      for (const asset of project.assets || []) {
        await client.query(`
          insert into cf_assets (id, project_name, kind, name, media_type, local_path, url, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, now())
          on conflict (id) do update set
            kind = excluded.kind,
            name = excluded.name,
            media_type = excluded.media_type,
            local_path = excluded.local_path,
            url = excluded.url
        `, [asset.id, project.name, asset.kind, asset.name, asset.mediaType || null, asset.localPath || null, asset.url || null]);
      }

      for (const clip of project.clipCandidates || []) {
        await client.query(`
          insert into cf_clip_candidates (id, project_name, title, start_seconds, end_seconds, score, reason, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, now())
          on conflict (id) do update set
            title = excluded.title,
            start_seconds = excluded.start_seconds,
            end_seconds = excluded.end_seconds,
            score = excluded.score,
            reason = excluded.reason
        `, [
          `${project.name}:${clip.id}`,
          project.name,
          clip.title || clip.id,
          Number(clip.start || clip.startSeconds || 0),
          Number(clip.end || clip.endSeconds || 0),
          Number(clip.score || 0),
          clip.reason || ""
        ]);
      }
    }

    await client.query("commit");
    return {
      syncedAt: new Date().toISOString(),
      users: organization.staff?.length || 0,
      clients: organization.clients?.length || 0,
      campaigns: organization.campaigns?.length || 0,
      projects: projects?.length || 0,
      renders: mediaItems?.length || 0
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function analyticsWhere(user) {
  if (!user || user.role === "admin") return { projectWhere: "", params: [] };
  if (user.role === "staff-editor") return { projectWhere: "where assigned_staff_id = $1", params: [user.id] };
  return { projectWhere: "where (client_id = $1 or reviewer_id = $2)", params: [user.clientId || "__none__", user.id] };
}

export async function supabaseAnalytics(user = null) {
  const { projectWhere, params } = analyticsWhere(user);
  const result = await getPool().query(`
    select
      (select count(*)::int from cf_projects ${projectWhere}) as projects,
      (select count(*)::int from cf_render_jobs r join cf_projects p on p.name = r.project_name ${projectWhere}) as renders,
      (select count(*)::int from cf_projects ${projectWhere ? `${projectWhere} and` : "where"} type = 'ai-generator') as ai_projects,
      (select count(*)::int from cf_projects ${projectWhere ? `${projectWhere} and` : "where"} type = 'auto-clipper') as clipper_projects,
      (select jsonb_object_agg(approval_status, count) from (
        select approval_status, count(*)::int as count
        from cf_projects
        ${projectWhere}
        group by approval_status
      ) rows) as approval_breakdown,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select coalesce(u.name, p.assigned_staff_id, 'Unassigned') as name, count(*)::int as count
        from cf_projects p
        left join cf_users u on u.id = p.assigned_staff_id
        ${projectWhere}
        group by coalesce(u.name, p.assigned_staff_id, 'Unassigned')
        order by count(*) desc, name asc
      ) rows) as staff_workload,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select coalesce(c.name, 'No campaign') as name, count(*)::int as count
        from cf_projects p
        left join cf_campaigns c on c.id = p.campaign_id
        ${projectWhere}
        group by coalesce(c.name, 'No campaign')
        order by count(*) desc, name asc
      ) rows) as campaign_projects,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select coalesce(a.kind, 'unknown') as name, count(*)::int as count
        from cf_assets a
        join cf_projects p on p.name = a.project_name
        ${projectWhere}
        group by coalesce(a.kind, 'unknown')
        order by count(*) desc, name asc
      ) rows) as asset_breakdown,
      (select count(*)::int from cf_clip_candidates cc join cf_projects p on p.name = cc.project_name ${projectWhere}) as clip_candidates,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select to_char(date_trunc('month', r.created_at), 'YYYY-MM') as month, count(*)::int as count
        from cf_render_jobs r
        join cf_projects p on p.name = r.project_name
        ${projectWhere}
        group by date_trunc('month', r.created_at)
        order by month asc
      ) rows) as monthly_renders
  `, params);
  return result.rows[0];
}
