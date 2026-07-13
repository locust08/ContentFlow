import { readOrganization } from "./organization.js";
import { normalizeRole } from "./access.js";
import { findSupabaseUserProfile } from "./supabaseDb.js";

function envValue(key) {
  return String(process.env[key] || "").trim();
}

function supabaseRef() {
  const raw = envValue("SUPABASE_URL");
  if (/^[a-z0-9]{15,}$/i.test(raw) && !raw.includes(".")) return raw;
  try {
    return new URL(raw).hostname.split(".")[0];
  } catch {
    return "";
  }
}

export function supabasePublicUrl() {
  const raw = envValue("SUPABASE_URL");
  if (raw.startsWith("http")) return raw.replace(/\/$/, "");
  const ref = supabaseRef();
  return ref ? `https://${ref}.supabase.co` : "";
}

export function authRequired() {
  return envValue("REQUIRE_AUTH") === "true" || envValue("HOSTED_DEMO") === "true";
}

export function hostedDemoMode() {
  return envValue("HOSTED_DEMO") === "true";
}

export function authConfig() {
  return {
    enabled: Boolean(supabasePublicUrl() && envValue("SUPABASE_ANON_KEY")),
    required: authRequired(),
    hostedDemo: hostedDemoMode(),
    supabaseUrl: supabasePublicUrl(),
    supabaseAnonKey: envValue("SUPABASE_ANON_KEY")
  };
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function fetchSupabaseUser(token) {
  const config = authConfig();
  if (!token || !config.enabled) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function profileFromAuthUser(authUser) {
  if (!authUser?.email) return null;
  const supabaseProfile = await findSupabaseUserProfile({
    authUserId: authUser.id,
    email: authUser.email
  });
  if (supabaseProfile) {
    return {
      id: supabaseProfile.id,
      authUserId: supabaseProfile.authUserId || authUser.id,
      email: supabaseProfile.email || authUser.email,
      name: supabaseProfile.name,
      role: normalizeRole(supabaseProfile.role),
      clientId: supabaseProfile.clientId || "",
      source: "supabase"
    };
  }

  const organization = readOrganization();
  const email = String(authUser.email || "").toLowerCase();
  const staff = organization.staff.find((person) => String(person.email || "").toLowerCase() === email);
  if (staff) {
    return {
      id: staff.id,
      authUserId: authUser.id,
      email: authUser.email,
      name: staff.name,
      role: normalizeRole(staff.role),
      clientId: staff.clientId || "",
      source: "organization"
    };
  }
  return {
    id: authUser.id,
    authUserId: authUser.id,
    email: authUser.email,
    name: authUser.user_metadata?.name || authUser.email,
    role: "staff-editor",
    clientId: "",
    source: "auth"
  };
}

export async function getRequestUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return profileFromAuthUser(await fetchSupabaseUser(token));
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId || ""
  };
}
