import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CampaignIntelligencePage, IntelligencePage } from "./MarketIntelligencePage.jsx";

const pillars = {
  features: [{ insight: "Fast setup", evidence: [{ quote: "I was ready in minutes", sourceId: "s-1" }], frequency: 3, confidence: 0.91 }],
  benefits: [{ insight: "More time to create", evidence: [{ quote: "I got my evening back", sourceId: "s-1" }], frequency: 2, confidence: 0.84 }],
  painPoints: [{ insight: "Setup feels complicated", evidence: [{ quote: "Setup takes too long", sourceId: "s-1" }], frequency: 4, confidence: 0.88 }],
  objections: [{ insight: "Unsure about fit", evidence: [{ quote: "Will it work for me?", sourceId: "s-2" }], frequency: 2, confidence: 0.75 }],
  failedSolutions: [{ insight: "Templates felt generic", evidence: [{ quote: "The template did not fit", sourceId: "s-2" }], frequency: 2, confidence: 0.74 }],
  triggerEvents: [{ insight: "A campaign deadline", evidence: [{ quote: "The launch is next week", sourceId: "s-1" }], frequency: 1, confidence: 0.7 }],
  drivingEmotions: [{ insight: "Relief", evidence: [{ quote: "I can finally breathe", sourceId: "s-1" }], frequency: 3, confidence: 0.86 }]
};

function buildApp(reportStatus = "draft") {
  return {
    intelligence: {
      campaigns: [{ id: "c-1", name: "Raya Launch", clientName: "Orbit" }],
      active: {
        brief: { objective: "Grow qualified demand", audience: "Urban creators" },
        sources: [
          { id: "s-1", name: "Customer interviews", type: "text", status: "ready", evidenceCount: 4 },
          { id: "s-2", name: "Competitor notes.md", type: "md", status: "ready", evidenceCount: 7 }
        ],
        activeReport: { id: "r-1", status: reportStatus, pillars }
      }
    },
    organization: { campaigns: [{ id: "c-1", name: "Raya Launch", clientName: "Orbit" }] },
    isAdmin: true,
    loadIntelligence: vi.fn().mockResolvedValue({}),
    loadCampaignIntelligence: vi.fn().mockResolvedValue({}),
    updateCampaignBrief: vi.fn().mockResolvedValue({}),
    addResearchText: vi.fn().mockResolvedValue({}),
    uploadResearchSource: vi.fn().mockResolvedValue({}),
    deleteResearchSource: vi.fn().mockResolvedValue({}),
    generateMarketReport: vi.fn().mockResolvedValue({}),
    updateMarketReport: vi.fn().mockResolvedValue({}),
    approveMarketReport: vi.fn().mockResolvedValue({})
  };
}

function renderCampaign(app = buildApp()) {
  return render(
    <MemoryRouter initialEntries={["/campaigns/c-1/intelligence"]}>
      <Routes><Route path="/campaigns/:campaign/intelligence" element={<CampaignIntelligencePage app={app} />} /></Routes>
    </MemoryRouter>
  );
}

describe("Market Intelligence", () => {
  it("lists campaign workspaces", () => {
    const app = buildApp();
    render(<MemoryRouter><IntelligencePage app={app} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Market Intelligence" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Raya Launch/i })).toHaveAttribute("href", "/campaigns/c-1/intelligence");
  });

  it("shows a recoverable message when intelligence cannot load", async () => {
    const app = buildApp();
    app.intelligence.campaigns = [];
    app.loadIntelligence = vi.fn().mockRejectedValue(new Error("Intelligence endpoint unavailable"));
    render(<MemoryRouter><IntelligencePage app={app} /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Intelligence endpoint unavailable");
  });

  it("adds a text research source", async () => {
    const app = buildApp();
    renderCampaign(app);
    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Creator comments" } });
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "Creators want proof before price." } });
    fireEvent.click(screen.getByRole("button", { name: "Add text source" }));
    expect(app.addResearchText).toHaveBeenCalledWith("c-1", {
      name: "Creator comments",
      content: "Creators want proof before price."
    });
  });

  it("generates from selected evidence and approves the report", () => {
    const app = buildApp();
    renderCampaign(app);
    fireEvent.click(screen.getByLabelText("Select Customer interviews"));
    fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
    expect(app.generateMarketReport).toHaveBeenCalledWith("c-1", ["s-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Approve report" }));
    expect(app.approveMarketReport).toHaveBeenCalledWith("c-1", "r-1");
  });

  it("shows seven evidence-backed pillars and unlocks scriptwriting only after approval", () => {
    const { rerender } = renderCampaign(buildApp());
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    const featuresPanel = screen.getByRole("tabpanel", { name: "Features" });
    expect(within(featuresPanel).getByText("I was ready in minutes")).toBeInTheDocument();
    expect(within(featuresPanel).getByText("3")).toBeInTheDocument();
    expect(within(featuresPanel).getByText("91%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Script Studio" })).toBeDisabled();

    rerender(
      <MemoryRouter initialEntries={["/campaigns/c-1/intelligence"]}>
        <Routes><Route path="/campaigns/:campaign/intelligence" element={<CampaignIntelligencePage app={buildApp("approved")} />} /></Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: "Open Script Studio" })).toBeEnabled();
  });
});
