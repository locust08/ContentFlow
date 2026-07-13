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

function hostedRestMode() {
  return value("HOSTED_DEMO") === "true";
}

async function restRequest(resource, {
  method = "GET",
  body = null,
  headers = {}
} = {}) {
  const baseUrl = supabasePublicUrl();
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase REST settings.");
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...headers
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.msg || data?.error || text || `Supabase REST failed: ${response.status}`);
  }
  return data;
}

const eq = (value) => encodeURIComponent(String(value || ""));

async function restTable(table, query = "select=*") {
  return restRequest(`${table}?${query}`);
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
  if (hostedRestMode()) return true;
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

export function buildSupabaseProjectUpsert(project) {
  const hasSelectedHighlight = Object.hasOwn(project, "selectedHighlightId");
  return {
    text: `
      insert into cf_projects (
        name, type, folder_id, client_id, campaign_id, assigned_staff_id, reviewer_id,
        priority, approval_status, approval_feedback, selected_highlight_id, local_path, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
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
        selected_highlight_id = case when $14 then excluded.selected_highlight_id else cf_projects.selected_highlight_id end,
        local_path = excluded.local_path,
        updated_at = now()
    `,
    values: [
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
      project.selectedHighlightId || null,
      `projects/${project.name}`,
      safeDate(project.createdAt),
      hasSelectedHighlight
    ]
  };
}

export async function upsertSupabaseProject(project) {
  const hasSelectedHighlight = Object.hasOwn(project, "selectedHighlightId");
  if (hostedRestMode()) {
    const body = {
      name: project.name,
      type: project.type || "ai-generator",
      folder_id: project.folderId || null,
      client_id: project.clientId || null,
      campaign_id: project.campaignId || null,
      assigned_staff_id: project.assignedStaffId || null,
      reviewer_id: project.reviewerId || null,
      priority: project.priority || "normal",
      approval_status: project.approvalStatus || "draft",
      approval_feedback: project.approvalFeedback || null,
      local_path: `projects/${project.name}`,
      created_at: safeDate(project.createdAt),
      updated_at: new Date().toISOString()
    };
    if (hasSelectedHighlight) body.selected_highlight_id = project.selectedHighlightId || null;
    const [row] = await restRequest("cf_projects?on_conflict=name", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body
    });
    return row || { skipped: false };
  }
  if (!await ensureSupabaseReady()) return { skipped: true };
  const query = buildSupabaseProjectUpsert(project);
  await getPool().query(query.text, query.values);
  return { skipped: false };
}

export async function deleteSupabaseProject(projectName) {
  if (hostedRestMode()) {
    await restRequest(`cf_projects?name=eq.${eq(projectName)}`, { method: "DELETE" });
    return { skipped: false };
  }
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
    selectedHighlightId: row.selected_highlight_id || "",
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
    hasClipperSelection: Boolean(row.selected_highlight_id),
    hasClipperReaction: Number(row.reaction_count || 0) > 0,
    hasClipperRender: Number(row.clip_render_count || 0) > 0,
    assets: [],
    clipCandidates: []
  } : null;
}

