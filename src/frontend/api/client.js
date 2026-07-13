const SESSION_KEY = "contentflow.supabase.session";

let authConfigCache = null;

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

export async function api(path, options = {}) {
  const isBinary = options.body instanceof ArrayBuffer || options.body instanceof Blob;
  const headers = {
    ...(options.body instanceof FormData || isBinary ? {} : { "Content-Type": "application/json" }),
    ...authHeaders(),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

export async function loadAuthConfig() {
  if (authConfigCache) return authConfigCache;
  authConfigCache = await api("/api/auth/config");
  return authConfigCache;
}

export async function loadProfile() {
  const response = await fetch("/api/auth/profile", { headers: authHeaders() });
  if (response.status === 401) return { user: null, required: true };
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Profile failed");
  return data;
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
