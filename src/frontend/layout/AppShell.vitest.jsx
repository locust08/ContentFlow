import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell.jsx";

const app = {
  auth: { user: { name: "Admin", role: "admin" } }, role: "admin", isAdmin: true, isClient: false,
  status: "Ready", logout: vi.fn(), refresh: vi.fn(), openCreateProject: vi.fn()
};

describe("AppShell", () => {
  it("shows the Studio Bee identity and creator topbar controls", () => {
    const { container } = render(<MemoryRouter initialEntries={["/studio"]}><AppShell app={app}><div>Page</div></AppShell></MemoryRouter>);
    expect(container.querySelector(".brand-symbol")).toHaveAttribute("src", "/assets/brand/contentflow-bee.png");
    expect(screen.getByText("Good morning, Admin")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search projects, media, and more...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("closes mobile navigation after route selection", () => {
    const { container } = render(<MemoryRouter initialEntries={["/projects"]}><AppShell app={app}><div>Page</div></AppShell></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(container.querySelector(".app-shell")).toHaveClass("sidebar-open");
    fireEvent.click(screen.getByRole("link", { name: "Studio" }));
    expect(container.querySelector(".app-shell")).not.toHaveClass("sidebar-open");
  });
});