export async function listSupabaseProjectSummaries() {
  if (hostedRestMode()) {
    const [projects, assets, renders, clips] = await Promise.all([
      restTable("cf_projects", "select=*"),
      restTable("cf_assets", "select=*"),
      restTable("cf_render_jobs", "select=*"),
      restTable("cf_clip_candidates", "select=*")
    ]);
    return projects.map((project) => {
      const projectAssets = assets.filter((asset) => asset.project_name === project.name);
      const projectRenders = renders.filter((render) => render.project_name === project.name);
      const projectClips = clips.filter((clip) => clip.project_name === project.name);
      return mapProjectSummary({
        ...project,
        reference_count: projectAssets.filter((asset) => asset.kind === "reference-video").length,
        product_count: projectAssets.filter((asset) => asset.kind === "product-image").length,
        character_count: projectAssets.filter((asset) => asset.kind === "character-reference").length,
        reaction_count: projectAssets.filter((asset) => asset.kind === "reaction-character").length,
        clipper_source_count: projectAssets.filter((asset) => asset.kind === "clipper-source").length,
        image_count: projectAssets.filter((asset) => asset.media_type === "image").length,
        video_count: projectAssets.filter((asset) => asset.media_type === "video").length,
        audio_count: projectAssets.filter((asset) => asset.media_type === "audio").length,
        render_count: projectRenders.length,
        clip_render_count: projectRenders.filter((render) => render.render_type === "clip" || String(render.output_path || "").startsWith("clips/") || render.output_path === "final-clip.mp4").length,
        ugc_count: projectRenders.filter((render) => render.output_path === "final.mp4" || String(render.output_path || "").includes("ugc")).length,
        clip_candidate_count: projectClips.length
      });
    }).sort((a, b) => String(b.name).localeCompare(String(a.name)));
  }
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
  if (hostedRestMode()) {
    const [clients, campaigns, staff] = await Promise.all([
      restTable("cf_clients", "select=*&order=name.asc"),
      restTable("cf_campaigns", "select=*&order=created_at.desc"),
      restTable("cf_users", "select=*&order=name.asc")
    ]);
    return {
      clients: clients.map((row) => ({
        id: row.id,
        name: row.name,
        industry: row.industry || "",
        contact: row.contact || "",
        createdAt: row.created_at
      })),
      campaigns: campaigns.map((row) => ({
        id: row.id,
        clientId: row.client_id || "",
        name: row.name,
        objective: row.objective || "",
        status: row.status || "active",
        createdAt: row.created_at
      })),
      staff: staff.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role || "staff-editor",
        email: row.email || "",
        clientId: row.client_id || ""
      }))
    };
  }
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
  if (hostedRestMode()) {
    const [renders, projects] = await Promise.all([
      restTable("cf_render_jobs", "select=*&order=created_at.desc"),
      restTable("cf_projects", "select=*")
    ]);
    const projectMap = new Map(projects.map((project) => [project.name, project]));
    return renders.map((row) => {
      const project = projectMap.get(row.project_name) || {};
      return {
        id: row.id,
        name: row.output_path,
        project: row.project_name,
        projectType: project.type || row.mode || "ai-generator",
        clientId: project.client_id || "",
        campaignId: project.campaign_id || "",
        assignedStaffId: project.assigned_staff_id || "",
        reviewerId: project.reviewer_id || "",
        approvalStatus: project.approval_status || "draft",
        approvalFeedback: project.approval_feedback || "",
        status: row.status || "completed",
        renderType: row.render_type || "",
        url: row.output_url || "",
        createdAt: row.created_at
      };
    });
  }
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

function buildSupabaseProjectData({ summary, organization, assets, renders, candidates }) {
  const assetRows = Array.isArray(assets) ? assets : assets.rows;
  const renderRows = Array.isArray(renders) ? renders : renders.rows;
  const candidateRows = Array.isArray(candidates) ? candidates : candidates.rows;
  const assetItems = assetRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    localPath: row.local_path || "",
    url: row.url || "",
    mediaType: row.media_type || ""
  }));
  const renderItems = renderRows.map((row) => ({
    name: row.output_path,
    url: row.output_url || "",
    status: row.status,
    renderType: row.render_type || "",
    createdAt: row.created_at
  }));
  const clipCandidates = candidateRows.map((row) => ({
    id: String(row.id).includes(":") ? String(row.id).split(":").pop() : row.id,
    title: row.title || "Highlight",
    start: Number(row.start_seconds || 0),
    end: Number(row.end_seconds || 0),
    score: Number(row.score || 0),
    reason: row.reason || ""
  }));
  const products = assetItems.filter((item) => item.kind === "product-image");
  const characters = assetItems.filter((item) => item.kind === "character-reference");
  const reactionPrefix = `${summary.name}:reaction-character:`;
  const reactions = assetItems.filter((item) => item.kind === "reaction-character").map((item) => ({
    ...item,
    id: String(item.id).startsWith(reactionPrefix) ? String(item.id).slice(reactionPrefix.length) : item.id,
    type: item.mediaType === "video" ? "video" : "image"
  }));
  const selectedHighlight = clipCandidates.find((candidate) => candidate.id === summary.selectedHighlightId) || null;
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
      clipperHighlights: clipCandidates.length ? { candidates: clipCandidates } : null,
      clipperSelection: selectedHighlight
    }
  };
}

