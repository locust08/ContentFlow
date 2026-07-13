import assert from "node:assert/strict";
import test from "node:test";
import { supabaseAnalytics } from "../src/services/supabaseDb.js";

test("hosted analytics aggregates Supabase REST rows without a direct database connection", async () => {
  const previous = {
    hosted: process.env.HOSTED_DEMO,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: process.env.SUPABASE_DATABASE_URL
  };
  const originalFetch = global.fetch;

  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.SUPABASE_DATABASE_URL = "postgresql://bad:bad@127.0.0.1:1/bad";

  const rows = {
    cf_projects: [
      { name: "ugc", type: "ai-generator", approval_status: "approved", assigned_staff_id: "editor", campaign_id: "launch", client_id: "brand" },
      { name: "clips", type: "auto-clipper", approval_status: "in-review", assigned_staff_id: "editor", campaign_id: "launch", client_id: "brand", reviewer_id: "reviewer" }
    ],
    cf_render_jobs: [
      { project_name: "ugc", created_at: "2026-07-01T00:00:00.000Z" },
      { project_name: "clips", created_at: "2026-07-02T00:00:00.000Z" }
    ],
    cf_users: [{ id: "editor", name: "Editor" }],
    cf_campaigns: [{ id: "launch", name: "Launch" }],
    cf_assets: [{ project_name: "ugc", kind: "product-image" }],
    cf_clip_candidates: [{ project_name: "clips" }, { project_name: "clips" }]
  };

  global.fetch = async (url) => {
    const table = new URL(url).pathname.split("/").at(-1);
    return new Response(JSON.stringify(rows[table] || []), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const analytics = await supabaseAnalytics({ id: "admin", role: "admin" });
    assert.equal(analytics.projects, 2);
    assert.equal(analytics.renders, 2);
    assert.equal(analytics.ai_projects, 1);
    assert.equal(analytics.clipper_projects, 1);
    assert.equal(analytics.clip_candidates, 2);
    assert.deepEqual(analytics.approval_breakdown, { approved: 1, "in-review": 1 });
    assert.deepEqual(analytics.staff_workload, [{ name: "Editor", count: 2 }]);
    assert.deepEqual(analytics.monthly_renders, [{ month: "2026-07", count: 2 }]);

    const staffAnalytics = await supabaseAnalytics({ id: "editor", role: "staff-editor" });
    assert.equal(staffAnalytics.projects, 2);
    const clientAnalytics = await supabaseAnalytics({ id: "reviewer", role: "manager-client", clientId: "brand" });
    assert.equal(clientAnalytics.projects, 2);
    const hiddenAnalytics = await supabaseAnalytics({ id: "other", role: "manager-client", clientId: "other" });
    assert.equal(hiddenAnalytics.projects, 0);
  } finally {
    global.fetch = originalFetch;
    process.env.HOSTED_DEMO = previous.hosted;
    process.env.SUPABASE_URL = previous.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
    process.env.SUPABASE_DATABASE_URL = previous.databaseUrl;
  }
});
