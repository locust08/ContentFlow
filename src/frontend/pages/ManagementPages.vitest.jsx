import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProjectsPage } from "./ManagementPages.jsx";

describe("ProjectsPage permissions", () => {
  it("does not expose folder mutation controls to staff", () => {
    render(<MemoryRouter><ProjectsPage app={{ isAdmin: false, projects: [], folders: [{ id: "f1", name: "Client A" }], organization: { clients: [], campaigns: [], staff: [] } }} /></MemoryRouter>);
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Client A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete folder Client A" })).not.toBeInTheDocument();
  });
});
