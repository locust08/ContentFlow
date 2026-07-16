import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildSupabaseProjectData,
  mapSupabaseCampaignBriefRow,
  mapSupabaseMarketReportRow,
  mapSupabaseResearchSourceRow,
  mapSupabaseScriptReviewEventRow,
  mapSupabaseUgcScriptRow,
  mapSupabaseUgcScriptVersionRow,
  recordSupabaseScriptReviewEvent,
  deleteSupabaseResearchSource,
  supabaseAnalytics,
  supabaseCampaignIntelligence,
  supabaseProjectScriptBundle,
  upsertSupabaseCampaignBrief,
  upsertSupabaseMarketReport,
  upsertSupabaseResearchSource,
  upsertSupabaseUgcScript,
  upsertSupabaseUgcScriptVersion
} from "../src/services/supabaseDb.js";

function withHostedSupabase(run) {
  const previous = {
    hosted: process.env.HOSTED_DEMO,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: process.env.SUPABASE_DATABASE_URL
  };
  process.env.HOSTED_DEMO = "true";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.SUPABASE_DATABASE_URL = "postgresql://bad:bad@127.0.0.1:1/bad";
  return Promise.resolve()
    .then(run)
    .finally(() => {
      process.env.HOSTED_DEMO = previous.hosted;
      process.env.SUPABASE_URL = previous.url;
      process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
      process.env.SUPABASE_DATABASE_URL = previous.databaseUrl;
    });
}

test("maps intelligence and script rows to camelCase domain objects", () => {
  assert.deepEqual(mapSupabaseCampaignBriefRow({
    id: "brief-1", campaign_id: "campaign-1", title: "Launch", product_name: "Serum",
    target_audience: "Busy parents", brief: { brand: "Glow Co", offer: "20% off", brandVoice: "Warm" }, created_by: "author",
    created_at: "created", updated_at: "updated"
  }), {
    brand: "Glow Co", offer: "20% off", brandVoice: "Warm",
    id: "brief-1", campaignId: "campaign-1", title: "Launch", productName: "Serum", product: "Serum",
    objective: "", targetAudience: "Busy parents", brief: { brand: "Glow Co", offer: "20% off", brandVoice: "Warm" }, status: "draft",
    createdBy: "author", createdAt: "created", updatedAt: "updated"
  });

  assert.deepEqual(mapSupabaseResearchSourceRow({
    id: "source-1", brief_id: "brief-1", source_type: "txt", name: "reviews.txt",
    content: "Easy setup", passages: ["Easy setup"], metadata: { rating: 5 }, local_path: "research/reviews.txt",
    created_by: "author", created_at: "created"
  }), {
    id: "source-1", briefId: "brief-1", type: "txt", name: "reviews.txt", content: "Easy setup",
    passages: ["Easy setup"], metadata: { rating: 5 }, localPath: "research/reviews.txt",
    createdBy: "author", createdAt: "created"
  });

  const report = mapSupabaseMarketReportRow({
    id: "report-1", brief_id: "brief-1", campaign_id: "campaign-1", status: "ready", source: "openai",
    report: { pillars: { features: [] }, audienceProfile: { primaryAudience: "Teams" } },
    scriptwriter_input: { evidenceRules: ["Cite sources"] }, created_by: "author",
    created_at: "created", updated_at: "updated"
  });
  assert.equal(report.campaignId, "campaign-1");
  assert.deepEqual(report.pillars, { features: [] });
  assert.deepEqual(report.scriptwriterInput, { evidenceRules: ["Cite sources"] });

  assert.deepEqual(mapSupabaseUgcScriptRow({
    id: "script-1", market_report_id: "report-1", campaign_id: "campaign-1", project_name: "launch",
    title: "Launch script", status: "client-review", selected_hook_id: "hook-2", selected_hook_index: 1, current_version_number: 2,
    created_by: "author", updated_by: "editor", created_at: "created", updated_at: "updated"
  }), {
    id: "script-1", marketReportId: "report-1", campaignId: "campaign-1", projectName: "launch",
    title: "Launch script", status: "client-review", selectedHookId: "hook-2", selectedHookIndex: 1, currentVersionNumber: 2,
    createdBy: "author", updatedBy: "editor", createdAt: "created", updatedAt: "updated"
  });

  const version = mapSupabaseUgcScriptVersionRow({
    id: "version-2", script_id: "script-1", version_number: 2,
    content: { hooks: [{ angle: "confession", text: "I was wrong" }], analysis: { score: 92 } },
    change_note: "Stronger hook", created_by: "editor", created_at: "created"
  });
  assert.equal(version.scriptId, "script-1");
  assert.equal(version.number, 2);
  assert.equal(version.hooks[0].angle, "confession");
  assert.deepEqual(version.content.analysis, { score: 92 });

  assert.deepEqual(mapSupabaseScriptReviewEventRow({
    id: "event-1", script_id: "script-1", version_id: "version-2", from_status: "client-review",
    to_status: "approved", feedback: "Ship it", actor_id: "reviewer", override_reason: null, created_at: "created"
  }), {
    id: "event-1", scriptId: "script-1", versionId: "version-2", fromStatus: "client-review",
    toStatus: "approved", status: "approved", feedback: "Ship it", actorId: "reviewer", overrideReason: "", createdAt: "created"
  });
});

