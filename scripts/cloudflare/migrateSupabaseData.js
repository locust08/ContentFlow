import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const jsonDefaults = new Map([
  ["metadata", {}], ["payload", {}], ["result", {}], ["brief", {}],
  ["passages", []], ["report", {}], ["scriptwriter_input", {}], ["content", {}]
]);

export const tablePlan = [
  { name: "cf_clients", key: "id", columns: ["id", "name", "industry", "contact", "created_at", "updated_at"] },
  { name: "cf_users", key: "id", columns: ["id", "auth_user_id", "name", "role", "email", "client_id", "created_at", "updated_at"] },
  { name: "cf_campaigns", key: "id", columns: ["id", "client_id", "name", "objective", "status", "created_at", "updated_at"] },
  { name: "cf_folders", key: "id", local: true, columns: ["id", "name", "created_by", "created_at", "updated_at"] },
  { name: "cf_projects", key: "name", columns: ["name", "type", "folder_id", "client_id", "campaign_id", "assigned_staff_id", "reviewer_id", "priority", "approval_status", "approval_feedback", "local_path", "created_at", "updated_at"] },
  { name: "cf_assets", key: "id", columns: ["id", "project_name", "kind", "name", "media_type", "local_path", "url", "created_at"] },
  { name: "cf_clip_candidates", key: "id", columns: ["id", "project_name", "title", "start_seconds", "end_seconds", "score", "reason", "created_at"] },
  { name: "cf_render_jobs", key: "id", columns: ["id", "project_name", "mode", "status", "output_path", "output_url", "render_type", "highlight_id", "reaction_id", "created_at"] },
  { name: "cf_approval_events", key: "id", columns: ["id", "project_name", "status", "feedback", "created_at"] },
  { name: "cf_analytics_events", key: "id", columns: ["id", "event_type", "project_name", "metadata", "created_at"] },
  { name: "cf_production_jobs", key: "id", columns: ["id", "project_name", "job_type", "status", "payload", "requested_by", "output_url", "result", "error", "created_at", "started_at", "completed_at", "updated_at"] },
  { name: "cf_campaign_briefs", key: "id", columns: ["id", "campaign_id", "title", "product_name", "objective", "target_audience", "brief", "status", "created_by", "created_at", "updated_at"] },
  { name: "cf_research_sources", key: "id", columns: ["id", "brief_id", "source_type", "name", "content", "passages", "metadata", "local_path", "created_by", "created_at"] },
  { name: "cf_market_reports", key: "id", columns: ["id", "brief_id", "campaign_id", "status", "source", "report", "scriptwriter_input", "created_by", "created_at", "updated_at"] },
  { name: "cf_ugc_scripts", key: "id", columns: ["id", "market_report_id", "campaign_id", "project_name", "title", "status", "selected_hook_id", "selected_hook_index", "current_version_number", "created_by", "updated_by", "created_at", "updated_at"] },
  { name: "cf_ugc_script_versions", key: "id", columns: ["id", "script_id", "version_number", "content", "change_note", "created_by", "created_at"] },
  { name: "cf_script_review_events", key: "id", columns: ["id", "script_id", "version_id", "from_status", "to_status", "feedback", "actor_id", "override_reason", "created_at"] }
];

