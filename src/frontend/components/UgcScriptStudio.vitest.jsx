import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UgcScriptStudio } from "./UgcScriptStudio.jsx";

function projectData(reportStatus = "approved") {
  return {
    files: {
      marketReport: { id: "report-1", status: reportStatus },
      scriptAnalysis: { hookPattern: "Problem, proof, payoff", pacing: "Fast", evidence: ["Interview signal"] },
      ugcScript: {
        id: "script-1",
        currentVersionId: "version-2",
        status: "client-review",
        selectedHookId: "hook-1",
        hooks: [
          { id: "hook-1", text: "Still wasting time on setup?", evidence: ["Interview signal"] },
          { id: "hook-2", text: "I got my first result in ten minutes.", evidence: ["Usage study"] },
          { id: "hook-3", text: "This changed my creator workflow.", evidence: ["Creator comments"] }
        ],
        scenes: [
          { id: "scene-1", title: "Cold open", durationSeconds: 5, visualAction: "Creator at desk", audioSpokenWord: "I nearly gave up.", evidence: ["Interview signal"] },
          { id: "scene-2", title: "Proof", durationSeconds: 12, visualAction: "Product close-up", audioSpokenWord: "Then this worked.", evidence: ["Usage study"] }
        ],
        metrics: { durationSeconds: 17, readabilityGrade: 6, evidenceCoverage: 92 }
      }
    },
    scriptVersions: [{ id: "version-2", versionNumber: 2, createdAt: "2026-07-16T09:00:00Z" }],
    scriptReviewEvents: [{ id: "review-1", toStatus: "client-review", feedback: "Ready for client" }]
  };
}

function buildApp(overrides = {}) {
  return {
    isAdmin: false,
    analyzeUgcScript: vi.fn().mockResolvedValue({}),
    generateUgcScript: vi.fn().mockResolvedValue({}),
    updateUgcScript: vi.fn().mockResolvedValue({}),
    reviewUgcScript: vi.fn().mockResolvedValue({}),
    ...overrides
  };
}

describe("UGC Script Studio", () => {
  it("saves the selected hook in a new script version", () => {
    const app = buildApp();
    render(<UgcScriptStudio app={app} data={projectData()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: /I got my first result/i }));
    fireEvent.change(screen.getByLabelText("Dialogue for Cold open"), { target: { value: "I fixed setup in minutes." } });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(app.updateUgcScript).toHaveBeenCalledWith({
      scriptId: "script-1",
      baseVersionId: "version-2",
      hooks: expect.any(Array),
      selectedHookId: "hook-2",
      scenes: expect.arrayContaining([expect.objectContaining({ id: "scene-1", audioSpokenWord: "I fixed setup in minutes." })])
    });
  });

  it("keeps generation locked for staff until the report is approved", () => {
    render(<UgcScriptStudio app={buildApp()} data={projectData("draft")} />);
    expect(screen.getByRole("button", { name: "Generate script" })).toBeDisabled();
    expect(screen.getByText(/approved market report required/i)).toBeInTheDocument();
  });

  it("requires an admin override reason for an unapproved report", () => {
    const app = buildApp({ isAdmin: true });
    render(<UgcScriptStudio app={app} data={projectData("draft")} />);
    fireEvent.click(screen.getByRole("button", { name: "Override approval gate" }));
    const generate = screen.getByRole("button", { name: "Generate script" });
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "Urgent legal-approved launch test" } });
    fireEvent.click(generate);
    expect(app.generateUgcScript).toHaveBeenCalledWith("report-1", "Urgent legal-approved launch test");
  });

  it("analyzes a manually supplied inspiration transcript", () => {
    const app = buildApp();
    render(<UgcScriptStudio app={app} data={projectData()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Manual transcript" }));
    fireEvent.change(screen.getByLabelText("Inspiration transcript"), { target: { value: "Here is the opening and proof." } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze inspiration" }));
    expect(app.analyzeUgcScript).toHaveBeenCalledWith("manual", "Here is the opening and proof.");
  });

  it("submits script review feedback", () => {
    const app = buildApp({ isClient: true });
    render(<UgcScriptStudio app={app} data={projectData()} />);
    fireEvent.change(screen.getByLabelText("Review feedback"), { target: { value: "Ready after legal check" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve script" }));
    expect(app.reviewUgcScript).toHaveBeenCalledWith("approved", "Ready after legal check");
  });
});