export async function supabaseProjectData(projectName) {
  if (hostedRestMode()) {
    const summaries = await listSupabaseProjectSummaries();
    const summary = summaries.find((project) => project.name === projectName);
    if (!summary) return null;
    const [organization, assets, renders, candidates] = await Promise.all([
      listSupabaseOrganization(),
      restTable("cf_assets", `select=*&project_name=eq.${eq(projectName)}&order=created_at.desc`),
      restTable("cf_render_jobs", `select=*&project_name=eq.${eq(projectName)}&order=created_at.desc`),
      restTable("cf_clip_candidates", `select=*&project_name=eq.${eq(projectName)}&order=score.desc,start_seconds.asc`)
    ]);
    return buildSupabaseProjectData({ projectName, summary, organization, assets, renders, candidates });
  }
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
  return buildSupabaseProjectData({ summary, organization, assets, renders, candidates });
}

export async function recordSupabaseApprovalEvent({ projectName, status, feedback = "" }) {
  if (hostedRestMode()) {
    await restRequest("cf_approval_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: { project_name: projectName, status, feedback: feedback || null }
    });
    return { skipped: false };
  }
  if (!projectName || !status || !await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_approval_events (project_name, status, feedback)
    values ($1, $2, $3)
  `, [projectName, status, feedback || null]);
  return { skipped: false };
}

export async function upsertSupabaseAsset(projectName, asset) {
  if (hostedRestMode()) {
    const [row] = await restRequest("cf_assets?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: {
        id: asset.id,
        project_name: projectName,
        kind: asset.kind,
        name: asset.name,
        media_type: asset.mediaType || null,
        local_path: asset.localPath || null,
        url: asset.url || null
      }
    });
    return row || { skipped: false };
  }
  if (!projectName || !asset?.id || !await ensureSupabaseReady()) return { skipped: true };
  await getPool().query(`
    insert into cf_assets (id, project_name, kind, name, media_type, local_path, url, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, now())
    on conflict (id) do update set
      kind = excluded.kind,
      name = excluded.name,
      media_type = excluded.media_type,
      local_path = excluded.local_path,
      url = case
        when excluded.url ~* '^https?://' then excluded.url
        when cf_assets.url ~* '^https?://' then cf_assets.url
        else excluded.url
      end
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
  if (hostedRestMode()) {
    try {
      const filters = [];
      if (authUserId) filters.push(`auth_user_id.eq.${eq(authUserId)}`);
      if (email) filters.push(`email.ilike.${eq(email)}`);
      if (!filters.length) return null;
      const rows = await restTable("cf_users", `select=*&or=(${filters.join(",")})&limit=1`);
      return mapSupabaseUser(rows[0]);
    } catch {
      return null;
    }
  }
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

export function mapProductionJobRecord(row) {
  return row ? {
    id: row.id,
    projectName: row.project_name,
    jobType: row.job_type,
    status: row.status,
    payload: row.payload || {},
    requestedBy: row.requested_by || "",
    outputUrl: row.output_url || "",
    error: row.error || "",
    attemptCount: Number(row.attempt_count || 0),
    progress: Number(row.progress || 0),
    progressMessage: row.progress_message || "",
    result: row.result || {},
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    updatedAt: row.updated_at
  } : null;
}

export function mapWorkerHeartbeatRecord(row) {
  return row ? {
    workerId: row.worker_id,
    workerName: row.worker_name,
    status: row.status,
    currentJobId: row.current_job_id || "",
    hostname: row.hostname || "",
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    lastSeenAt: row.last_seen_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at
  } : null;
}

const WORKER_UPDATE_STATUSES = new Set(["processing", "completed", "failed"]);
const PRODUCTION_PROGRESS_MILESTONES = Object.freeze([0, 10, 25, 75, 90, 100]);

export function normalizeProductionJobProgress(progress) {
  const numeric = Number(progress);
  if (!Number.isFinite(numeric)) return 0;
  const bounded = Math.max(0, Math.min(100, numeric));
  return [...PRODUCTION_PROGRESS_MILESTONES].reverse().find((milestone) => bounded >= milestone) || 0;
}

export function normalizeProductionJobUpdate(patch = {}) {
  const status = patch.status || "processing";
  if (!WORKER_UPDATE_STATUSES.has(status)) {
    throw new Error("Production job updates require processing, completed, or failed status.");
  }
  const normalized = { ...patch, status };
  if (status === "completed") normalized.progress = 100;
  else if (Object.hasOwn(patch, "progress")) normalized.progress = normalizeProductionJobProgress(patch.progress);
  return normalized;
}

export function activityLimit(limit) {
  const parsed = Number(limit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100) : 20;
}

export function activityVisibilityQuery(user = null) {
  if (!user || user.role === "admin") return { where: "", params: [] };
  if (user.role === "staff-editor") {
    return { where: "p.assigned_staff_id = $1", params: [user.id || "__none__"] };
  }
  return {
    where: "(p.client_id = $1 or p.reviewer_id = $2)",
    params: [user.clientId || "__none__", user.id || "__none__"]
  };
}

export function activityProjectFilter(user = null) {
  if (user?.role === "staff-editor") return `assigned_staff_id=eq.${eq(user.id || "__none__")}`;
  return `or=(client_id.eq.${eq(user?.clientId || "__none__")},reviewer_id.eq.${eq(user?.id || "__none__")})`;
}

function mapActivityEvent(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: row?.id,
    eventType: row?.event_type || "",
    projectName: row?.project_name || "",
    actorId: metadata.actorId || "system",
    actorName: metadata.actorName || "ContentFlow",
    actorRole: metadata.actorRole || "system",
    summary: metadata.summary || "",
    metadata,
    createdAt: row?.created_at || ""
  };
}

