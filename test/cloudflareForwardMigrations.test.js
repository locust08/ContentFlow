import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("forward migration enforces immutable auth identities and idempotent asset registrations", async () => {
  const sql = await readFile(new URL("../cloudflare/migrations/0003_identity_and_asset_uniqueness.sql", import.meta.url), "utf8");

  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS\s+idx_cf_users_auth_user_id_unique\s+ON cf_users\s*\(auth_user_id\)\s+WHERE auth_user_id IS NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS\s+idx_cf_assets_registration_unique\s+ON cf_assets\s*\(project_name, local_path, object_key\)\s+WHERE local_path IS NOT NULL AND object_key IS NOT NULL/i);
});
