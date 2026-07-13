import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectWorkspaceRoute } from "./App.jsx";

function renderRoute(app, entry = "/projects/50%25-off/ai-generator") {
  return render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/projects/:project/ai-generator" element={<ProjectWorkspaceRoute app={app} type="ai-generator" />} /></Routes></MemoryRouter>);
}

describe("ProjectWorkspaceRoute", () => {
  it("accepts project names containing percent characters", () => {
    renderRoute({
      activeProject: "50%-off",
      activeProjectData: { summary: { type: "ai-generator", renderCount: 0 }, products: [], characters: [], videos: [], renders: [] },
      selectProject: vi.fn()
    });
    expect(screen.getByRole("heading", { name: "50%-off" })).toBeInTheDocument();
  });

  it("shows a recoverable error when a project cannot load", async () => {
    renderRoute({ activeProject: "", activeProjectData: null, selectProject: vi.fn().mockRejectedValue(new Error("Project not found")) }, "/projects/missing/ai-generator");
    expect(await screen.findByText("Project not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to projects" })).toBeInTheDocument();
  });
});
