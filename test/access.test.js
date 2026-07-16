import test from "node:test";
import assert from "node:assert/strict";
import { canAccessCampaign, canEditCampaign, filterMediaForUser, filterProjectsForUser } from "../src/services/access.js";

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

test("campaign access follows admin, assignment, and client boundaries", () => {
  const campaign = { id: "launch", clientId: "senheng" };
  const campaignProjects = [
    { name: "launch-a", campaignId: "launch", assignedStaffId: "editor", reviewerId: "reviewer", clientId: "senheng" }
  ];

  assert.equal(canAccessCampaign(campaign, campaignProjects, { id: "admin", role: "admin" }), true);
  assert.equal(canEditCampaign(campaign, campaignProjects, { id: "admin", role: "admin" }), true);
  assert.equal(canAccessCampaign(campaign, campaignProjects, { id: "editor", role: "staff-editor" }), true);
  assert.equal(canEditCampaign(campaign, campaignProjects, { id: "editor", role: "staff-editor" }), true);
  assert.equal(canAccessCampaign(campaign, campaignProjects, { id: "other", role: "staff-editor" }), false);
  assert.equal(canAccessCampaign(campaign, campaignProjects, { id: "client", role: "manager-client", clientId: "senheng" }), true);
  assert.equal(canEditCampaign(campaign, campaignProjects, { id: "client", role: "manager-client", clientId: "senheng" }), false);
});
