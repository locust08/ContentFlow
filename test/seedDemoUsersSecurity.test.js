import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureStorageBucket,
  passwordForRole,
  validateDemoPasswords
} from "../src/cli/seedDemoUsers.js";

const root = path.resolve(import.meta.dirname, "..");
const seedScript = path.join(root, "src", "cli", "seedDemoUsers.js");

function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function demoPasswords(overrides = {}) {
  return {
    DEMO_ADMIN_PASSWORD: "AdminSecure2026!",
    DEMO_STAFF_PASSWORD: "StaffSecure2026!",
    DEMO_CLIENT_PASSWORD: "ClientSecure2026!",
    ...overrides
  };
}

function runSeed(passwords = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "contentflow-seed-security-"));
  const result = spawnSync(process.execPath, [seedScript], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...passwords
    }
  });
  return { ...result, cwd };
}

test("repository contains no fixed demo password", () => {
  const retiredPassword = ["ContentFlow", "Demo2026!"].join("");
  const textExtensions = new Set(["", ".example", ".js", ".json", ".md", ".txt", ".yaml", ".yml"]);
  const matches = repositoryFiles().filter((relativePath) => {
    if (!textExtensions.has(path.extname(relativePath).toLowerCase())) return false;
    return fs.readFileSync(path.join(root, relativePath), "utf8").includes(retiredPassword);
  });
  assert.deepEqual(matches, []);
});

test("seed command requires every role password before filesystem or network setup", () => {
  const result = runSeed(demoPasswords({ DEMO_CLIENT_PASSWORD: "" }));
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEMO_CLIENT_PASSWORD is required/i);
    assert.equal(fs.existsSync(path.join(result.cwd, "projects")), false);
  } finally {
    fs.rmSync(result.cwd, { recursive: true, force: true });
  }
});

test("seed command rejects a weak role password before filesystem or network setup", () => {
  const result = runSeed(demoPasswords({ DEMO_STAFF_PASSWORD: "short" }));
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEMO_STAFF_PASSWORD must be at least 12 characters/i);
    assert.equal(fs.existsSync(path.join(result.cwd, "projects")), false);
  } finally {
    fs.rmSync(result.cwd, { recursive: true, force: true });
  }
});

test("seed command requires mixed character classes before filesystem or network setup", () => {
  const result = runSeed(demoPasswords({ DEMO_ADMIN_PASSWORD: "longbutonlylowercase" }));
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEMO_ADMIN_PASSWORD must include uppercase, lowercase, number, and symbol/i);
    assert.equal(fs.existsSync(path.join(result.cwd, "projects")), false);
  } finally {
    fs.rmSync(result.cwd, { recursive: true, force: true });
  }
});

test("seed command rejects passwords reused across roles before filesystem or network setup", () => {
  const result = runSeed(demoPasswords({ DEMO_CLIENT_PASSWORD: "AdminSecure2026!" }));
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /demo role passwords must be distinct/i);
    assert.equal(fs.existsSync(path.join(result.cwd, "projects")), false);
  } finally {
    fs.rmSync(result.cwd, { recursive: true, force: true });
  }
});

test("validated passwords map to their matching normalized roles", () => {
  const passwords = validateDemoPasswords(demoPasswords());
  assert.equal(passwordForRole("admin", passwords), "AdminSecure2026!");
  assert.equal(passwordForRole("staff-editor", passwords), "StaffSecure2026!");
  assert.equal(passwordForRole("manager-client", passwords), "ClientSecure2026!");
});

test("storage bucket is private when created", async () => {
  const requests = [];
  const result = await ensureStorageBucket(async (requestPath, options) => {
    requests.push({ requestPath, options });
    return {};
  });

  assert.equal(result.created, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestPath, "/storage/v1/bucket");
  assert.equal(JSON.parse(requests[0].options.body).public, false);
});

test("existing storage bucket is updated to private", async () => {
  const requests = [];
  const result = await ensureStorageBucket(async (requestPath, options) => {
    requests.push({ requestPath, options });
    if (requests.length === 1) {
      const error = new Error("already exists");
      error.status = 409;
      throw error;
    }
    return {};
  });

  assert.equal(result.created, false);
  assert.equal(requests.length, 2);
  assert.match(requests[1].requestPath, /^\/storage\/v1\/bucket\//);
  assert.deepEqual(JSON.parse(requests[1].options.body), { public: false });
});