export function normalizeSupabaseUrl(value) {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return raw ? `https://${raw}.supabase.co` : "";
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function hydrateAuthUserIds(rows = [], authUsers = []) {
  const byEmail = new Map();
  for (const user of authUsers) {
    const email = normalizedEmail(user?.email);
    if (!email || !user?.id) continue;
    if (byEmail.has(email) && byEmail.get(email) !== user.id) {
      throw new Error(`Supabase Auth returned duplicate identities for ${email}`);
    }
    byEmail.set(email, user.id);
  }
  const unresolved = [];
  const hydrated = rows.map((row) => {
    const email = normalizedEmail(row.email);
    const authUserId = byEmail.get(email);
    if (!email || !authUserId) unresolved.push(email || row.id || "unknown-user");
    return { ...row, auth_user_id: authUserId || null };
  });
  if (unresolved.length) {
    throw new Error(`Auth preflight failed; unresolved Supabase Auth users: ${unresolved.join(", ")}`);
  }
  return hydrated;
}

export async function fetchSupabaseAuthUsers({ baseUrl, serviceKey, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` }
  });
  if (!response.ok) throw new Error(`Supabase Auth user export failed (${response.status})`);
  const data = await response.json();
  const users = Array.isArray(data) ? data : data?.users;
  if (!Array.isArray(users)) throw new Error("Supabase Auth user export returned an invalid response");
  if (users.length >= 1000) throw new Error("Supabase Auth user export reached its 1000-user safety limit");
  return users;
}

function valueFor(plan, column, row, context) {
  if (plan.name === "cf_production_jobs" && column === "status" && row[column] === "cancelled") return "failed";
  if (jsonDefaults.has(column)) {
    const value = row[column] ?? jsonDefaults.get(column);
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return row[column] ?? null;
}

export function validateFolderReferences(projectRows, folderIds) {
  const unresolved = (projectRows || [])
    .filter((project) => project.folder_id && !folderIds.has(project.folder_id))
    .map((project) => `${project.name} -> ${project.folder_id}`);
  if (unresolved.length) {
    throw new Error(`Folder preflight failed; unresolved project references: ${unresolved.join(", ")}`);
  }
}

export function buildInsert(plan, row, context = {}) {
  const columns = plan.columns;
  const updates = columns.filter((column) => column !== plan.key).map((column) => `${column} = excluded.${column}`);
  return {
    sql: `INSERT INTO ${plan.name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT (${plan.key}) DO UPDATE SET ${updates.join(", ")}`,
    params: columns.map((column) => valueFor(plan, column, row, context))
  };
}

function parseEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

export function parseContentRange(value) {
  const match = String(value || "").trim().match(/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/);
  if (!match) return null;
  return {
    start: match[1] === undefined ? null : Number(match[1]),
    end: match[2] === undefined ? null : Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3])
  };
}

function exactCount(response, contentRange) {
  if (contentRange?.total !== null && contentRange?.total !== undefined) return contentRange.total;
  const value = response.headers?.get?.("x-total-count");
  return /^\d+$/.test(String(value || "")) ? Number(value) : null;
}

export async function fetchSupabaseRows({ baseUrl, serviceKey, table, key, fetchImpl = globalThis.fetch }) {
  const rows = [];
  let sourceTotal = null;
  let start = 0;

  while (sourceTotal === null || rows.length < sourceTotal) {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    url.searchParams.set("order", `${key}.asc`);
    const response = await fetchImpl(url.toString(), {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        prefer: "count=exact",
        range: `${start}-${start + 999}`
      }
    });
    if (!response.ok) throw new Error(`Supabase ${table} export failed (${response.status})`);
    const page = await response.json();
    const contentRange = parseContentRange(response.headers?.get?.("content-range"));
    const reportedTotal = exactCount(response, contentRange);
    if (reportedTotal === null) throw new Error(`Supabase ${table} export did not return an exact source total`);
    if (sourceTotal === null) sourceTotal = reportedTotal;
    else if (reportedTotal !== sourceTotal) {
      throw new Error(`Supabase ${table} export total changed from ${sourceTotal} to ${reportedTotal}`);
    }
    if (page.length === 0 && rows.length < sourceTotal) {
      throw new Error(`Supabase ${table} export stalled after ${rows.length} of ${sourceTotal} rows`);
    }
    if (contentRange?.start !== null && contentRange?.start !== undefined) {
      const rangeLength = contentRange.end - contentRange.start + 1;
      if (contentRange.start !== start || rangeLength !== page.length) {
        throw new Error(`Supabase ${table} export returned an inconsistent Content-Range`);
      }
    }
    rows.push(...page);
    if (rows.length > sourceTotal) {
      throw new Error(`Supabase ${table} export exceeded its source total of ${sourceTotal}`);
    }
    if (rows.length === sourceTotal) return rows;

    const nextStart = contentRange?.end === null || contentRange?.end === undefined
      ? start + page.length
      : contentRange.end + 1;
    if (nextStart <= start) {
      throw new Error(`Supabase ${table} export stalled after ${rows.length} of ${sourceTotal} rows`);
    }
    start = nextStart;
  }

  return rows;
}

function loadFolders(projectsDir) {
  const file = path.join(projectsDir, "folders.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return (parsed.folders || []).map((folder) => ({
    id: folder.id,
    name: folder.name,
    created_by: null,
    created_at: folder.createdAt || new Date().toISOString(),
    updated_at: folder.updatedAt || folder.createdAt || new Date().toISOString()
  }));
}

export function loadClipSelections(projectsDir) {
  if (!projectsDir || !fs.existsSync(projectsDir)) return [];
  const selections = [];
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(projectsDir, entry.name, "clipper", "generated", "selected-highlight.json");
    if (!fs.existsSync(file)) continue;
    try {
      const selected = JSON.parse(fs.readFileSync(file, "utf8"));
      const highlightId = String(selected?.id || "").trim();
      if (highlightId) selections.push({ projectName: entry.name, highlightId });
    } catch {
      throw new Error(`Invalid clip selection manifest for ${entry.name}`);
    }
  }
  return selections;
}

export function buildSelectionQueries(selections) {
  return (selections || []).map(({ projectName, highlightId }) => ({
    sql: `UPDATE cf_clip_candidates
      SET selected = CASE WHEN id = ? OR id = ? THEN 1 ELSE 0 END
      WHERE project_name = ?`,
    params: [highlightId, `${projectName}:${highlightId}`, projectName]
  }));
}

async function d1Batch({ accountId, databaseId, apiToken, batch }) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({ batch })
  });
  const result = await response.json();
  if (!response.ok || !result.success || result.result?.some((entry) => entry.success === false)) {
    throw new Error(`D1 import batch failed (${response.status}): ${result.errors?.[0]?.message || "unknown error"}`);
  }
}

export function resolveWranglerDatabaseId(config, environment) {
  const environmentConfig = environment === "production"
    ? config
    : config.env?.[environment];
  const databases = environmentConfig?.d1_databases;
  return databases?.find((database) => database.binding === "DB")?.database_id || "";
}

function databaseIdFromWrangler(environment, cwd) {
  const config = JSON.parse(fs.readFileSync(path.join(cwd, "wrangler.jsonc"), "utf8"));
  return resolveWranglerDatabaseId(config, environment);
}

export async function migrateSupabaseData(options) {
  const context = { folderIds: new Set() };
  const counts = {};
  const rowsByTable = new Map();
  for (const plan of tablePlan) {
    const rows = plan.local
      ? loadFolders(options.projectsDir)
      : await fetchSupabaseRows({ baseUrl: options.supabaseUrl, serviceKey: options.supabaseServiceKey, table: plan.name, key: plan.key });
    if (plan.name === "cf_folders") for (const row of rows) context.folderIds.add(row.id);
    counts[plan.name] = rows.length;
    rowsByTable.set(plan.name, rows);
  }

  const userRows = rowsByTable.get("cf_users") || [];
  if (userRows.length) {
    const authUsers = options.authUsers || await fetchSupabaseAuthUsers({
      baseUrl: options.supabaseUrl,
      serviceKey: options.supabaseServiceKey,
      fetchImpl: options.fetchImpl || globalThis.fetch
    });
    rowsByTable.set("cf_users", hydrateAuthUserIds(userRows, authUsers));
  }

  validateFolderReferences(rowsByTable.get("cf_projects"), context.folderIds);
  if (options.dryRun) return counts;

  for (const plan of tablePlan) {
    const rows = rowsByTable.get(plan.name) || [];
    if (!rows.length) continue;
    for (let index = 0; index < rows.length; index += 50) {
      const batch = rows.slice(index, index + 50).map((row) => buildInsert(plan, row, context));
      await d1Batch({ ...options, batch });
    }
  }
  const selections = buildSelectionQueries(loadClipSelections(options.projectsDir));
  for (let index = 0; index < selections.length; index += 50) {
    await d1Batch({ ...options, batch: selections.slice(index, index + 50) });
  }
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const envFile = path.resolve(args["env-file"] || path.join(cwd, ".env"));
  const env = { ...parseEnv(envFile), ...process.env };
  const environment = String(args.environment || "preview");
  const databaseId = String(args["database-id"] || databaseIdFromWrangler(environment, cwd));
  const projectsDir = path.resolve(args["projects-dir"] || env.CONTENTFLOW_PROJECTS_DIR || path.join(cwd, "projects"));
  const required = {
    supabaseUrl: normalizeSupabaseUrl(env.SUPABASE_URL),
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    databaseId
  };
  for (const [key, value] of Object.entries(required)) if (!value) throw new Error(`Missing migration setting: ${key}`);
  const counts = await migrateSupabaseData({ ...required, projectsDir, dryRun: Boolean(args["dry-run"]) });
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count}`);
  console.log(args["dry-run"] ? "Dry run complete." : "D1 migration complete.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
