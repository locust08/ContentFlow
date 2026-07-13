import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { StudioPage } from "./StudioPage.jsx";

const app = {
  isAdmin: true,
  projects: [
    { name: "UGC Demo", type: "ai-generator", renderCount: 1 },
    { name: "Clip Demo", type: "auto-clipper", renderCount: 2 }
  ],
  mediaItems: []
};

describe("StudioPage", () => {
  it("presents the two production tools as the primary actions", () => {
    render(<MemoryRouter><StudioPage app={app} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /ai ugc generator/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /auto clipper/i })).toBeInTheDocument();
    expect(screen.getByText(/recent projects/i)).toBeInTheDocument();
  });
});
