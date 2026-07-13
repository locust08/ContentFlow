import { loadEnv } from "../config.js";
import { readOrganization } from "../services/organization.js";
import {
  initializeSupabaseSchema,
  upsertSupabaseCampaign,
  upsertSupabaseClient,
  upsertSupabaseUser
} from "../services/supabaseDb.js";
import { normalizeRole } from "../services/access.js";

loadEnv();

function envValue(key) {
  return String(process.env[key] || "").trim();
}

function supabaseUrl() {
  const raw = envValue("SUPABASE_URL");
  if (raw.startsWith("http")) return raw.replace(/\/$/, "");
  if (/^[a-z0-9]{15,}$/i.test(raw)) return `https://${raw}.supabase.co`;
  return "";
}

function serviceHeaders() {
  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl() || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };
}

async function requestSupabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl()}${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error || text || "Supabase request failed";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function findAuthUserByEmail(email) {
  const data = await requestSupabase("/auth/v1/admin/users?page=1&per_page=100", { method: "GET" });
  return (data?.users || []).find((user) => String(user.email || "").toLowerCase() === String(email).toLowerCase()) || null;
}

async function createOrUpdateAuthUser(person, password) {
  const email = String(person.email || "").trim().toLowerCase();
  if (!email) throw new Error(`Missing email for ${person.id}.`);
  const payload = {
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: person.name,
      role: normalizeRole(person.role)
    }
  };

  try {
    return await requestSupabase("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (![400, 422].includes(error.status)) throw error;
    const existing = await findAuthUserByEmail(email);
    if (!existing?.id) throw error;
    return requestSupabase(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }
}

async function ensureStorageBucket() {
  const bucket = envValue("SUPABASE_STORAGE_BUCKET") || "contentflow-media";
  try {
    await requestSupabase("/storage/v1/bucket", {
      method: "POST",
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: true,
        file_size_limit: 524288000
      })
    });
    return { bucket, created: true };
  } catch (error) {
    if (![400, 409].includes(error.status)) throw error;
    await requestSupabase(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: "PUT",
      body: JSON.stringify({
        public: true,
        file_size_limit: 524288000
      })
    }).catch(() => null);
    return { bucket, created: false };
  }
}

async function main() {
  const password = envValue("DEMO_USER_PASSWORD") || "ContentFlowDemo2026!";
  const organization = readOrganization();

  await initializeSupabaseSchema();

  for (const client of organization.clients) {
    await upsertSupabaseClient(client);
  }
  for (const campaign of organization.campaigns) {
    await upsertSupabaseCampaign(campaign);
  }

  const seeded = [];
  for (const person of organization.staff) {
    const authUser = await createOrUpdateAuthUser(person, password);
    const user = await upsertSupabaseUser({
      ...person,
      role: normalizeRole(person.role),
      authUserId: authUser.id,
      clientId: person.clientId || (normalizeRole(person.role) === "manager-client" ? "digital-bee" : "")
    });
    seeded.push({ email: person.email, role: user.role, id: user.id });
  }

  const bucket = await ensureStorageBucket();
  console.log(JSON.stringify({
    ok: true,
    users: seeded,
    bucket,
    passwordSource: envValue("DEMO_USER_PASSWORD") ? "DEMO_USER_PASSWORD" : "default"
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
