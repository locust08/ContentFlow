import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateProjectModal } from "./CreateProjectModal.jsx";

describe("CreateProjectModal", () => {
  it("submits the selected project type and assignments", async () => {
    const onCreate = vi.fn().mockResolvedValue({ name: "New UGC", type: "ai-generator" });
    render(<CreateProjectModal open initialType="ai-generator" app={{ organization: { clients: [], campaigns: [], staff: [] }, folders: [] }} onClose={vi.fn()} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: "New UGC" } });
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "New UGC", type: "ai-generator", priority: "normal" }));
  });
});
