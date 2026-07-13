import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { handleRequest } from "../src/server.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");

async function withServer(run) {
  const server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("serves the React entry point for extensionless nested frontend routes", async () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, "public", "index.html"), "utf8");

  await withServer(async (baseUrl) => {
    for (const route of ["/dashboard", "/projects/demo/ai-generator", "/manage/clients"]) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type"), /^text\/html/);
      assert.equal(await response.text(), indexHtml);
    }
  });
});

test("preserves the standalone mobile page and real static files", async () => {
  await withServer(async (baseUrl) => {
    const mobile = await fetch(`${baseUrl}/mobile`);
    assert.equal(mobile.status, 200);
    assert.match(mobile.headers.get("content-type"), /^text\/html/);
    assert.match(await mobile.text(), /mobile/i);

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get("content-type"), "application/manifest+json; charset=utf-8");
  });
});

test("does not turn backend, media, asset, or file-like misses into the React app", async () => {
  await withServer(async (baseUrl) => {
    for (const route of [
      "/api/not-a-real-endpoint",
      "/media/not-a-real-project/video.mp4",
      "/assets/not-a-real-bundle",
      "/not-a-real-script.js"
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 404, route);
      assert.doesNotMatch(response.headers.get("content-type") || "", /^text\/html/, route);
    }
  });
});

test("Vercel routing preserves backend and static paths before the SPA fallback", () => {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"));
  const routes = config.routes || [];
  const fallbackIndex = routes.findIndex((route) => route.dest === "/index.html" && route.src !== "/");
  const filesystemIndex = routes.findIndex((route) => route.handle === "filesystem");

  assert.notEqual(fallbackIndex, -1, "SPA fallback route is missing");
  assert.notEqual(filesystemIndex, -1, "filesystem handler is missing");
  assert.ok(filesystemIndex < fallbackIndex, "real files must be checked before SPA fallback");

  for (const prefix of ["/api", "/media", "/mobile", "/assets"]) {
    const routeIndex = routes.findIndex((route) => typeof route.src === "string" && route.src.startsWith(prefix));
    assert.notEqual(routeIndex, -1, `${prefix} preservation route is missing`);
    assert.ok(routeIndex < fallbackIndex, `${prefix} must be handled before SPA fallback`);
  }
});
