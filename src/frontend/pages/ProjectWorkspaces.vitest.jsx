import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiGeneratorPage, AutoClipperPage } from "./ProjectWorkspaces.jsx";

function buildApp() {
  return {
    activeProject: "clip-test",
    activeProjectData: {
      summary: {
        type: "auto-clipper",
        hasClipperSource: true,
        hasClipperReaction: true,
        hasClipperTranscript: true,
        hasClipperHighlights: true,
        hasClipperSelection: true,
        hasClipperRender: false,
        renderCount: 0
      },
      files: {
        clipperHighlights: {
          candidates: [
            { id: "h-1", title: "First hook", start: 10, end: 42, score: 92 },
            { id: "h-2", title: "Second hook", start: 50, end: 88, score: 87 }
          ]
        },
        clipperSelection: { id: "h-1" }
      },
      clipper: {
        reactions: [
          { id: "r-1", name: "Levi", type: "image", url: "/levi.jpg" },
          { id: "r-2", name: "Maya", type: "video", url: "/maya.mp4" }
        ]
      },
      renders: []
    },
    runProjectAction: vi.fn().mockResolvedValue({}),
    uploadProjectFile: vi.fn().mockResolvedValue({})
  };
}

describe("AutoClipperPage", () => {
  it("renders selected highlights in bulk", async () => {
    const app = buildApp();
    render(<AutoClipperPage app={app} />);

    fireEvent.click(screen.getByLabelText("Select First hook"));
    fireEvent.click(screen.getByLabelText("Select Second hook"));
    fireEvent.click(screen.getByRole("button", { name: /render 2 selected clips/i }));

    expect(app.runProjectAction).toHaveBeenCalledWith("/clipper/render-bulk", expect.objectContaining({
      body: { highlightIds: ["h-1", "h-2"] }
    }));
  });

  it("renders one variation per selected character", async () => {
    const app = buildApp();
    render(<AutoClipperPage app={app} />);

    fireEvent.click(screen.getByLabelText("Select Levi"));
    fireEvent.click(screen.getByLabelText("Select Maya"));
    fireEvent.click(screen.getByRole("button", { name: /render 2 character variations/i }));

    expect(app.runProjectAction).toHaveBeenCalledWith("/clipper/render-variations", expect.objectContaining({
      body: { reactionIds: ["r-1", "r-2"] }
    }));
  });
});

describe("AiGeneratorPage", () => {
  it("includes research, script, and review in production progress", () => {
    render(<AiGeneratorPage app={{
      activeProject: "ugc-test",
      activeProjectData: {
        summary: { type: "ai-generator", renderCount: 0 },
        files: {}, products: [], characters: [], videos: [], renders: []
      },
      uploadProjectFile: vi.fn(),
      runProjectAction: vi.fn(),
      analyzeUgcScript: vi.fn(),
      generateUgcScript: vi.fn(),
      updateUgcScript: vi.fn(),
      reviewUgcScript: vi.fn()
    }} />);
    const progress = screen.getByRole("list");
    expect(progress).toHaveTextContent("Research");
    expect(progress).toHaveTextContent("Script");
    expect(progress).toHaveTextContent("Review");
  });
});
