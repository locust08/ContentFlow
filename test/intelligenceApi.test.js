import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { handleRequest } from "../src/server.js";
import { projectPath } from "../src/config.js";
import { createProject, deleteProject } from "../src/services/project.js";
import { writeJson } from "../src/utils/files.js";

const storePath = path.join(process.cwd(), "projects", "intelligence.json");

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

async function json(response) {
  const body = await response.json();
  assert.ok(response.ok, body.error || `HTTP ${response.status}`);
  return body;
}

test("campaign intelligence API saves briefs and research sources", async () => {
  const original = fs.existsSync(storePath) ? fs.readFileSync(storePath) : null;
  try {
    await withServer(async (baseUrl) => {
      const list = await json(await fetch(`${baseUrl}/api/intelligence`));
      assert.ok(list.campaigns.some((campaign) => campaign.id === "demo-campaign"));

      const briefResult = await json(await fetch(`${baseUrl}/api/campaigns/demo-campaign/brief`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: "Digital Bee", product: "ContentFlow AI", targetAudience: "Content teams" })
      }));
      assert.equal(briefResult.intelligence.brief.product, "ContentFlow AI");

      const sourceResult = await json(await fetch(`${baseUrl}/api/campaigns/demo-campaign/research-sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Customer reviews", content: "Editing every clip by hand takes too long." })
      }));
      assert.equal(sourceResult.intelligence.sources.length, 1);
      assert.equal(sourceResult.intelligence.sources[0].type, "text");

      const detail = await json(await fetch(`${baseUrl}/api/campaigns/demo-campaign/intelligence`));
      assert.equal(detail.brief.brand, "Digital Bee");
      assert.equal(detail.sources[0].name, "Customer reviews");
    });
  } finally {
    if (original) fs.writeFileSync(storePath, original);
    else fs.rmSync(storePath, { force: true });
  }
});

test("project script API versions edits, audits review transitions, and gates production", async () => {
  const project = `script-api-${Date.now()}`;
  createProject(project, { type: "ai-generator", campaignId: "demo-campaign" });
  const dir = projectPath(project);
  const script = {
    id: `script-${project}`,
    projectName: project,
    marketReportId: "report-1",
    status: "draft",
    currentVersionNumber: 1,
    currentVersionId: `script-${project}-v1`,
    hooks: [1, 2, 3].map((number) => ({ id: `hook-${number}`, text: `Hook ${number}`, evidence: [] })),
    selectedHookId: "hook-1",
    scenes: [{ id: "scene-1", title: "Hook", visualAction: "Show product", audioSpokenWord: "This saves time.", durationSeconds: 4 }]
  };
  writeJson(path.join(dir, "generated", "ugc-script.json"), script);
  writeJson(path.join(dir, "generated", "ugc-script-versions.json"), { versions: [{ id: script.currentVersionId, scriptId: script.id, versionNumber: 1, content: script }] });
  writeJson(path.join(dir, "generated", "ugc-script-review-events.json"), { events: [] });

  try {
    await withServer(async (baseUrl) => {
      const blocked = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project)}/generate-ugc-video`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      assert.equal(blocked.status, 500);
      assert.match((await blocked.json()).error, /approved|override/i);

      const saved = await json(await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project)}/ugc-script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersionId: script.currentVersionId,
          hooks: script.hooks,
          selectedHookId: "hook-2",
          scenes: [{ ...script.scenes[0], audioSpokenWord: "This gives your team time back." }]
        })
      }));
      assert.equal(saved.data.files.ugcScript.currentVersionNumber, 2);
      assert.equal(saved.data.files.ugcScript.selectedHookId, "hook-2");
      assert.equal(saved.data.scriptVersions.length, 2);

      for (const status of ["internal-review", "client-review", "approved"]) {
        const reviewed = await json(await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project)}/ugc-script/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, feedback: `Move to ${status}` })
        }));
        assert.equal(reviewed.data.files.ugcScript.status, status);
      }

      const detail = await json(await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project)}`));
      assert.equal(detail.scriptReviewEvents.length, 3);
      assert.equal(detail.scriptReviewEvents.at(-1).toStatus, "approved");
    });
  } finally {
    deleteProject(project);
  }
});
