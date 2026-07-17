import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as migration from "../scripts/cloudflare/migrateSupabaseData.js";

const { buildInsert, buildSelectionQueries, hydrateAuthUserIds, loadClipSelections, migrateSupabaseData, normalizeSupabaseUrl, resolveWranglerDatabaseId, tablePlan } = migration;

function supabaseResponse(rows, contentRange) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-range": contentRange }),
    json: async () => rows
  };
}

function migrationOptions() {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceKey: "test-service-key",
    projectsDir: "__missing_cloudflare_migration_projects__",
    dryRun: true
  };
}

test("normalizes Supabase project references and full URLs", () => {
  assert.equal(normalizeSupabaseUrl("abcdefghijklmnopqrst"), "https://abcdefghijklmnopqrst.supabase.co");
  assert.equal(normalizeSupabaseUrl("https://example.supabase.co/"), "https://example.supabase.co");
});

test("production migration resolves the top-level D1 binding", () => {
  const config = {
    d1_databases: [{ binding: "DB", database_id: "production-db" }],
    env: {
      preview: { d1_databases: [{ binding: "DB", database_id: "preview-db" }] }
    }
  };

  assert.equal(resolveWranglerDatabaseId(config, "production"), "production-db");
  assert.equal(resolveWranglerDatabaseId(config, "preview"), "preview-db");
});

test("auth migration maps immutable Supabase user IDs and rejects unresolved role accounts", () => {
  const rows = [
    { id: "admin", email: "Admin@DigitalBee.ai", auth_user_id: null, role: "admin" },
    { id: "editor", email: "editor@digitalbee.ai", auth_user_id: "stale-id", role: "staff-editor" }
  ];
  const authUsers = [
    { id: "auth-admin", email: "admin@digitalbee.ai" },
    { id: "auth-editor", email: "EDITOR@DIGITALBEE.AI" }
  ];

  assert.deepEqual(hydrateAuthUserIds(rows, authUsers).map((row) => row.auth_user_id), [
    "auth-admin",
    "auth-editor"
  ]);
  assert.throws(
    () => hydrateAuthUserIds(rows, authUsers.slice(0, 1)),
    /unresolved Supabase Auth users: editor@digitalbee\.ai/i
  );
});

test("migration hydrates Supabase Auth IDs before the first D1 user write", async () => {
  const originalFetch = globalThis.fetch;
  const d1Batches = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/auth/v1/admin/users") {
        return Response.json({ users: [{ id: "auth-admin", email: "admin@digitalbee.ai" }] });
      }
      if (parsed.hostname === "example.supabase.co") {
        const table = parsed.pathname.split("/").at(-1);
        if (table === "cf_users") {
          return supabaseResponse([{
            id: "admin",
            auth_user_id: null,
            name: "Admin",
            role: "admin",
            email: "admin@digitalbee.ai"
          }], "0-0/1");
        }
        return supabaseResponse([], "*/0");
      }
      d1Batches.push(...JSON.parse(init.body).batch);
      return Response.json({ success: true, result: [{ success: true, results: [] }] });
    };

    await migrateSupabaseData({
      ...migrationOptions(),
      dryRun: false,
      accountId: "account-1",
      databaseId: "database-1",
      apiToken: "token"
    });

    const userInsert = d1Batches.find((entry) => /INSERT INTO cf_users/i.test(entry.sql));
    assert.ok(userInsert);
    const userPlan = tablePlan.find((entry) => entry.name === "cf_users");
    assert.equal(userInsert.params[userPlan.columns.indexOf("auth_user_id")], "auth-admin");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migration plan preserves foreign-key import order", () => {
  const names = tablePlan.map((table) => table.name);
  assert.ok(names.indexOf("cf_clients") < names.indexOf("cf_campaigns"));
  assert.ok(names.indexOf("cf_folders") < names.indexOf("cf_projects"));
  assert.ok(names.indexOf("cf_projects") < names.indexOf("cf_assets"));
  assert.ok(names.indexOf("cf_ugc_scripts") < names.indexOf("cf_ugc_script_versions"));
  assert.ok(names.indexOf("cf_ugc_script_versions") < names.indexOf("cf_script_review_events"));
});

