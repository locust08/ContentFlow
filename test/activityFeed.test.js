import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { handleRequest } from "../src/server.js";

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

test("activity feed returns a bounded safe response", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/activity?limit=1000`);

    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.ok(Array.isArray(items));
    assert.ok(items.length <= 100);
    if (items[0]) {
      assert.deepEqual(Object.keys(items[0]).sort(), [
        "actorId", "actorName", "actorRole", "createdAt", "eventType",
        "id", "metadata", "projectName", "summary"
      ].sort());
    }
  });
});

test("activity visibility query matches project access roles", async () => {
  const activity = await import("../src/services/supabaseDb.js");

  assert.equal(activity.activityLimit(101), 100);
  assert.equal(activity.activityLimit(-1), 20);
  assert.deepEqual(activity.activityVisibilityQuery({ role: "admin" }), {
    where: "",
    params: []
  });
  assert.deepEqual(activity.activityVisibilityQuery({ id: "editor-1", role: "staff-editor" }), {
    where: "p.assigned_staff_id = $1",
    params: ["editor-1"]
  });
  assert.deepEqual(activity.activityVisibilityQuery({ id: "reviewer-1", role: "manager-client", clientId: "client-1" }), {
    where: "(p.client_id = $1 or p.reviewer_id = $2)",
    params: ["client-1", "reviewer-1"]
  });
  assert.equal(activity.activityProjectFilter({ id: "editor-1", role: "staff-editor" }), "assigned_staff_id=eq.editor-1");
  assert.equal(activity.activityProjectFilter({ id: "reviewer-1", role: "manager-client", clientId: "client-1" }), "or=(client_id.eq.client-1,reviewer_id.eq.reviewer-1)");
});
