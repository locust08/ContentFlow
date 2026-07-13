import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const tokens = fs.readFileSync(path.join(root, "src", "frontend", "styles", "tokens.css"), "utf8");
const glass = fs.readFileSync(path.join(root, "src", "frontend", "styles", "glass.css"), "utf8");
const mobile = fs.readFileSync(path.join(root, "public", "mobile.css"), "utf8");
const mobileHtml = fs.readFileSync(path.join(root, "public", "mobile.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "public", "sw.js"), "utf8");
const asset = path.join(root, "public", "assets", "brand", "contentflow-holographic.webp");

test("web UI defines the Apple-style holographic visual system", () => {
  assert.match(tokens, /--font:\s*-apple-system,\s*BlinkMacSystemFont,\s*"SF Pro Text",\s*"SF Pro Display"/);
  assert.match(tokens, /--motion-standard:/);
  assert.match(tokens, /--motion-emphasized:/);
  assert.match(glass, /contentflow-holographic\.webp/);
  assert.match(glass, /@keyframes holographic-drift/);
  assert.match(glass, /@keyframes page-enter/);
  assert.match(glass, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(glass, /@supports not \(\(backdrop-filter:/);
  assert.ok(fs.existsSync(asset), "optimized holographic background asset must exist");
});

test("standalone mobile UI shares the holographic system with reduced motion", () => {
  assert.match(mobile, /contentflow-holographic\.webp/);
  assert.match(mobile, /-apple-system,\s*BlinkMacSystemFont,\s*"SF Pro Text"/);
  assert.match(mobile, /@keyframes mobile-page-enter/);
  assert.match(mobile, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(mobile, /min-height:\s*44px/);
  assert.match(mobileHtml, /mobile\.css\?v=holographic-apple-1/);
  assert.match(mobileHtml, /mobile\.js\?v=holographic-apple-1/);
  assert.match(serviceWorker, /contentflow-mobile-v2/);
  assert.match(serviceWorker, /contentflow-holographic\.webp/);
});
