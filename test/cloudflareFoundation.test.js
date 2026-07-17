import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("D1 migration defines the complete ContentFlow domain without PostgreSQL-only syntax", () => {
  const migrationPath = path.join(root, "cloudflare", "migrations", "0001_initial.sql");
  assert.equal(fs.existsSync(migrationPath), true, "missing initial D1 migration");
  const sql = fs.readFileSync(migrationPath, "utf8");
  const tables = [
    "cf_users",
    "cf_clients",
    "cf_campaigns",
    "cf_folders",
    "cf_projects",
    "cf_assets",
    "cf_clip_candidates",
    "cf_render_jobs",
    "cf_approval_events",
    "cf_analytics_events",
    "cf_production_jobs",
    "cf_campaign_briefs",
    "cf_research_sources",
    "cf_research_source_chunks",
    "cf_market_reports",
    "cf_ugc_scripts",
    "cf_ugc_script_versions",
    "cf_script_review_events"
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists ${table}\\b`, "i"), `missing ${table}`);
  }
  assert.doesNotMatch(sql, /\bjsonb\b|\btimestamptz\b|gen_random_uuid|create extension|\bdo\s+\$\$|::[a-z]/i);
  assert.match(sql, /pragma foreign_keys\s*=\s*on/i);
  assert.match(sql, /idx_cf_production_jobs_status/i);
  assert.match(sql, /idx_cf_assets_project/i);
  assert.match(sql, /lease_expires_at/i);
  assert.match(sql, /attempt_count/i);
  assert.match(sql, /idempotency_key/i);
  assert.match(sql, /content_object_key/i);
  assert.match(sql, /report_object_key/i);
});

test("Wrangler deploys the React SPA and routes API and media requests through bindings", () => {
  const configPath = path.join(root, "wrangler.jsonc");
  assert.equal(fs.existsSync(configPath), true, "missing wrangler.jsonc");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(config.main, "cloudflare/worker/index.js");
  assert.equal(config.assets.directory, "./public");
  assert.equal(config.assets.not_found_handling, "single-page-application");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*", "/media/*", "/internal/*"]);
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.r2_buckets[0].binding, "MEDIA");
  assert.equal(config.env.preview.d1_databases[0].binding, "DB");
  assert.equal(config.env.preview.r2_buckets[0].binding, "MEDIA");
});

test("Cloudflare local secrets are ignored by Git", () => {
  const ignored = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignored, /^\.dev\.vars\*$/m);
  assert.match(ignored, /^\.wrangler\/$/m);
});

test("package scripts provide repeatable Cloudflare development and deployment commands", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.devDependencies?.wrangler, "Wrangler must be pinned as a development dependency");
  assert.equal(pkg.scripts["cloudflare:dev"], "wrangler dev --env preview");
  assert.equal(pkg.scripts["cloudflare:migrate:preview"], "wrangler d1 migrations apply contentflow-ai-preview --remote --env preview");
  assert.equal(pkg.scripts["cloudflare:deploy:preview"], "npm run build && wrangler deploy --env preview");
  assert.equal(pkg.scripts["cloudflare:deploy"], "npm run build && wrangler deploy");
});

test("clipper selection has a forward migration for already deployed databases", () => {
  const sql = fs.readFileSync(path.join(root, "cloudflare", "migrations", "0002_clipper_selection.sql"), "utf8");
  assert.match(sql, /alter table cf_clip_candidates add column selected integer/i);
  assert.match(sql, /idx_cf_clip_candidates_selected/i);
});
