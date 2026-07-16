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

function safeActorId(value) {
  const actor = String(value || "").trim();
  return !actor || ["local", "local-admin", "legacy-import", "worker"].includes(actor) ? null : actor;
}

function objectValue(value, fallback) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function domainDocument(value, excludedKeys) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excludedKeys.has(key)));
}

function updateRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "created_at", "created_by"].includes(key)));
}

async function restUpsertDomainRow(table, row, { conflict = "id", match = "" } = {}) {
  const filter = match || (row.id ? `id=eq.${eq(row.id)}` : "");
  if (filter) {
    const updated = await restRequest(`${table}?${filter}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: updateRow(row)
    });
    if (updated?.[0]) return updated[0];
  }
  const resource = conflict ? `${table}?on_conflict=${conflict}` : table;
  const [created] = await restRequest(resource, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: row
  });
  return created;
}

export function mapSupabaseCampaignBriefRow(row) {
  return row ? {
    id: row.id,
    campaignId: row.campaign_id || "",
    title: row.title,
    productName: row.product_name || "",
    objective: row.objective || "",
    targetAudience: row.target_audience || "",
    brief: objectValue(row.brief, {}),
    status: row.status || "draft",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

export function mapSupabaseResearchSourceRow(row) {
  return row ? {
    id: row.id,
    briefId: row.brief_id || "",
    type: row.source_type,
    name: row.name,
    content: row.content || "",
    passages: Array.isArray(row.passages) ? row.passages : [],
    metadata: objectValue(row.metadata, {}),
    localPath: row.local_path || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at
  } : null;
}

export function mapSupabaseMarketReportRow(row) {
  if (!row) return null;
  const report = objectValue(row.report, {});
  return {
    ...report,
    id: row.id,
    briefId: row.brief_id || "",
    campaignId: row.campaign_id || "",
    status: row.status || "draft",
    source: row.source || report.source || "fallback",
    report,
    scriptwriterInput: objectValue(row.scriptwriter_input, report.scriptwriterInput || {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapSupabaseUgcScriptRow(row) {
  return row ? {
    id: row.id,
    marketReportId: row.market_report_id || "",
    campaignId: row.campaign_id || "",
    projectName: row.project_name || "",
    title: row.title,
    status: row.status || "draft",
    selectedHookId: row.selected_hook_id || "",
    selectedHookIndex: row.selected_hook_index ?? null,
    currentVersionNumber: Number(row.current_version_number ?? 0),
    createdBy: row.created_by || "",
    updatedBy: row.updated_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

export function mapSupabaseUgcScriptVersionRow(row) {
  if (!row) return null;
  const content = objectValue(row.content, {});
  const versionNumber = Number(row.version_number || 1);
  return {
    ...content,
    id: row.id,
    scriptId: row.script_id || "",
    versionNumber,
    number: versionNumber,
    content,
    changeNote: row.change_note || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at
  };
}

export function mapSupabaseScriptReviewEventRow(row) {
  if (!row) return null;
  const toStatus = row.to_status;
  return {
    id: row.id,
    scriptId: row.script_id || "",
    versionId: row.version_id || "",
    fromStatus: row.from_status || "",
    toStatus,
    status: toStatus,
    feedback: row.feedback || "",
    actorId: row.actor_id || "",
    overrideReason: row.override_reason || "",
    createdAt: row.created_at
  };
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

export async function upsertSupabaseCampaignBrief(brief) {
  const row = {
    ...(brief.id ? { id: brief.id } : {}),
    campaign_id: brief.campaignId || null,
    title: brief.title,
    product_name: brief.productName || brief.product || null,
    objective: brief.objective || null,
    target_audience: brief.targetAudience || brief.audience || null,
    brief: objectValue(brief.brief, domainDocument(brief, new Set([
      "id", "campaignId", "title", "productName", "objective", "targetAudience", "status",
      "createdBy", "createdAt", "updatedAt"
    ]))),
    status: brief.status || "draft",
    created_by: safeActorId(brief.createdBy),
    created_at: safeDate(brief.createdAt),
    updated_at: safeDate(brief.updatedAt)
  };
  if (hostedRestMode()) {
    return mapSupabaseCampaignBriefRow(await restUpsertDomainRow("cf_campaign_briefs", row));
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    insert into cf_campaign_briefs (
      id, campaign_id, title, product_name, objective, target_audience, brief, status,
      created_by, created_at, updated_at
    ) values (coalesce($1, gen_random_uuid()::text), $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
    on conflict (id) do update set
      campaign_id = excluded.campaign_id,
      title = excluded.title,
      product_name = excluded.product_name,
      objective = excluded.objective,
      target_audience = excluded.target_audience,
      brief = excluded.brief,
      status = excluded.status,
      updated_at = excluded.updated_at
    returning *
  `, [
    brief.id || null, row.campaign_id, row.title, row.product_name, row.objective, row.target_audience,
    JSON.stringify(row.brief), row.status, row.created_by, row.created_at, row.updated_at
  ]);
  return mapSupabaseCampaignBriefRow(result.rows[0]);
}

export async function upsertSupabaseResearchSource(source) {
  const row = {
    ...(source.id ? { id: source.id } : {}),
    brief_id: source.briefId || null,
    source_type: source.type || source.sourceType || "text",
    name: source.name || source.fileName,
    content: source.content || source.text || "",
    passages: Array.isArray(source.passages) ? source.passages : [],
    metadata: objectValue(source.metadata, {}),
    local_path: source.localPath || null,
    created_by: safeActorId(source.createdBy),
    created_at: safeDate(source.createdAt)
  };
  if (hostedRestMode()) {
    return mapSupabaseResearchSourceRow(await restUpsertDomainRow("cf_research_sources", row));
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    insert into cf_research_sources (
      id, brief_id, source_type, name, content, passages, metadata, local_path, created_by, created_at
    ) values (coalesce($1, gen_random_uuid()::text), $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
    on conflict (id) do update set
      brief_id = excluded.brief_id,
      source_type = excluded.source_type,
      name = excluded.name,
      content = excluded.content,
      passages = excluded.passages,
      metadata = excluded.metadata,
      local_path = excluded.local_path
    returning *
  `, [
    source.id || null, row.brief_id, row.source_type, row.name, row.content, JSON.stringify(row.passages),
    JSON.stringify(row.metadata), row.local_path, row.created_by, row.created_at
  ]);
  return mapSupabaseResearchSourceRow(result.rows[0]);
}

export async function deleteSupabaseResearchSource(id) {
  if (!id) return { skipped: true };
  if (hostedRestMode()) {
    await restRequest(`cf_research_sources?id=eq.${eq(id)}`, { method: "DELETE" });
    return { skipped: false, id };
  }
  if (!await ensureSupabaseReady()) return { skipped: true };
  await getPool().query("delete from cf_research_sources where id = $1", [id]);
  return { skipped: false, id };
}

export async function upsertSupabaseMarketReport(report) {
  const reportDocument = objectValue(report.report, domainDocument(report, new Set([
    "id", "briefId", "campaignId", "status", "source", "scriptwriterInput", "scriptwriterInputBlock",
    "createdBy", "createdAt", "updatedAt"
  ])));
  const row = {
    ...(report.id ? { id: report.id } : {}),
    brief_id: report.briefId || null,
    campaign_id: report.campaignId || null,
    status: report.status || "draft",
    source: report.source || "fallback",
    report: reportDocument,
    scriptwriter_input: objectValue(report.scriptwriterInput, reportDocument.scriptwriterInput || {}),
    created_by: safeActorId(report.createdBy),
    created_at: safeDate(report.createdAt),
    updated_at: safeDate(report.updatedAt)
  };
  if (hostedRestMode()) {
    return mapSupabaseMarketReportRow(await restUpsertDomainRow("cf_market_reports", row));
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    insert into cf_market_reports (
      id, brief_id, campaign_id, status, source, report, scriptwriter_input, created_by, created_at, updated_at
    ) values (coalesce($1, gen_random_uuid()::text), $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
    on conflict (id) do update set
      brief_id = excluded.brief_id,
      campaign_id = excluded.campaign_id,
      status = excluded.status,
      source = excluded.source,
      report = excluded.report,
      scriptwriter_input = excluded.scriptwriter_input,
      updated_at = excluded.updated_at
    returning *
  `, [
    report.id || null, row.brief_id, row.campaign_id, row.status, row.source, JSON.stringify(row.report),
    JSON.stringify(row.scriptwriter_input), row.created_by, row.created_at, row.updated_at
  ]);
  return mapSupabaseMarketReportRow(result.rows[0]);
}

export async function upsertSupabaseUgcScript(script) {
  const row = {
    ...(script.id ? { id: script.id } : {}),
    market_report_id: script.marketReportId || null,
    campaign_id: script.campaignId || null,
    project_name: script.projectName || null,
    title: script.title,
    status: script.status || "draft",
    selected_hook_id: script.selectedHookId || null,
    selected_hook_index: script.selectedHookIndex ?? null,
    current_version_number: Number(script.currentVersionNumber ?? script.versionNumber ?? 0),
    created_by: safeActorId(script.createdBy),
    updated_by: safeActorId(script.updatedBy || script.createdBy),
    created_at: safeDate(script.createdAt),
    updated_at: safeDate(script.updatedAt)
  };
  if (hostedRestMode()) {
    return mapSupabaseUgcScriptRow(await restUpsertDomainRow("cf_ugc_scripts", row));
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    insert into cf_ugc_scripts (
      id, market_report_id, campaign_id, project_name, title, status, selected_hook_id,
      selected_hook_index, current_version_number, created_by, updated_by, created_at, updated_at
    ) values (coalesce($1, gen_random_uuid()::text), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    on conflict (id) do update set
      market_report_id = excluded.market_report_id,
      campaign_id = excluded.campaign_id,
      project_name = excluded.project_name,
      title = excluded.title,
      status = excluded.status,
      selected_hook_id = excluded.selected_hook_id,
      selected_hook_index = excluded.selected_hook_index,
      current_version_number = excluded.current_version_number,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
    returning *
  `, [
    script.id || null, row.market_report_id, row.campaign_id, row.project_name, row.title, row.status,
    row.selected_hook_id, row.selected_hook_index, row.current_version_number, row.created_by, row.updated_by,
    row.created_at, row.updated_at
  ]);
  return mapSupabaseUgcScriptRow(result.rows[0]);
}

export async function upsertSupabaseUgcScriptVersion(version) {
  const content = objectValue(version.content, objectValue(version.script, domainDocument(version, new Set([
    "id", "scriptId", "versionNumber", "changeNote", "createdBy", "createdAt"
  ]))));
  const row = {
    ...(version.id ? { id: version.id } : {}),
    script_id: version.scriptId || null,
    version_number: Number(version.versionNumber || 1),
    content,
    change_note: version.changeNote || null,
    created_by: safeActorId(version.createdBy),
    created_at: safeDate(version.createdAt)
  };
  if (hostedRestMode()) {
    return mapSupabaseUgcScriptVersionRow(await restUpsertDomainRow("cf_ugc_script_versions", row, {
      conflict: "script_id,version_number",
      match: row.id ? `id=eq.${eq(row.id)}` : `script_id=eq.${eq(row.script_id)}&version_number=eq.${row.version_number}`
    }));
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    insert into cf_ugc_script_versions (
      id, script_id, version_number, content, change_note, created_by, created_at
    ) values (coalesce($1, gen_random_uuid()::text), $2, $3, $4::jsonb, $5, $6, $7)
    on conflict (script_id, version_number) do update set
      content = excluded.content,
      change_note = excluded.change_note
    returning *
  `, [
    version.id || null, row.script_id, row.version_number, JSON.stringify(row.content), row.change_note,
    row.created_by, row.created_at
  ]);
  return mapSupabaseUgcScriptVersionRow(result.rows[0]);
}

export async function recordSupabaseScriptReviewEvent(event) {
  const row = {
    ...(event.id ? { id: event.id } : {}),
    script_id: event.scriptId || null,
    version_id: event.versionId || null,
    from_status: event.fromStatus || null,
    to_status: event.toStatus,
    feedback: event.feedback || null,
    actor_id: safeActorId(event.actorId),
    override_reason: event.overrideReason || null,
    created_at: safeDate(event.createdAt)
  };
  if (hostedRestMode()) {
    const [saved] = await restRequest("cf_script_review_events", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: row
    });
    return mapSupabaseScriptReviewEventRow(saved);
  }
  if (!await ensureSupabaseReady()) return null;
  const result = await getPool().query(`
    insert into cf_script_review_events (
      id, script_id, version_id, from_status, to_status, feedback, actor_id, override_reason, created_at
    ) values (coalesce($1, gen_random_uuid()::text), $2, $3, $4, $5, $6, $7, $8, $9)
    returning *
  `, [
    event.id || null, row.script_id, row.version_id, row.from_status, row.to_status, row.feedback,
    row.actor_id, row.override_reason, row.created_at
  ]);
  return mapSupabaseScriptReviewEventRow(result.rows[0]);
}

export async function upsertSupabaseProject(project) {
  if (hostedRestMode()) {
    const [row] = await restRequest("cf_projects?on_conflict=name", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: {
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
      }
    });
    return row || { skipped: false };
  }
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
    hasMarketReport: Number(row.market_report_count || 0) > 0,
    hasUgcScript: Number(row.script_count || 0) > 0,
    scriptStatus: row.script_status || "",
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
  if (hostedRestMode()) {
    const [projects, assets, renders, clips, scripts] = await Promise.all([
      restTable("cf_projects", "select=*"),
      restTable("cf_assets", "select=*"),
      restTable("cf_render_jobs", "select=*"),
      restTable("cf_clip_candidates", "select=*"),
      restTable("cf_ugc_scripts", "select=project_name,status,market_report_id,updated_at&order=updated_at.desc")
    ]);
    return projects.map((project) => {
      const projectAssets = assets.filter((asset) => asset.project_name === project.name);
      const projectRenders = renders.filter((render) => render.project_name === project.name);
      const projectClips = clips.filter((clip) => clip.project_name === project.name);
      const projectScripts = scripts.filter((script) => script.project_name === project.name);
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
        clip_candidate_count: projectClips.length,
        script_count: projectScripts.length,
        market_report_count: projectScripts.filter((script) => script.market_report_id).length,
        script_status: projectScripts[0]?.status || ""
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
      ,count(distinct s.id) as script_count
      ,count(distinct s.market_report_id) as market_report_count
      ,(array_agg(s.status order by s.updated_at desc) filter (where s.id is not null))[1] as script_status
    from cf_projects p
    left join cf_assets a on a.project_name = p.name
    left join cf_render_jobs r on r.project_name = p.name
    left join cf_clip_candidates cc on cc.project_name = p.name
    left join cf_ugc_scripts s on s.project_name = p.name
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

function emptyCampaignIntelligence() {
  return { campaignBrief: null, researchSources: [], marketReport: null };
}

function emptyProjectScriptBundle() {
  return { ugcScript: null, scriptAnalysis: null, scriptVersions: [], scriptReviewEvents: [] };
}

function isClientUser(user) {
  return user?.role === "manager-client";
}

function projectRowVisible(project, user) {
  if (!user || user.role === "admin") return true;
  if (user.role === "staff-editor") return project.assigned_staff_id === user.id;
  return project.client_id === user.clientId || project.reviewer_id === user.id;
}

function newestRows(rows) {
  return [...rows].sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}

function withoutInternalAnalysis(content) {
  const {
    analysis,
    scriptAnalysis,
    transcriptAnalysis,
    createdBy,
    updatedBy,
    approvedBy,
    actorId,
    overrideReason,
    feedback,
    ...visible
  } = content;
  return visible;
}

function redactReportActors(report) {
  if (!report) return null;
  return {
    ...report,
    createdBy: "",
    updatedBy: "",
    approvedBy: "",
    actorId: "",
    overrideReason: "",
    feedback: "",
    approvalFeedback: "",
    internalFeedback: "",
    report: {
      ...objectValue(report.report, {}),
      createdBy: "",
      updatedBy: "",
      approvedBy: "",
      actorId: "",
      overrideReason: "",
      feedback: "",
      approvalFeedback: "",
      internalFeedback: ""
    }
  };
}

function buildProjectScriptBundle(scriptRow, versionRows, eventRows, { client = false } = {}) {
  const script = mapSupabaseUgcScriptRow(scriptRow);
  if (!script) return emptyProjectScriptBundle();
  const scriptVersions = versionRows.map(mapSupabaseUgcScriptVersionRow)
    .sort((a, b) => b.versionNumber - a.versionNumber);
  const scriptReviewEvents = eventRows.map(mapSupabaseScriptReviewEventRow)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const currentVersion = scriptVersions.find((version) => version.versionNumber === script.currentVersionNumber)
    || scriptVersions[0]
    || null;
  const versionContent = currentVersion?.content || {};
  const fullScriptContent = objectValue(versionContent.ugcScript, objectValue(versionContent.script, versionContent));
  const scriptContent = client ? withoutInternalAnalysis(fullScriptContent) : fullScriptContent;
  const visibleScript = client ? { ...script, createdBy: "", updatedBy: "" } : script;
  return {
    ugcScript: currentVersion ? {
      ...scriptContent,
      ...visibleScript,
      versionId: currentVersion.id,
      versionNumber: currentVersion.versionNumber
    } : visibleScript,
    scriptAnalysis: client ? null : objectValue(
      versionContent.scriptAnalysis,
      objectValue(versionContent.analysis, objectValue(versionContent.transcriptAnalysis, null))
    ),
    scriptVersions: client ? [] : scriptVersions,
    scriptReviewEvents: client ? scriptReviewEvents
      .filter((event) => !currentVersion || event.versionId === currentVersion.id)
      .map((event) => ({
        ...event,
        actorId: "",
        feedback: "",
        overrideReason: ""
      })) : scriptReviewEvents
  };
}

export async function supabaseCampaignIntelligence(campaignId, { user = null } = {}) {
  if (!campaignId) return emptyCampaignIntelligence();
  let briefRows;
  let reportRows;
  let projectRows = [];
  if (hostedRestMode()) {
    [briefRows, reportRows, projectRows] = await Promise.all([
      restTable("cf_campaign_briefs", `select=*&campaign_id=eq.${eq(campaignId)}&order=updated_at.desc`),
      restTable("cf_market_reports", `select=*&campaign_id=eq.${eq(campaignId)}&order=updated_at.desc`),
      user && user.role !== "admin"
        ? restTable("cf_projects", `select=name,assigned_staff_id,client_id,reviewer_id,campaign_id&campaign_id=eq.${eq(campaignId)}`)
        : []
    ]);
  } else {
    if (!await ensureSupabaseReady()) return emptyCampaignIntelligence();
    const results = await Promise.all([
      getPool().query("select * from cf_campaign_briefs where campaign_id = $1 order by updated_at desc", [campaignId]),
      getPool().query("select * from cf_market_reports where campaign_id = $1 order by updated_at desc", [campaignId]),
      user && user.role !== "admin"
        ? getPool().query("select name, assigned_staff_id, client_id, reviewer_id, campaign_id from cf_projects where campaign_id = $1", [campaignId])
        : Promise.resolve({ rows: [] })
    ]);
    briefRows = results[0].rows;
    reportRows = results[1].rows;
    projectRows = results[2].rows;
  }
  if (user && user.role !== "admin" && !projectRows.some((project) => projectRowVisible(project, user))) {
    return emptyCampaignIntelligence();
  }
  const orderedBriefs = newestRows(briefRows);
  const orderedReports = newestRows(reportRows);
  const selectedReportRow = isClientUser(user)
    ? orderedReports.find((report) => report.status === "approved")
    : orderedReports.find((report) => report.brief_id === orderedBriefs[0]?.id);
  const selectedBriefRow = isClientUser(user)
    ? orderedBriefs.find((brief) => brief.id === selectedReportRow?.brief_id)
    : orderedBriefs[0];
  const campaignBrief = mapSupabaseCampaignBriefRow(selectedBriefRow);
  let sourceRows = [];
  if (campaignBrief && !isClientUser(user)) {
    if (hostedRestMode()) {
      sourceRows = await restTable("cf_research_sources", `select=*&brief_id=eq.${eq(campaignBrief.id)}&order=created_at.asc`);
    } else {
      sourceRows = (await getPool().query(
        "select * from cf_research_sources where brief_id = $1 order by created_at asc",
        [campaignBrief.id]
      )).rows;
    }
  }
  const marketReport = mapSupabaseMarketReportRow(selectedReportRow);
  return {
    campaignBrief: isClientUser(user) && campaignBrief ? { ...campaignBrief, createdBy: "" } : campaignBrief,
    researchSources: sourceRows.map(mapSupabaseResearchSourceRow),
    marketReport: isClientUser(user) ? redactReportActors(marketReport) : marketReport
  };
}

export async function supabaseProjectScriptBundle(projectName, { user = null } = {}) {
  if (!projectName) return emptyProjectScriptBundle();
  let scripts;
  let projectRows = [];
  if (hostedRestMode()) {
    [scripts, projectRows] = await Promise.all([
      restTable("cf_ugc_scripts", `select=*&project_name=eq.${eq(projectName)}&order=updated_at.desc`),
      user && user.role !== "admin"
        ? restTable("cf_projects", `select=name,assigned_staff_id,client_id,reviewer_id&name=eq.${eq(projectName)}&limit=1`)
        : []
    ]);
  } else {
    if (!await ensureSupabaseReady()) return emptyProjectScriptBundle();
    const results = await Promise.all([
      getPool().query("select * from cf_ugc_scripts where project_name = $1 order by updated_at desc", [projectName]),
      user && user.role !== "admin"
        ? getPool().query("select name, assigned_staff_id, client_id, reviewer_id from cf_projects where name = $1", [projectName])
        : Promise.resolve({ rows: [] })
    ]);
    scripts = results[0].rows;
    projectRows = results[1].rows;
  }
  if (user && user.role !== "admin" && !projectRows.some((project) => projectRowVisible(project, user))) {
    return emptyProjectScriptBundle();
  }
  const orderedScripts = newestRows(scripts);
  const scriptRow = isClientUser(user)
    ? orderedScripts.find((script) => script.status === "approved")
    : orderedScripts[0];
  if (!scriptRow) return emptyProjectScriptBundle();
  let versionRows;
  let eventRows;
  if (hostedRestMode()) {
    [versionRows, eventRows] = await Promise.all([
      restTable("cf_ugc_script_versions", `select=*&script_id=eq.${eq(scriptRow.id)}&order=version_number.desc`),
      restTable("cf_script_review_events", `select=*&script_id=eq.${eq(scriptRow.id)}&order=created_at.desc`)
    ]);
  } else {
    const results = await Promise.all([
      getPool().query("select * from cf_ugc_script_versions where script_id = $1 order by version_number desc", [scriptRow.id]),
      getPool().query("select * from cf_script_review_events where script_id = $1 order by created_at desc", [scriptRow.id])
    ]);
    versionRows = results[0].rows;
    eventRows = results[1].rows;
  }
  return buildProjectScriptBundle(scriptRow, versionRows, eventRows, { client: isClientUser(user) });
}

export function buildSupabaseProjectData({
  summary,
  organization,
  assets,
  renders,
  candidates,
  intelligence = emptyCampaignIntelligence(),
  scriptBundle = emptyProjectScriptBundle()
}) {
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
    scriptVersions: scriptBundle.scriptVersions || [],
    scriptReviewEvents: scriptBundle.scriptReviewEvents || [],
    files: {
      clipperHighlights: clipCandidates.length ? { candidates: clipCandidates } : null,
      marketReport: intelligence.marketReport || null,
      scriptAnalysis: scriptBundle.scriptAnalysis || null,
      ugcScript: scriptBundle.ugcScript || null
    }
  };
}

export async function supabaseProjectData(projectName, { user = null } = {}) {
  if (hostedRestMode()) {
    const summaries = await listSupabaseProjectSummaries();
    const summary = summaries.find((project) => project.name === projectName);
    if (!summary) return null;
    const [organization, assets, renders, candidates, intelligence, scriptBundle] = await Promise.all([
      listSupabaseOrganization(),
      restTable("cf_assets", `select=*&project_name=eq.${eq(projectName)}&order=created_at.desc`),
      restTable("cf_render_jobs", `select=*&project_name=eq.${eq(projectName)}&order=created_at.desc`),
      restTable("cf_clip_candidates", `select=*&project_name=eq.${eq(projectName)}&order=score.desc,start_seconds.asc`),
      summary.campaignId ? supabaseCampaignIntelligence(summary.campaignId, { user }) : emptyCampaignIntelligence(),
      supabaseProjectScriptBundle(projectName, { user })
    ]);
    return buildSupabaseProjectData({ summary, organization, assets, renders, candidates, intelligence, scriptBundle });
  }
  if (!await ensureSupabaseReady()) return null;
  const summaries = await listSupabaseProjectSummaries();
  const summary = summaries.find((project) => project.name === projectName);
  if (!summary) return null;
  const [organization, assets, renders, candidates, intelligence, scriptBundle] = await Promise.all([
    listSupabaseOrganization(),
    getPool().query("select * from cf_assets where project_name = $1 order by created_at desc", [projectName]),
    getPool().query("select * from cf_render_jobs where project_name = $1 order by created_at desc", [projectName]),
    getPool().query("select * from cf_clip_candidates where project_name = $1 order by score desc, start_seconds asc", [projectName]),
    summary.campaignId ? supabaseCampaignIntelligence(summary.campaignId, { user }) : emptyCampaignIntelligence(),
    supabaseProjectScriptBundle(projectName, { user })
  ]);
  return buildSupabaseProjectData({ summary, organization, assets, renders, candidates, intelligence, scriptBundle });
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
    return mapProductionJob(row);
  }
  if (!await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
  const result = await getPool().query(`
    insert into cf_production_jobs (project_name, job_type, status, payload, requested_by, updated_at)
    values ($1, $2, $3, $4::jsonb, $5, now())
    returning *
  `, [job.projectName, job.jobType, job.status || "queued", JSON.stringify(job.payload || {}), job.requestedBy || null]);
  return mapProductionJob(result.rows[0]);
}

export async function listSupabaseProductionJobs({ projectName = "", status = "", limit = 50 } = {}) {
  if (hostedRestMode()) {
    const filters = ["select=*", "order=created_at.desc", `limit=${Math.max(1, Math.min(Number(limit) || 50, 200))}`];
    if (projectName) filters.push(`project_name=eq.${eq(projectName)}`);
    if (status) filters.push(`status=eq.${eq(status)}`);
    return (await restTable("cf_production_jobs", filters.join("&"))).map(mapProductionJob);
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
  if (!id) throw new Error("Supabase job id is required.");
  const status = patch.status || "processing";
  const completedAt = ["completed", "failed"].includes(status) ? new Date().toISOString() : null;
  let job = null;
  if (hostedRestMode()) {
    const [row] = await restRequest(`cf_production_jobs?id=eq.${eq(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: {
        status,
        output_url: patch.outputUrl || null,
        error: patch.error || null,
        completed_at: completedAt,
        updated_at: new Date().toISOString()
      }
    });
    job = mapProductionJob(row);
  } else {
    if (!await ensureSupabaseReady()) throw new Error("Supabase is not configured.");
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
    job = mapProductionJob(result.rows[0]);
  }
  if (job && (status === "completed" || status === "failed")) {
    void recordSupabaseActivityEvent({
      eventType: `production.${status}`,
      projectName: job.projectName,
      actor: { id: "production-worker", name: "ContentFlow production worker", role: "system" },
      summary: status === "completed" ? `${job.jobType} completed` : `${job.jobType} failed`,
      metadata: { jobId: job.id, jobType: job.jobType, outputUrl: job.outputUrl, error: job.error }
    });
  }
  return job;
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
  if (user.role === "staff-editor") return { projectWhere: "where p.assigned_staff_id = $1", params: [user.id] };
  return { projectWhere: "where (p.client_id = $1 or p.reviewer_id = $2)", params: [user.clientId || "__none__", user.id] };
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

function latestScriptVersions(scripts, versions) {
  const byScript = new Map();
  for (const version of versions) {
    const current = byScript.get(version.script_id);
    if (!current || Number(version.version_number || 0) > Number(current.version_number || 0)) {
      byScript.set(version.script_id, version);
    }
  }
  for (const script of scripts) {
    const requested = versions.find((version) => (
      version.script_id === script.id
      && Number(version.version_number) === Number(script.current_version_number)
    ));
    if (requested) byScript.set(script.id, requested);
  }
  return byScript;
}

function classifyHookText(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.endsWith("?") || /^(why|how|what|when|still|did you|have you|are you|do you)\b/.test(text)) return "question";
  if (/\b(demo|watch|show|see this|look at)\b/.test(text)) return "demo";
  if (/\b(proof|tested|results?|\d+|percent|%)\b/.test(text)) return "proof";
  if (/\b(struggle|problem|pain|slow|mess|wrong|tired|hate|stop|without|wasting)\b/.test(text)) return "problem";
  if (/\b(save|easy|fast|finally|better|improve|benefit)\b/.test(text)) return "benefit";
  if (/\b(confession|story|i|my|we|our)\b/.test(text)) return "story";
  return "other";
}

function aggregateAngleLabel(value) {
  const label = String(value || "").trim().toLowerCase();
  if (!label) return "";
  const normalized = label.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const aggregateLabels = new Set([
    "question", "demo", "proof", "social-proof", "problem", "pain-point", "benefit",
    "story", "confession", "before-after", "other"
  ]);
  if (aggregateLabels.has(normalized)) return normalized;
  return classifyHookText(label);
}

function scriptHookAngle(script, version) {
  const content = objectValue(version?.content, {});
  const direct = content.hookAngle || content.hook_angle || content.hook?.angle || content.selectedHook?.angle;
  if (direct) return aggregateAngleLabel(direct);
  const hooks = Array.isArray(content.hooks) ? content.hooks : [];
  const hook = hooks.find((item) => item?.id && item.id === script.selected_hook_id)
    || hooks[Number(script.selected_hook_index ?? 0)]
    || hooks[0];
  const explicit = hook?.angle || hook?.type || hook?.label;
  if (explicit) return aggregateAngleLabel(explicit);
  return classifyHookText(typeof hook === "string" ? hook : hook?.text);
}

function averageScriptApprovalHours(scripts, reviewEvents) {
  const visibleIds = new Set(scripts.map((script) => script.id));
  const eventsByScript = new Map();
  for (const event of reviewEvents) {
    if (!visibleIds.has(event.script_id)) continue;
    const events = eventsByScript.get(event.script_id) || [];
    events.push(event);
    eventsByScript.set(event.script_id, events);
  }
  const durations = [];
  for (const events of eventsByScript.values()) {
    events.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    let submittedAt = null;
    for (const event of events) {
      const timestamp = new Date(event.created_at).getTime();
      if (!Number.isFinite(timestamp)) continue;
      if (["internal-review", "client-review"].includes(event.to_status)) submittedAt = timestamp;
      if (event.to_status === "approved" && submittedAt !== null && timestamp >= submittedAt) {
        durations.push((timestamp - submittedAt) / 3_600_000);
        break;
      }
    }
  }
  if (!durations.length) return 0;
  return Number((durations.reduce((sum, hours) => sum + hours, 0) / durations.length).toFixed(2));
}

export function buildSupabaseScriptAnalytics({ scripts = [], versions = [], reviewEvents = [], renders = [] } = {}) {
  const scriptIds = new Set(scripts.map((script) => script.id));
  const visibleVersions = versions.filter((version) => scriptIds.has(version.script_id));
  const currentVersions = latestScriptVersions(scripts, visibleVersions);
  const renderedProjects = new Set(renders.map((render) => render.project_name).filter(Boolean));
  const renderedScripts = scripts.filter((script) => script.project_name && renderedProjects.has(script.project_name)).length;
  const hookAngles = scripts.map((script) => scriptHookAngle(script, currentVersions.get(script.id))).filter(Boolean);
  return {
    ugc_scripts: scripts.length,
    script_revisions: visibleVersions.length,
    script_approval_average_hours: averageScriptApprovalHours(scripts, reviewEvents),
    script_to_render_conversion: scripts.length ? Number(((renderedScripts / scripts.length) * 100).toFixed(2)) : 0,
    hook_angle_breakdown: groupedRows(hookAngles, (angle) => angle)
  };
}

async function hostedSupabaseAnalytics(user) {
  const [
    projects,
    renders,
    users,
    campaigns,
    assets,
    clipCandidates,
    marketReports,
    ugcScripts,
    scriptVersions,
    scriptReviewEvents
  ] = await Promise.all([
    restTable("cf_projects", "select=*"),
    restTable("cf_render_jobs", "select=project_name,created_at"),
    restTable("cf_users", "select=id,name"),
    restTable("cf_campaigns", "select=id,name"),
    restTable("cf_assets", "select=project_name,kind"),
    restTable("cf_clip_candidates", "select=project_name"),
    restTable("cf_market_reports", "select=id,campaign_id"),
    restTable("cf_ugc_scripts", "select=id,market_report_id,project_name,campaign_id,selected_hook_id,selected_hook_index,current_version_number,created_at"),
    restTable("cf_ugc_script_versions", "select=id,script_id,version_number,content,created_at"),
    restTable("cf_script_review_events", "select=script_id,to_status,created_at")
  ]);

  const visibleProjects = projects.filter((project) => analyticsProjectVisible(project, user));
  const visibleNames = new Set(visibleProjects.map((project) => project.name));
  const visibleRenders = renders.filter((render) => visibleNames.has(render.project_name));
  const visibleScripts = !user || user.role === "admin"
    ? ugcScripts
    : ugcScripts.filter((script) => visibleNames.has(script.project_name));
  const visibleReportIds = new Set(visibleScripts.map((script) => script.market_report_id).filter(Boolean));
  const visibleReports = !user || user.role === "admin"
    ? marketReports
    : marketReports.filter((report) => visibleReportIds.has(report.id));
  const scriptAnalytics = buildSupabaseScriptAnalytics({
    scripts: visibleScripts,
    versions: scriptVersions,
    reviewEvents: scriptReviewEvents,
    renders: visibleRenders
  });
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
    market_reports: visibleReports.length,
    ...scriptAnalytics,
    monthly_renders: groupedRows(visibleRenders.filter((render) => render.created_at), (render) => String(render.created_at).slice(0, 7))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name: month, count }) => ({ month, count }))
  };
}

export async function supabaseAnalytics(user = null) {
  if (hostedRestMode()) return hostedSupabaseAnalytics(user);
  const { projectWhere, params } = analyticsWhere(user);
  const unrestricted = !user || user.role === "admin";
  const scriptWhere = unrestricted ? "" : "where s.project_name in (select name from visible_projects)";
  const reportWhere = unrestricted ? "" : `where mr.id in (
    select market_report_id from visible_scripts where market_report_id is not null
  )`;
  const result = await getPool().query(`
    with visible_projects as (
      select p.*
      from cf_projects p
      ${projectWhere}
    ),
    visible_scripts as (
      select s.*
      from cf_ugc_scripts s
      ${scriptWhere}
    ),
    visible_reports as (
      select mr.*
      from cf_market_reports mr
      ${reportWhere}
    ),
    current_script_versions as (
      select distinct on (v.script_id)
        v.*,
        s.selected_hook_id,
        s.selected_hook_index
      from visible_scripts s
      join cf_ugc_script_versions v on v.script_id = s.id
      order by
        v.script_id,
        (v.version_number = s.current_version_number) desc,
        v.version_number desc
    ),
    approval_durations as (
      select extract(epoch from (approved.created_at - submitted.created_at)) / 3600.0 as hours
      from visible_scripts s
      join lateral (
        select e.created_at
        from cf_script_review_events e
        where e.script_id = s.id and e.to_status = 'approved'
        order by e.created_at asc
        limit 1
      ) approved on true
      join lateral (
        select e.created_at
        from cf_script_review_events e
        where e.script_id = s.id
          and e.to_status in ('internal-review', 'client-review')
          and e.created_at <= approved.created_at
        order by e.created_at desc
        limit 1
      ) submitted on true
    ),
    script_hook_values as (
      select
        nullif(lower(trim(coalesce(
        v.content ->> 'hookAngle',
        v.content ->> 'hook_angle',
        v.content #>> '{hook,angle}',
        v.content #>> '{selectedHook,angle}',
        selected.hook ->> 'angle',
        selected.hook ->> 'type',
        selected.hook ->> 'label'
      ))), '') as explicit_name,
        lower(trim(coalesce(selected.hook ->> 'text', selected.hook #>> '{}', ''))) as hook_text
      from current_script_versions v
      left join lateral (
        select hook
        from jsonb_array_elements(case
          when jsonb_typeof(v.content -> 'hooks') = 'array' then v.content -> 'hooks'
          else '[]'::jsonb
        end) with ordinality hooks(hook, position)
        order by case
          when v.selected_hook_id is not null and hook ->> 'id' = v.selected_hook_id then 0
          when position = coalesce(v.selected_hook_index, 0) + 1 then 1
          else 2
        end
        limit 1
      ) selected on true
    ),
    script_hook_angles as (
      select case
        when regexp_replace(explicit_name, '[^a-z0-9]+', '-', 'g') in (
          'question', 'demo', 'proof', 'social-proof', 'problem', 'pain-point', 'benefit',
          'story', 'confession', 'before-after', 'other'
        ) then regexp_replace(explicit_name, '[^a-z0-9]+', '-', 'g')
        when coalesce(nullif(hook_text, ''), explicit_name, '') ~ '[?]$'
          or coalesce(nullif(hook_text, ''), explicit_name, '') ~ '^(why|how|what|when|still|did you|have you|are you|do you)([^a-z]|$)' then 'question'
        when coalesce(nullif(hook_text, ''), explicit_name, '') ~ '(^|[^a-z])(demo|watch|show|see this|look at)([^a-z]|$)' then 'demo'
        when coalesce(nullif(hook_text, ''), explicit_name, '') ~ '(^|[^a-z])(proof|tested|result|results|percent)([^a-z]|$)'
          or coalesce(nullif(hook_text, ''), explicit_name, '') ~ '[0-9%]' then 'proof'
        when coalesce(nullif(hook_text, ''), explicit_name, '') ~ '(^|[^a-z])(struggle|problem|pain|slow|mess|wrong|tired|hate|stop|without|wasting)([^a-z]|$)' then 'problem'
        when coalesce(nullif(hook_text, ''), explicit_name, '') ~ '(^|[^a-z])(save|easy|fast|finally|better|improve|benefit)([^a-z]|$)' then 'benefit'
        when coalesce(nullif(hook_text, ''), explicit_name, '') ~ '(^|[^a-z])(confession|story|i|my|we|our)([^a-z]|$)' then 'story'
        when coalesce(nullif(hook_text, ''), explicit_name, '') <> '' then 'other'
        else null
      end as name
      from script_hook_values
    )
    select
      (select count(*)::int from visible_projects) as projects,
      (select count(*)::int from cf_render_jobs r join visible_projects p on p.name = r.project_name) as renders,
      (select count(*)::int from visible_projects where type = 'ai-generator') as ai_projects,
      (select count(*)::int from visible_projects where type = 'auto-clipper') as clipper_projects,
      (select coalesce(jsonb_object_agg(approval_status, count), '{}'::jsonb) from (
        select approval_status, count(*)::int as count
        from visible_projects
        group by approval_status
      ) rows) as approval_breakdown,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select coalesce(u.name, p.assigned_staff_id, 'Unassigned') as name, count(*)::int as count
        from visible_projects p
        left join cf_users u on u.id = p.assigned_staff_id
        group by coalesce(u.name, p.assigned_staff_id, 'Unassigned')
        order by count(*) desc, name asc
      ) rows) as staff_workload,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select coalesce(c.name, 'No campaign') as name, count(*)::int as count
        from visible_projects p
        left join cf_campaigns c on c.id = p.campaign_id
        group by coalesce(c.name, 'No campaign')
        order by count(*) desc, name asc
      ) rows) as campaign_projects,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select coalesce(a.kind, 'unknown') as name, count(*)::int as count
        from cf_assets a
        join visible_projects p on p.name = a.project_name
        group by coalesce(a.kind, 'unknown')
        order by count(*) desc, name asc
      ) rows) as asset_breakdown,
      (select count(*)::int from cf_clip_candidates cc join visible_projects p on p.name = cc.project_name) as clip_candidates,
      (select count(*)::int from visible_reports) as market_reports,
      (select count(*)::int from visible_scripts) as ugc_scripts,
      (select count(*)::int
        from cf_ugc_script_versions v
        join visible_scripts s on s.id = v.script_id
      ) as script_revisions,
      (select coalesce(round(avg(hours)::numeric, 2), 0)::float from approval_durations) as script_approval_average_hours,
      (select coalesce(round(
        count(*) filter (where exists (
          select 1
          from cf_render_jobs r
          join visible_projects p on p.name = r.project_name
          where r.project_name = s.project_name
        ))::numeric * 100 / nullif(count(*), 0),
        2
      ), 0)::float from visible_scripts s) as script_to_render_conversion,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select name, count(*)::int as count
        from script_hook_angles
        where name is not null
        group by name
        order by count(*) desc, name asc
      ) rows) as hook_angle_breakdown,
      (select coalesce(jsonb_agg(row_to_json(rows)), '[]'::jsonb) from (
        select to_char(date_trunc('month', r.created_at), 'YYYY-MM') as month, count(*)::int as count
        from cf_render_jobs r
        join visible_projects p on p.name = r.project_name
        group by date_trunc('month', r.created_at)
        order by month asc
      ) rows) as monthly_renders
  `, params);
  return result.rows[0];
}