export async function recordSupabaseActivityEvent({
  eventType,
  projectName = "",
  actor = null,
  summary = "",
  metadata = {}
} = {}) {
  if (!eventType) return { skipped: true };
  const eventMetadata = {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    actorId: actor?.id || "system",
    actorName: actor?.name || "ContentFlow",
    actorRole: actor?.role || "system",
    summary
  };

  try {
    if (hostedRestMode()) {
      await restRequest("cf_analytics_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: {
          event_type: eventType,
          project_name: projectName || null,
          metadata: eventMetadata
        }
      });
      return { skipped: false };
    }
    if (!await ensureSupabaseReady()) return { skipped: true };
    await getPool().query(`
      insert into cf_analytics_events (event_type, project_name, metadata)
      values ($1, $2, $3::jsonb)
    `, [eventType, projectName || null, JSON.stringify(eventMetadata)]);
    return { skipped: false };
  } catch (error) {
    return { skipped: true, error: error.message };
  }
}

export async function listSupabaseActivity({ user = null, limit = 20 } = {}) {
  const safeLimit = activityLimit(limit);
  try {
    if (hostedRestMode()) {
      const filters = ["order=created_at.desc", `limit=${safeLimit}`];
      if (!user || user.role === "admin") {
        filters.unshift("select=id,event_type,project_name,metadata,created_at");
      } else {
        const projects = await restTable("cf_projects", `select=name&${activityProjectFilter(user)}`);
        const projectNames = projects.map((project) => project.name).filter(Boolean);
        if (!projectNames.length) return [];
        filters.unshift("select=id,event_type,project_name,metadata,created_at");
        filters.push(`project_name=in.(${projectNames.map(eq).join(",")})`);
      }
      return (await restTable("cf_analytics_events", filters.join("&"))).map(mapActivityEvent);
    }
    if (!await ensureSupabaseReady()) return [];
    const { where, params } = activityVisibilityQuery(user);
    const result = await getPool().query(`
      select e.id, e.event_type, e.project_name, e.metadata, e.created_at
      from cf_analytics_events e
      left join cf_projects p on p.name = e.project_name
      ${where ? `where ${where}` : ""}
      order by e.created_at desc
      limit $${params.length + 1}
    `, [...params, safeLimit]);
    return result.rows.map(mapActivityEvent);
  } catch {
    return [];
  }
}

export async function createSupabaseProductionJob(job) {
  if (hostedRestMode()) {
    const [row] = await restRequest("cf_production_jobs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        project_name: job.projectName,
        job_type: job.jobType,
        status: job.status || "queued",
        payload: job.payload || {},
        requested_by: job.requestedBy || null,
        updated_at: new Date().toISOString()
      }
    });
    return mapProductionJobRecord(row);
  }
  if (!await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
  const result = await getPool().query(`
    insert into cf_production_jobs (project_name, job_type, status, payload, requested_by, updated_at)
    values ($1, $2, $3, $4::jsonb, $5, now())
    returning *
  `, [job.projectName, job.jobType, job.status || "queued", JSON.stringify(job.payload || {}), job.requestedBy || null]);
  return mapProductionJobRecord(result.rows[0]);
}

