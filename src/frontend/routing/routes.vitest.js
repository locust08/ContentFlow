import { describe, expect, it } from "vitest";
import { canAccessPath, getLandingPath, getProjectPath } from "./routes.js";

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
    expect(canAccessPath("staff-editor", "/projects/demo/auto-clipper")).toBe(true);
    expect(canAccessPath("staff-editor", "/manage/team")).toBe(false);
  });

  it("builds stable encoded project workspace URLs", () => {
    expect(getProjectPath({ name: "Summer UGC", type: "ai-generator" })).toBe("/projects/Summer%20UGC/ai-generator");
    expect(getProjectPath({ name: "Clip Test", type: "auto-clipper" })).toBe("/projects/Clip%20Test/auto-clipper");
  });
});
