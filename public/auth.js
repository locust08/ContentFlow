const SESSION_KEY = "contentflow.supabase.session";

let configCache = null;

export function storedSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function authHeaders() {
  const token = storedSession()?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadAuthConfig() {
  if (configCache) return configCache;
  const response = await fetch("/api/auth/config");
  configCache = await response.json();
  return configCache;
}

export async function signIn(email, password) {
  const config = await loadAuthConfig();
  if (!config.enabled) throw new Error("Supabase Auth is not configured.");
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.msg || data.error || "Login failed");
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  return data;
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

export async function loadProfile() {
  const response = await fetch("/api/auth/profile", { headers: authHeaders() });
  if (response.status === 401) return { user: null, required: true };
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Profile failed");
  return data;
}
