import test from "node:test";
import assert from "node:assert/strict";
import { filterMediaForUser, filterProjectsForUser } from "../src/services/access.js";

const projects = [
  { name: "admin-project", clientId: "digital-bee", assignedStaffId: "admin", reviewerId: "reviewer" },
  { name: "staff-project", clientId: "senheng", assignedStaffId: "editor", reviewerId: "reviewer" },
  { name: "other-project", clientId: "other-client", assignedStaffId: "someone", reviewerId: "" }
];

const media = [
  { name: "a.mp4", project: "admin-project", clientId: "digital-bee", assignedStaffId: "admin", reviewerId: "reviewer" },
  { name: "b.mp4", project: "staff-project", clientId: "senheng", assignedStaffId: "editor", reviewerId: "reviewer" },
  { name: "c.mp4", project: "other-project", clientId: "other-client", assignedStaffId: "someone", reviewerId: "" }
];

test("admin users can see every project and media item", () => {
  const user = { id: "admin", role: "admin" };
  assert.deepEqual(filterProjectsForUser(projects, user).map((project) => project.name), ["admin-project", "staff-project", "other-project"]);
  assert.deepEqual(filterMediaForUser(media, user).map((item) => item.name), ["a.mp4", "b.mp4", "c.mp4"]);
});

test("staff users can see only assigned projects and media", () => {
  const user = { id: "editor", role: "staff-editor" };
  assert.deepEqual(filterProjectsForUser(projects, user).map((project) => project.name), ["staff-project"]);
  assert.deepEqual(filterMediaForUser(media, user).map((item) => item.name), ["b.mp4"]);
});

test("client users can see their client projects and reviewer assignments", () => {
  const user = { id: "reviewer", role: "manager-client", clientId: "senheng" };
  assert.deepEqual(filterProjectsForUser(projects, user).map((project) => project.name), ["admin-project", "staff-project"]);
  assert.deepEqual(filterMediaForUser(media, user).map((item) => item.name), ["a.mp4", "b.mp4"]);
});
