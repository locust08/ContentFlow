import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function mobileFiles() {
  const [html, css, js] = await Promise.all([
    readFile(new URL("public/mobile.html", root), "utf8"),
    readFile(new URL("public/mobile.css", root), "utf8"),
    readFile(new URL("public/mobile.js", root), "utf8")
  ]);
  return { html, css, js };
}

test("mobile staff workspace keeps the task-first navigation and workflow bindings", async () => {
  const { html, js } = await mobileFiles();

  assert.match(html, /<nav class="mobile-nav" aria-label="Staff workspace">/);
  assert.match(html, /data-view="projects"[^>]*aria-current="page"/);
  assert.match(html, /data-view="uploads"/);
  assert.match(html, /data-view="reviews"/);
  assert.match(html, /data-view="profile"/);
  assert.match(html, /id="mobile-projects"/);
  assert.match(html, /id="mobile-upload-reference"/);
  assert.match(html, /id="mobile-upload-reaction"/);
  assert.match(html, /id="mobile-save-review"/);
  assert.match(js, /state\.auth\.user \? state\.projects : state\.projects\.filter/);
  assert.match(js, /\.\.\.authHeaders\(\),/);
  assert.match(js, /node\.hidden = text === "Ready"/);
});

test("mobile daylight-glass styles keep touch, motion, and narrow-screen safeguards", async () => {
  const { css } = await mobileFiles();

  assert.match(css, /--accent:\s*#ffd21f/i);
  assert.match(css, /html\s*\{[\s\S]*min-width:\s*360px/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@supports not \(backdrop-filter:\s*blur\(1px\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