test("hosted persistence writes schema-shaped rows and returns domain objects", async () => {
  await withHostedSupabase(async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, init = {}) => {
      const parsed = new URL(url);
      const table = parsed.pathname.split("/").at(-1);
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ table, method: init.method || "GET", query: parsed.search, body });
      if ((init.method || "GET") === "DELETE") return new Response(null, { status: 204 });
      const persistedId = parsed.searchParams.get("id")?.replace(/^eq\./, "");
      return new Response(JSON.stringify([{ ...(persistedId ? { id: persistedId } : {}), ...body, created_at: "created", updated_at: "updated" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const brief = await upsertSupabaseCampaignBrief({
        id: "brief-1", campaignId: "campaign-1", title: "Launch", productName: "Serum",
        targetAudience: "Busy parents", brief: { offer: "20% off" }
      });
      const source = await upsertSupabaseResearchSource({
        id: "source-1", briefId: "brief-1", type: "txt", name: "reviews.txt", content: "Easy setup",
        passages: ["Easy setup"]
      });
      const report = await upsertSupabaseMarketReport({
        id: "report-text-id", briefId: "brief-1", campaignId: "campaign-1", status: "approved", source: "openai",
        pillars: { features: [] }, scriptwriterInput: { evidenceRules: [] }
      });
      const script = await upsertSupabaseUgcScript({
        id: "script-1", marketReportId: "report-1", campaignId: "campaign-1", projectName: "launch",
        title: "Launch script", selectedHookId: "hook-1", selectedHookIndex: 0, currentVersionNumber: 0
      });
      const version = await upsertSupabaseUgcScriptVersion({
        id: "version-1", scriptId: "script-1", versionNumber: 1,
        content: { hooks: [{ angle: "demo", text: "Watch this" }] }
      });
      const event = await recordSupabaseScriptReviewEvent({
        scriptId: "script-1", versionId: "version-1", fromStatus: "draft", toStatus: "internal-review"
      });
      await deleteSupabaseResearchSource("source-1");

      assert.equal(brief.campaignId, "campaign-1");
      assert.equal(source.briefId, "brief-1");
      assert.deepEqual(report.pillars, { features: [] });
      assert.equal(report.id, "report-text-id");
      assert.equal(report.status, "approved");
      assert.equal(script.projectName, "launch");
      assert.equal(version.versionNumber, 1);
      assert.equal(event.toStatus, "internal-review");
      assert.deepEqual(requests.map(({ table, method }) => [table, method]), [
        ["cf_campaign_briefs", "PATCH"], ["cf_research_sources", "PATCH"], ["cf_market_reports", "PATCH"],
        ["cf_ugc_scripts", "PATCH"], ["cf_ugc_script_versions", "PATCH"], ["cf_script_review_events", "POST"],
        ["cf_research_sources", "DELETE"]
      ]);
      assert.equal(requests[2].body.report.pillars.features.length, 0);
      assert.equal(requests[2].body.status, "approved");
      assert.equal(requests[3].body.selected_hook_id, "hook-1");
      assert.equal(requests[3].body.current_version_number, 0);
      for (const request of requests.slice(0, 5)) {
        assert.equal(Object.hasOwn(request.body, "created_at"), false);
        assert.equal(Object.hasOwn(request.body, "created_by"), false);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("hosted campaign and project reads enforce role visibility, approval, pairing, and redaction", async () => {
  await withHostedSupabase(async () => {
    const originalFetch = global.fetch;
    const rows = {
      cf_projects: [
        { name: "launch", campaign_id: "campaign-1", assigned_staff_id: "editor", client_id: "brand", reviewer_id: "reviewer" },
        { name: "sibling", campaign_id: "campaign-1", assigned_staff_id: "other", client_id: "brand", reviewer_id: "reviewer" }
      ],
      cf_campaign_briefs: [
        { id: "brief-new", campaign_id: "campaign-1", title: "New revision", brief: { revision: 2 }, updated_at: "2026-07-03" },
        { id: "brief-approved", campaign_id: "campaign-1", title: "Approved revision", brief: { revision: 1 }, updated_at: "2026-07-01" }
      ],
      cf_research_sources: [
        { id: "source-new", brief_id: "brief-new", source_type: "text", name: "New notes", content: "Internal proof", passages: ["Internal proof"] },
        { id: "source-approved", brief_id: "brief-approved", source_type: "text", name: "Approved notes", content: "Approved proof", passages: ["Approved proof"] }
      ],
      cf_market_reports: [
        { id: "report-new", brief_id: "brief-new", campaign_id: "campaign-1", status: "ready", report: { pillars: { features: [{ insight: "Internal" }] } }, scriptwriter_input: {}, updated_at: "2026-07-03" },
        { id: "report-approved", brief_id: "brief-approved", campaign_id: "campaign-1", status: "approved", report: { pillars: { features: [{ insight: "Approved" }] }, approvedBy: "admin-1" }, scriptwriter_input: {}, created_by: "admin-1", updated_at: "2026-07-02" }
      ],
      cf_ugc_scripts: [
        { id: "script-draft", market_report_id: "report-new", campaign_id: "campaign-1", project_name: "launch", title: "Draft", status: "client-review", selected_hook_id: "hook-2", selected_hook_index: 1, current_version_number: 3, created_by: "author", updated_by: "editor", updated_at: "2026-07-03" },
        { id: "script-approved", market_report_id: "report-approved", campaign_id: "campaign-1", project_name: "launch", title: "Approved", status: "approved", selected_hook_id: "hook-2", selected_hook_index: 1, current_version_number: 2, created_by: "author", updated_by: "editor", updated_at: "2026-07-02" },
        { id: "script-sibling", market_report_id: "report-approved", campaign_id: "campaign-1", project_name: "sibling", title: "Sibling", status: "approved", current_version_number: 1, updated_at: "2026-07-04" }
      ],
      cf_ugc_script_versions: [
        { id: "version-draft", script_id: "script-draft", version_number: 3, content: { hooks: [{ id: "hook-1", text: "Internal hook" }], transcriptAnalysis: { score: 72 } } },
        { id: "version-1", script_id: "script-approved", version_number: 1, content: { hooks: [{ id: "hook-old", text: "Old internal hook" }] }, change_note: "Internal revision" },
        { id: "version-2", script_id: "script-approved", version_number: 2, content: { hooks: [{ id: "hook-1", text: "Demo hook" }, { id: "hook-2", text: "Approved hook?" }], transcriptAnalysis: { score: 95 }, overrideReason: "Rush", feedback: "Internal rewrite note" } },
        { id: "version-sibling", script_id: "script-sibling", version_number: 1, content: { hooks: [{ id: "hook-1", text: "Sibling secret" }] } }
      ],
      cf_script_review_events: [
        { id: "event-1", script_id: "script-approved", version_id: "version-2", from_status: "client-review", to_status: "approved", feedback: "Internal legal note", actor_id: "admin-1", override_reason: "Rush", created_at: "2026-07-02" }
      ]
    };
    global.fetch = async (url) => {
      const parsed = new URL(url);
      const table = parsed.pathname.split("/").at(-1);
      let data = [...(rows[table] || [])];
      for (const key of ["campaign_id", "brief_id", "project_name", "script_id", "name", "id"]) {
        const filter = parsed.searchParams.get(key);
        if (filter?.startsWith("eq.")) data = data.filter((row) => String(row[key]) === decodeURIComponent(filter.slice(3)));
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    try {
      const staff = { id: "editor", role: "staff-editor" };
      const client = { id: "reviewer", role: "manager-client", clientId: "brand" };
      const staffIntelligence = await supabaseCampaignIntelligence("campaign-1", { user: staff });
      assert.equal(staffIntelligence.campaignBrief.id, "brief-new");
      assert.equal(staffIntelligence.marketReport.id, "report-new");
      assert.deepEqual(staffIntelligence.researchSources.map((source) => source.id), ["source-new"]);

      const clientIntelligence = await supabaseCampaignIntelligence("campaign-1", { user: client });
      assert.equal(clientIntelligence.campaignBrief.id, "brief-approved");
      assert.equal(clientIntelligence.marketReport.id, "report-approved");
      assert.equal(clientIntelligence.marketReport.status, "approved");
      assert.equal(clientIntelligence.marketReport.createdBy, "");
      assert.equal(clientIntelligence.marketReport.approvedBy, "");
      assert.equal(clientIntelligence.marketReport.report.approvedBy, "");
      assert.deepEqual(clientIntelligence.researchSources, []);

      const staffBundle = await supabaseProjectScriptBundle("launch", { user: staff });
      assert.equal(staffBundle.ugcScript.id, "script-draft");
      assert.deepEqual(staffBundle.scriptAnalysis, { score: 72 });
      assert.equal(staffBundle.scriptVersions[0].number, 3);

      const clientBundle = await supabaseProjectScriptBundle("launch", { user: client });
      assert.equal(clientBundle.ugcScript.id, "script-approved");
      assert.equal(clientBundle.ugcScript.status, "approved");
      assert.equal(clientBundle.ugcScript.hooks[1].text, "Approved hook?");
      assert.equal(clientBundle.ugcScript.createdBy, "");
      assert.equal(clientBundle.ugcScript.overrideReason, undefined);
      assert.equal(clientBundle.ugcScript.feedback, undefined);
      assert.equal(clientBundle.scriptAnalysis, null);
      assert.deepEqual(clientBundle.scriptVersions, []);
      assert.equal(clientBundle.scriptReviewEvents[0].status, "approved");
      assert.equal(clientBundle.scriptReviewEvents[0].actorId, "");
      assert.equal(clientBundle.scriptReviewEvents[0].feedback, "");
      assert.equal(clientBundle.scriptReviewEvents[0].overrideReason, "");

      assert.deepEqual(
        await supabaseProjectScriptBundle("launch", { user: { id: "other", role: "staff-editor" } }),
        { ugcScript: null, scriptAnalysis: null, scriptVersions: [], scriptReviewEvents: [] }
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("project data exposes intelligence and script files", () => {
  const data = buildSupabaseProjectData({
    summary: { name: "launch" }, organization: { clients: [], campaigns: [], staff: [] },
    assets: [], renders: [], candidates: [],
    intelligence: { marketReport: { id: "report-1", pillars: {} } },
    scriptBundle: {
      ugcScript: { id: "script-1", hooks: [] }, scriptAnalysis: { score: 90 },
      scriptVersions: [{ id: "version-1" }], scriptReviewEvents: [{ id: "event-1" }]
    }
  });

  assert.equal(data.files.marketReport.id, "report-1");
  assert.equal(data.files.ugcScript.id, "script-1");
  assert.deepEqual(data.files.scriptAnalysis, { score: 90 });
  assert.equal(data.scriptVersions.length, 1);
  assert.equal(data.scriptReviewEvents.length, 1);
  assert.equal(Object.hasOwn(data.files, "scriptVersions"), false);
});

test("hosted analytics includes empty-safe market and script metrics", async () => {
  await withHostedSupabase(async () => {
    const originalFetch = global.fetch;
    const rows = {
      cf_projects: [
        { name: "launch", type: "ai-generator", campaign_id: "campaign-1", assigned_staff_id: "editor", approval_status: "draft" },
        { name: "sibling", type: "ai-generator", campaign_id: "campaign-1", assigned_staff_id: "other", approval_status: "draft" }
      ],
      cf_render_jobs: [{ project_name: "launch", created_at: "2026-07-03" }],
      cf_market_reports: [{ id: "report-1", campaign_id: "campaign-1" }, { id: "report-2", campaign_id: "campaign-1" }],
      cf_ugc_scripts: [
        { id: "script-1", market_report_id: "report-1", project_name: "launch", campaign_id: "campaign-1", selected_hook_id: "hook-2", selected_hook_index: 1, current_version_number: 2 },
        { id: "script-2", market_report_id: "report-2", project_name: "sibling", campaign_id: "campaign-1", selected_hook_id: "hook-1", selected_hook_index: 0, current_version_number: 1 }
      ],
      cf_ugc_script_versions: [
        { script_id: "script-1", version_number: 1, content: { hooks: [{ angle: "problem" }] } },
        { script_id: "script-1", version_number: 2, content: { hooks: [{ id: "hook-1", text: "Demo hook" }, { id: "hook-2", text: "Still chasing approvals?" }] } },
        { script_id: "script-2", version_number: 1, content: { hookAngle: "Try this now" } }
      ],
      cf_script_review_events: [
        { script_id: "script-1", to_status: "client-review", created_at: "2026-07-01T00:00:00.000Z" },
        { script_id: "script-1", to_status: "approved", created_at: "2026-07-01T12:00:00.000Z" }
      ]
    };
    global.fetch = async (url) => {
      const table = new URL(url).pathname.split("/").at(-1);
      return new Response(JSON.stringify(rows[table] || []), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    try {
      const analytics = await supabaseAnalytics({ id: "admin", role: "admin" });
      assert.equal(analytics.market_reports, 2);
      assert.equal(analytics.ugc_scripts, 2);
      assert.equal(analytics.script_revisions, 3);
      assert.equal(analytics.script_approval_average_hours, 12);
      assert.equal(analytics.script_to_render_conversion, 50);
      assert.deepEqual(analytics.hook_angle_breakdown, [{ name: "other", count: 1 }, { name: "question", count: 1 }]);
      assert.equal(JSON.stringify(analytics).includes("Still chasing approvals?"), false);

      const staff = await supabaseAnalytics({ id: "editor", role: "staff-editor" });
      assert.equal(staff.market_reports, 1);
      assert.equal(staff.ugc_scripts, 1);
      assert.equal(staff.script_revisions, 2);
      assert.deepEqual(staff.hook_angle_breakdown, [{ name: "question", count: 1 }]);

      rows.cf_market_reports = [];
      rows.cf_ugc_scripts = [];
      rows.cf_ugc_script_versions = [];
      rows.cf_script_review_events = [];
      const empty = await supabaseAnalytics({ id: "admin", role: "admin" });
      assert.equal(empty.market_reports, 0);
      assert.equal(empty.ugc_scripts, 0);
      assert.equal(empty.script_revisions, 0);
      assert.equal(empty.script_approval_average_hours, 0);
      assert.equal(empty.script_to_render_conversion, 0);
      assert.deepEqual(empty.hook_angle_breakdown, []);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("pg analytics query sources the market and script metrics", () => {
  const source = fs.readFileSync(new URL("../src/services/supabaseDb.js", import.meta.url), "utf8");
  const persistence = source.slice(
    source.indexOf("export async function upsertSupabaseCampaignBrief"),
    source.indexOf("export async function upsertSupabaseProject")
  );
  const pgAnalytics = source.slice(source.indexOf("export async function supabaseAnalytics"));
  assert.doesNotMatch(persistence, /coalesce\(\$1::uuid/);
  assert.match(persistence, /gen_random_uuid\(\)::text/);
  assert.match(persistence, /selected_hook_id/);
  for (const token of [
    "cf_market_reports",
    "cf_ugc_scripts",
    "cf_ugc_script_versions",
    "cf_script_review_events",
    "script_approval_average_hours",
    "script_to_render_conversion",
    "hook_angle_breakdown"
  ]) assert.match(pgAnalytics, new RegExp(token));
  const conversion = pgAnalytics.slice(
    pgAnalytics.indexOf("count(*) filter"),
    pgAnalytics.indexOf("as script_to_render_conversion")
  );
  assert.match(conversion, /from cf_render_jobs r\s+join visible_projects p on p\.name = r\.project_name/);
  assert.doesNotMatch(pgAnalytics, /s\.campaign_id in \(select campaign_id from visible_campaigns\)/);
  assert.match(pgAnalytics, /mr\.id in \(\s*select market_report_id from visible_scripts/);
});