export async function listSupabaseProductionJobs({ projectName = "", status = "", jobType = "", limit = 50 } = {}) {
  if (hostedRestMode()) {
    const filters = ["select=*", "order=created_at.desc"];
    if (projectName) filters.push(`project_name=eq.${eq(projectName)}`);
    if (status) filters.push(`status=eq.${eq(status)}`);
    if (jobType) filters.push(`job_type=eq.${eq(jobType)}`);
    filters.push(`limit=${Math.max(1, Math.min(Number(limit) || 50, 200))}`);
    return (await restTable("cf_production_jobs", filters.join("&"))).map(mapProductionJobRecord);
  }
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
  if (jobType) {
    params.push(jobType);
    clauses.push(`job_type = $${params.length}`);
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
  return result.rows.map(mapProductionJobRecord);
}

export async function claimNextSupabaseProductionJob() {
  if (hostedRestMode()) {
    const [candidate] = await restTable("cf_production_jobs", "select=*&status=eq.queued&order=created_at.asc&limit=1");
    if (!candidate) return null;
    const priorAttemptCount = Number(candidate.attempt_count || 0);
    const [row] = await restRequest(`cf_production_jobs?id=eq.${eq(candidate.id)}&status=eq.queued&attempt_count=eq.${eq(priorAttemptCount)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: {
        status: "processing",
        attempt_count: priorAttemptCount + 1,
        started_at: new Date().toISOString(),
        completed_at: null,
        cancelled_at: null,
        output_url: null,
        error: null,
        progress: 10,
        progress_message: null,
        result: {},
        updated_at: new Date().toISOString()
      }
    });
    const job = mapProductionJobRecord(row);
    if (job) {
      await recordSupabaseActivityEvent({
        eventType: "production.job.claimed",
        projectName: job.projectName,
        actor: { id: "production-worker", name: "ContentFlow production worker", role: "system" },
        summary: `${job.jobType} claimed by a production worker`,
        metadata: { jobId: job.id, jobType: job.jobType, attemptCount: job.attemptCount }
      });
    }
    return job;
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    update cf_production_jobs
    set status = 'processing',
      attempt_count = attempt_count + 1,
      started_at = now(),
      completed_at = null,
      cancelled_at = null,
      output_url = null,
      error = null,
      progress = 10,
      progress_message = null,
      result = '{}'::jsonb,
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
  const job = mapProductionJobRecord(result.rows[0]);
  if (job) {
    await recordSupabaseActivityEvent({
      eventType: "production.job.claimed",
      projectName: job.projectName,
      actor: { id: "production-worker", name: "ContentFlow production worker", role: "system" },
      summary: `${job.jobType} claimed by a production worker`,
      metadata: { jobId: job.id, jobType: job.jobType, attemptCount: job.attemptCount }
    });
  }
  return job;
}

export async function updateSupabaseProductionJob(id, patch = {}) {
  if (!id) throw new Error("Supabase job id is required.");
  const normalizedPatch = normalizeProductionJobUpdate(patch);
  const status = normalizedPatch.status;
  const now = new Date().toISOString();
  const fields = { status, updated_at: now };
  if (Object.hasOwn(normalizedPatch, "outputUrl")) fields.output_url = normalizedPatch.outputUrl || null;
  if (Object.hasOwn(normalizedPatch, "error")) fields.error = normalizedPatch.error || null;
  if (Object.hasOwn(normalizedPatch, "progress")) fields.progress = normalizedPatch.progress;
  if (Object.hasOwn(normalizedPatch, "progressMessage")) fields.progress_message = normalizedPatch.progressMessage || null;
  if (Object.hasOwn(normalizedPatch, "result")) fields.result = normalizedPatch.result || {};
  if (["completed", "failed"].includes(status)) fields.completed_at = now;
  let job = null;
  if (hostedRestMode()) {
    const [row] = await restRequest(`cf_production_jobs?id=eq.${eq(id)}&status=eq.processing`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: fields
    });
    job = mapProductionJobRecord(row);
  } else {
    if (!await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
    const values = [id];
    const assignments = Object.entries(fields).map(([column, fieldValue]) => {
      values.push(column === "result" ? JSON.stringify(fieldValue) : fieldValue);
      const placeholder = `$${values.length}`;
      return `${column} = ${column === "result" ? `${placeholder}::jsonb` : placeholder}`;
    });
    const result = await getPool().query(`
      update cf_production_jobs
      set ${assignments.join(", ")}
      where id = $1 and status = 'processing'
      returning *
    `, values);
    job = mapProductionJobRecord(result.rows[0]);
  }
  if (job && (status === "completed" || status === "failed")) {
    const startedAt = Date.parse(job.startedAt || "");
    const completedAt = Date.parse(job.completedAt || "");
    const durationMs = Number.isFinite(startedAt) && Number.isFinite(completedAt) ? Math.max(0, completedAt - startedAt) : 0;
    await recordSupabaseActivityEvent({
      eventType: `production.job.${status}`,
      projectName: job.projectName,
      actor: { id: "production-worker", name: "ContentFlow production worker", role: "system" },
      summary: status === "completed" ? `${job.jobType} completed` : `${job.jobType} failed`,
      metadata: { jobId: job.id, jobType: job.jobType, attemptCount: job.attemptCount, durationMs, outputUrl: job.outputUrl }
    });
  }
  return job;
}

export async function getSupabaseProductionJob(id) {
  if (!id) throw new Error("Supabase job id is required.");
  if (hostedRestMode()) {
    const [row] = await restTable("cf_production_jobs", `select=*&id=eq.${eq(id)}&limit=1`);
    return mapProductionJobRecord(row);
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query("select * from cf_production_jobs where id = $1 limit 1", [id]);
  return mapProductionJobRecord(result.rows[0]);
}

export async function cancelSupabaseProductionJob(id) {
  if (!id) throw new Error("Supabase job id is required.");
  const now = new Date().toISOString();
  if (hostedRestMode()) {
    const [row] = await restRequest(`cf_production_jobs?id=eq.${eq(id)}&status=eq.queued`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { status: "cancelled", cancelled_at: now, updated_at: now }
    });
    return mapProductionJobRecord(row);
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    update cf_production_jobs
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = $1 and status = 'queued'
    returning *
  `, [id]);
  return mapProductionJobRecord(result.rows[0]);
}

export async function retrySupabaseProductionJob(id) {
  if (!id) throw new Error("Supabase job id is required.");
  const now = new Date().toISOString();
  const retryFields = {
    status: "queued",
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    output_url: null,
    error: null,
    progress: 0,
    progress_message: null,
    result: {},
    updated_at: now
  };
  if (hostedRestMode()) {
    const [row] = await restRequest(`cf_production_jobs?id=eq.${eq(id)}&status=in.(failed,cancelled)`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: retryFields
    });
    return mapProductionJobRecord(row);
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    update cf_production_jobs
    set status = 'queued',
      started_at = null,
      completed_at = null,
      cancelled_at = null,
      output_url = null,
      error = null,
      progress = 0,
      progress_message = null,
      result = '{}'::jsonb,
      updated_at = now()
    where id = $1 and status in ('failed', 'cancelled')
    returning *
  `, [id]);
  return mapProductionJobRecord(result.rows[0]);
}

export async function upsertSupabaseWorkerHeartbeat(worker) {
  if (!worker?.workerId) throw new Error("Worker id is required.");
  const now = new Date().toISOString();
  const heartbeat = {
    worker_id: worker.workerId,
    worker_name: worker.workerName || worker.workerId,
    status: worker.status || "online",
    current_job_id: worker.currentJobId || null,
    hostname: worker.hostname || null,
    capabilities: Array.isArray(worker.capabilities) ? worker.capabilities : [],
    last_seen_at: worker.lastSeenAt || now,
    updated_at: now
  };
  if (hostedRestMode()) {
    const [row] = await restRequest("cf_worker_heartbeats?on_conflict=worker_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: heartbeat
    });
    return mapWorkerHeartbeatRecord(row);
  }
  if (!await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
  const result = await getPool().query(`
    insert into cf_worker_heartbeats (
      worker_id, worker_name, status, current_job_id, hostname, capabilities, last_seen_at, started_at, updated_at
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, now(), now())
    on conflict (worker_id) do update set
      worker_name = excluded.worker_name,
      status = excluded.status,
      current_job_id = excluded.current_job_id,
      hostname = excluded.hostname,
      capabilities = excluded.capabilities,
      last_seen_at = excluded.last_seen_at,
      updated_at = now()
    returning *
  `, [
    heartbeat.worker_id,
    heartbeat.worker_name,
    heartbeat.status,
    heartbeat.current_job_id,
    heartbeat.hostname,
    JSON.stringify(heartbeat.capabilities),
    heartbeat.last_seen_at
  ]);
  return mapWorkerHeartbeatRecord(result.rows[0]);
}

export async function listSupabaseWorkerHeartbeats() {
  if (hostedRestMode()) {
    return (await restTable("cf_worker_heartbeats", "select=*&order=last_seen_at.desc")).map(mapWorkerHeartbeatRecord);
  }
  if (!await ensureSupabaseReady()) return [];
  const result = await getPool().query("select * from cf_worker_heartbeats order by last_seen_at desc");
  return result.rows.map(mapWorkerHeartbeatRecord);
}

export async function setSupabaseWorkerHeartbeatStatus(workerId, status, observedLastSeenAt) {
  if (!workerId) throw new Error("Worker id is required.");
  if (!observedLastSeenAt) throw new Error("Observed worker heartbeat time is required.");
  if (hostedRestMode()) {
    const [row] = await restRequest(`cf_worker_heartbeats?worker_id=eq.${eq(workerId)}&status=neq.${eq(status)}&last_seen_at=eq.${eq(observedLastSeenAt)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { status, updated_at: new Date().toISOString() }
    });
    return mapWorkerHeartbeatRecord(row);
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    update cf_worker_heartbeats
    set status = $2, updated_at = now()
    where worker_id = $1
      and status is distinct from $2
      and last_seen_at = $3::timestamptz
    returning *
  `, [workerId, status, observedLastSeenAt]);
  return mapWorkerHeartbeatRecord(result.rows[0]);
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

function storageObjectPath(storagePath) {
  const segments = storagePath.split(/[\\/]+/).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) throw new Error("Invalid Supabase Storage path.");
  return segments.map(encodeURIComponent).join("/");
}

export function supabasePublicStorageUrl(storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media"
} = {}) {
  const baseUrl = supabasePublicUrl();
  if (!baseUrl) return "";
  return `${baseUrl}/storage/v1/object/public/${bucket}/${storageObjectPath(storagePath)}`;
}

export async function createSupabaseSignedUploadUrl(storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media"
} = {}) {
  const baseUrl = supabasePublicUrl();
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey) throw new Error("Supabase Storage is not configured.");
  const cleanPath = storageObjectPath(storagePath);
  const storageApiUrl = `${baseUrl}/storage/v1`;
  const response = await fetch(`${storageApiUrl}/object/upload/sign/${bucket}/${cleanPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ allowOverwrite: false })
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) throw new Error(`Supabase signed upload URL failed: ${response.status} ${data.message || text}`);
  const signedPath = String(data.url || "");
  if (!signedPath) throw new Error("Supabase did not return a signed upload URL.");
  return {
    uploadUrl: signedPath.startsWith("http") ? signedPath : `${storageApiUrl}${signedPath.startsWith("/") ? "" : "/"}${signedPath}`,
    storagePath,
    publicUrl: supabasePublicStorageUrl(storagePath, { bucket })
  };
}