test("buildInsert uses parameters and serializes PostgreSQL JSON for D1", () => {
  const plan = tablePlan.find((table) => table.name === "cf_analytics_events");
  const query = buildInsert(plan, {
    id: "event-1",
    event_type: "render.completed",
    project_name: "launch",
    metadata: { outputs: 3 },
    created_at: "2026-07-17T00:00:00.000Z"
  });

  assert.match(query.sql, /^INSERT INTO cf_analytics_events \(/);
  assert.match(query.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.doesNotMatch(query.sql, /render\.completed|launch|outputs/);
  assert.deepEqual(query.params, [
    "event-1",
    "render.completed",
    "launch",
    JSON.stringify({ outputs: 3 }),
    "2026-07-17T00:00:00.000Z"
  ]);
});

test("project insert building never silently clears an unknown folder reference", () => {
  const plan = tablePlan.find((table) => table.name === "cf_projects");
  const unknown = buildInsert(plan, { name: "alpha", type: "ai-generator", folder_id: "missing" }, { folderIds: new Set(["folder-1"]) });
  const known = buildInsert(plan, { name: "beta", type: "auto-clipper", folder_id: "folder-1" }, { folderIds: new Set(["folder-1"]) });
  const folderIndex = plan.columns.indexOf("folder_id");

  assert.equal(unknown.params[folderIndex], "missing");
  assert.equal(known.params[folderIndex], "folder-1");
});

test("migration preflight rejects missing folder references before writing any D1 rows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-folder-preflight-"));
  const originalFetch = globalThis.fetch;
  let d1Writes = 0;
  try {
    await fs.writeFile(path.join(root, "folders.json"), JSON.stringify({
      folders: [{ id: "folder-1", name: "Known folder" }]
    }));
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname === "example.supabase.co") {
        const table = parsed.pathname.split("/").at(-1);
        if (table === "cf_clients") return supabaseResponse([{ id: "client-1", name: "Client" }], "0-0/1");
        if (table === "cf_projects") {
          return supabaseResponse([{ name: "alpha", type: "ai-generator", folder_id: "missing-folder" }], "0-0/1");
        }
        return supabaseResponse([], "*/0");
      }
      d1Writes += 1;
      return Response.json({ success: true, result: [{ success: true, results: [] }] });
    };

    let failure;
    try {
      await migrateSupabaseData({
        ...migrationOptions(),
        projectsDir: root,
        dryRun: false,
        accountId: "account-1",
        databaseId: "database-1",
        apiToken: "token"
      });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message || ""), /folder preflight.*alpha.*missing-folder/i);
    assert.equal(d1Writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("legacy cancelled production jobs migrate into the supported failed state", () => {
  const plan = tablePlan.find((table) => table.name === "cf_production_jobs");
  const query = buildInsert(plan, { id: "job-1", project_name: "alpha", job_type: "render", status: "cancelled" });
  assert.equal(query.params[plan.columns.indexOf("status")], "failed");
});

test("parses bounded and empty Content-Range totals", () => {
  assert.deepEqual(migration.parseContentRange?.("0-499/1500"), { start: 0, end: 499, total: 1500 });
  assert.deepEqual(migration.parseContentRange?.("*/0"), { start: null, end: null, total: 0 });
});

test("migration follows the authoritative total across server-capped pages", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const table = new URL(url).pathname.split("/").at(-1);
    if (table !== "cf_clients") return supabaseResponse([], "*/0");
    if (options.headers.range === "0-999") {
      return supabaseResponse([{ id: "client-1" }, { id: "client-2" }], "0-1/3");
    }
    if (options.headers.range === "2-1001") {
      return supabaseResponse([{ id: "client-3" }], "2-2/3");
    }
    throw new Error(`Unexpected client range: ${options.headers.range}`);
  };

  try {
    const counts = await migrateSupabaseData(migrationOptions());
    const clientCalls = calls.filter(({ url }) => new URL(url).pathname.endsWith("/cf_clients"));

    assert.equal(counts.cf_clients, 3);
    assert.deepEqual(clientCalls.map(({ options }) => options.headers.range), ["0-999", "2-1001"]);
    assert.equal(clientCalls[0].options.headers.prefer, "count=exact");
    assert.equal(new URL(clientCalls[0].url).searchParams.get("order"), "id.asc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migration rejects an empty page before the authoritative total", async () => {
  const originalFetch = globalThis.fetch;
  let clientPages = 0;

  globalThis.fetch = async (url) => {
    const table = new URL(url).pathname.split("/").at(-1);
    if (table !== "cf_clients") return supabaseResponse([], "*/0");
    clientPages += 1;
    if (clientPages === 1) return supabaseResponse([{ id: "client-1" }, { id: "client-2" }], "0-1/3");
    return supabaseResponse([], "*/3");
  };

  try {
    await assert.rejects(migrateSupabaseData(migrationOptions()), /cf_clients export stalled.*2 of 3/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local selected highlight manifests become scoped D1 selection updates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contentflow-selection-"));
  try {
    const selectedDir = path.join(root, "alpha", "clipper", "generated");
    await fs.mkdir(selectedDir, { recursive: true });
    await fs.writeFile(path.join(selectedDir, "selected-highlight.json"), JSON.stringify({ id: "c3" }));

    const selections = loadClipSelections(root);
    const queries = buildSelectionQueries(selections);

    assert.deepEqual(selections, [{ projectName: "alpha", highlightId: "c3" }]);
    assert.match(queries[0].sql, /SET selected = CASE/i);
    assert.deepEqual(queries[0].params, ["c3", "alpha:c3", "alpha"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Cloudflare cutover backups are excluded from Git", async () => {
  const gitignore = await fs.readFile(path.resolve(".gitignore"), "utf8");
  assert.match(gitignore, /^backups\/$/m);
});

test("deployment guide documents production migrations and auth identity preflight", async () => {
  const guide = await fs.readFile(path.resolve("docs", "CLOUDFLARE_DEPLOYMENT.md"), "utf8");
  assert.match(guide, /migrateSupabaseData\.js --env-file \.env --environment production/);
  assert.match(guide, /migrateLocalMedia\.js --env-file \.env --environment production/);
  assert.match(guide, /Supabase Auth.*immutable.*auth_user_id/is);
});
