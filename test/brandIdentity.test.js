import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "public");

test("Studio Bee brand assets exist for the app shell and favicon surfaces", () => {
  const required = [
    "assets/brand/contentflow-bee.png",
    "assets/brand/contentflow-bee-192.png",
    "assets/brand/contentflow-bee-512.png",
    "favicon-32.png"
  ];

  for (const relativePath of required) {
    const filePath = path.join(publicDir, relativePath);
    assert.ok(fs.existsSync(filePath), `${relativePath} must exist`);
    assert.ok(fs.statSync(filePath).size > 0, `${relativePath} must not be empty`);
  }

  const html = fs.readFileSync(path.join(publicDir, "mobile.html"), "utf8");
  const manifest = fs.readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8");
  assert.match(html, /favicon-32\.png/);
  assert.match(manifest, /contentflow-bee-192\.png/);
  assert.match(manifest, /contentflow-bee-512\.png/);
});