export async function verifySupabaseStorageObject(storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media"
} = {}) {
  const baseUrl = supabasePublicUrl();
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey) throw new Error("Supabase Storage is not configured.");
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${storageObjectPath(storagePath)}`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
  });
  if (!response.ok) throw new Error(`Uploaded reaction could not be verified in Supabase Storage (${response.status}).`);
  return {
    size: Number(response.headers.get("content-length") || 0),
    contentType: String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase()
  };
}

export async function readSupabaseStoragePrefix(storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media",
  byteCount = 32
} = {}) {
  const baseUrl = supabasePublicUrl();
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey) throw new Error("Supabase Storage is not configured.");
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${storageObjectPath(storagePath)}`, {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      Range: `bytes=0-${Math.max(0, Number(byteCount || 32) - 1)}`
    }
  });
  if (!response.ok && response.status !== 206) throw new Error(`Uploaded reaction signature could not be read (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadSupabaseStorageFile(localPath, storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media"
} = {}) {
  if (!fs.existsSync(localPath)) return "";
  return uploadSupabaseStorageBuffer(fs.readFileSync(localPath), storagePath, {
    bucket,
    contentType: contentTypeForPath(localPath)
  });
}

export async function uploadSupabaseStorageBuffer(buffer, storagePath, {
  bucket = value("SUPABASE_STORAGE_BUCKET") || "contentflow-media",
  contentType = "application/octet-stream"
} = {}) {
  const baseUrl = supabasePublicUrl();
  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceKey || !buffer?.length) return "";
  const cleanPath = storageObjectPath(storagePath);
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${cleanPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true"
    },
    body: buffer
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Storage upload failed: ${response.status} ${text}`);
  }
  return supabasePublicStorageUrl(storagePath, { bucket });
}

