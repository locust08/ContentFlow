import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "./DashboardPage.jsx";

const app = {
  auth: { user: { name: "A. Naiman", role: "admin" } },
  projects: [
    { name: "launch", approvalStatus: "in-review" },
    { name: "cutdowns", approvalStatus: "changes-requested" },
    { name: "approved-work", approvalStatus: "approved" }
  ],
  mediaItems: [{ name: "final.mp4" }, { name: "clip.mp4" }],
  activityItems: [
    {
      id: "event-1",
      eventType: "production.completed",
      projectName: "launch",
      actorName: "Editor",
      summary: "Final render completed",
      createdAt: "2026-07-13T08:00:00.000Z"
    },
    {
      id: "event-2",
      eventType: "project_synced",
      projectName: "cutdowns",
      actorName: "ContentFlow",
      summary: "",
      createdAt: "2026-07-13T08:05:00.000Z"
    }
  ]
};

describe("DashboardPage", () => {
  it("presents the operational dashboard and persisted activity", () => {
    render(<MemoryRouter><DashboardPage app={app} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: /production overview/i })).toBeInTheDocument();
    const pendingMetric = screen.getByText("Pending Approvals").closest("article");
    expect(pendingMetric).toBeInTheDocument();
    expect(within(pendingMetric).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /client brief workflow/i })).toBeInTheDocument();
    expect(screen.getByText("Final render completed")).toBeInTheDocument();
    expect(screen.getByText("Project synced")).toBeInTheDocument();
    expect(screen.getByText(/launch/i)).toBeInTheDocument();
  });
});
