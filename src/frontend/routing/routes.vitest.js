import { describe, expect, it } from "vitest";
import { canAccessPath, getCampaignIntelligencePath, getLandingPath, getProjectPath } from "./routes.js";

describe("role-aware routing", () => {
  it("sends each role to its dedicated landing page", () => {
    expect(getLandingPath("admin")).toBe("/dashboard");
    expect(getLandingPath("staff-editor")).toBe("/studio");
    expect(getLandingPath("manager-client")).toBe("/media");
  });

  it("keeps client users out of internal production routes", () => {
    expect(canAccessPath("manager-client", "/media")).toBe(true);
    expect(canAccessPath("manager-client", "/approvals")).toBe(true);
    expect(canAccessPath("manager-client", "/studio")).toBe(false);
    expect(canAccessPath("manager-client", "/manage/clients")).toBe(false);
  });

  it("keeps staff users out of admin management routes", () => {
    expect(canAccessPath("staff-editor", "/studio")).toBe(true);
    expect(canAccessPath("staff-editor", "/intelligence")).toBe(true);
    expect(canAccessPath("staff-editor", "/campaigns/summer/intelligence")).toBe(true);
    expect(canAccessPath("staff-editor", "/projects/demo/auto-clipper")).toBe(true);
    expect(canAccessPath("staff-editor", "/manage/team")).toBe(false);
  });

  it("blocks clients from market intelligence", () => {
    expect(canAccessPath("admin", "/intelligence")).toBe(true);
    expect(canAccessPath("manager-client", "/intelligence")).toBe(false);
    expect(canAccessPath("manager-client", "/campaigns/summer/intelligence")).toBe(false);
  });

  it("builds stable encoded project workspace URLs", () => {
    expect(getProjectPath({ name: "Summer UGC", type: "ai-generator" })).toBe("/projects/Summer%20UGC/ai-generator");
    expect(getProjectPath({ name: "Clip Test", type: "auto-clipper" })).toBe("/projects/Clip%20Test/auto-clipper");
  });

  it("builds encoded campaign intelligence URLs", () => {
    expect(getCampaignIntelligencePath("Malaysia Launch 50%")).toBe("/campaigns/Malaysia%20Launch%2050%25/intelligence");
  });
});