export async function uploadSupabaseProjectAsset(projectName, projectDir, asset) {
  if (!projectName || !projectDir || !asset?.localPath) return asset;
  if (asset.kind !== "reaction-character") return asset;
  const projectRoot = path.resolve(projectDir);
  const absolutePath = path.resolve(projectRoot, asset.localPath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Asset path must stay inside project ${projectName}.`);
  }
  if (!fs.existsSync(absolutePath)) throw new Error(`Project asset is missing: ${asset.localPath}`);
  const normalizedPath = relativePath.split(path.sep).join("/");
  const storagePath = path.posix.join("projects", projectName, "assets", normalizedPath);
  const url = await uploadSupabaseStorageFile(absolutePath, storagePath);
  if (!url) throw new Error(`Supabase Storage is not configured for ${asset.name || asset.localPath}.`);
  return { ...asset, url };
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

function analyticsProjectVisible(project, user) {
  if (!user || user.role === "admin") return true;
  if (user.role === "staff-editor") return project.assigned_staff_id === user.id;
  return project.client_id === (user.clientId || "__none__") || project.reviewer_id === user.id;
}

function groupedRows(items, keyFor) {
  const counts = new Map();
  for (const item of items) {
    const name = keyFor(item);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function hostedSupabaseAnalytics(user) {
  const [projects, renders, users, campaigns, assets, clipCandidates] = await Promise.all([
    restTable("cf_projects", "select=*"),
    restTable("cf_render_jobs", "select=project_name,created_at"),
    restTable("cf_users", "select=id,name"),
    restTable("cf_campaigns", "select=id,name"),
    restTable("cf_assets", "select=project_name,kind"),
    restTable("cf_clip_candidates", "select=project_name")
  ]);

  const visibleProjects = projects.filter((project) => analyticsProjectVisible(project, user));
  const visibleNames = new Set(visibleProjects.map((project) => project.name));
  const visibleRenders = renders.filter((render) => visibleNames.has(render.project_name));
  const userNames = new Map(users.map((person) => [person.id, person.name]));
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  const approvalBreakdown = {};

  for (const project of visibleProjects) {
    const status = project.approval_status || "draft";
    approvalBreakdown[status] = (approvalBreakdown[status] || 0) + 1;
  }

  return {
    projects: visibleProjects.length,
    renders: visibleRenders.length,
    ai_projects: visibleProjects.filter((project) => project.type === "ai-generator").length,
    clipper_projects: visibleProjects.filter((project) => project.type === "auto-clipper").length,
    approval_breakdown: approvalBreakdown,
    staff_workload: groupedRows(visibleProjects, (project) => userNames.get(project.assigned_staff_id) || project.assigned_staff_id || "Unassigned"),
    campaign_projects: groupedRows(visibleProjects, (project) => campaignNames.get(project.campaign_id) || "No campaign"),
    asset_breakdown: groupedRows(assets.filter((asset) => visibleNames.has(asset.project_name)), (asset) => asset.kind || "unknown"),
    clip_candidates: clipCandidates.filter((candidate) => visibleNames.has(candidate.project_name)).length,
    monthly_renders: groupedRows(visibleRenders.filter((render) => render.created_at), (render) => String(render.created_at).slice(0, 7))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name: month, count }) => ({ month, count }))
  };
}

export async function supabaseAnalytics(user = null) {
  if (hostedRestMode()) return hostedSupabaseAnalytics(user);
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
