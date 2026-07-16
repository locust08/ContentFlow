import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar.jsx";

const baseApp = {
  auth: { user: { name: "A. Naiman", role: "admin" } },
  role: "admin",
  isAdmin: true,
  isClient: false,
  projects: [],
  logout: vi.fn()
};

function renderSidebar(app = baseApp) {
  return render(<MemoryRouter initialEntries={["/studio"]}><Sidebar app={app} /></MemoryRouter>);
}

describe("Sidebar", () => {
  it("prioritizes creator navigation and groups admin tools", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /studio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /market intelligence/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage/i })).toBeInTheDocument();
    expect(screen.queryByText("Clients")).not.toBeInTheDocument();
  });

  it("does not expose the admin manage group to staff", () => {
    renderSidebar({ ...baseApp, role: "staff-editor", isAdmin: false, auth: { user: { name: "Editor", role: "staff-editor" } } });
    expect(screen.getByRole("link", { name: /studio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /market intelligence/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^create$/i })).not.toBeInTheDocument();
  });

  it("shows only review navigation for clients", () => {
    renderSidebar({ ...baseApp, role: "manager-client", isAdmin: false, isClient: true, auth: { user: { name: "Client", role: "manager-client" } } });
    expect(screen.getByRole("link", { name: /media/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /approvals/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /studio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /market intelligence/i })).not.toBeInTheDocument();
  });
});
