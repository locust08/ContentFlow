function clean(value) {
  return String(value || "").trim();
}
function publicUrl(env) {
  const value = clean(env.SUPABASE_URL);
  if (value.startsWith("http")) return value.replace(/\/$/, "");
  return /^[a-z0-9]{15,}$/i.test(value) ? `https://${value}.supabase.co` : "";
}

function bearer(request) {
  const match = clean(request.headers.get("authorization")).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function createAuth(env, repository) {
  const config = () => ({
    enabled: Boolean(publicUrl(env) && clean(env.SUPABASE_ANON_KEY)),
    required: clean(env.REQUIRE_AUTH) !== "false",
    hostedDemo: true,
    supabaseUrl: publicUrl(env),
    supabaseAnonKey: clean(env.SUPABASE_ANON_KEY)
  });

  return {
    config,
    async user(request) {
      const token = bearer(request);
      if (!token || !config().enabled) return null;
      const response = await fetch(`${config().supabaseUrl}/auth/v1/user`, {
        headers: { apikey: config().supabaseAnonKey, authorization: `Bearer ${token}` }
      });
      if (!response.ok) return null;
      const authUser = await response.json();
      if (!authUser?.id && !authUser?.email) return null;
      return repository.findUser({ authUserId: authUser.id, email: authUser.email });
    }
  };
}
