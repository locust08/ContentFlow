import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProductionCommandCenter } from "./ProductionCommandCenter.jsx";

const retryJob = vi.fn();
const cancelJob = vi.fn();
const refresh = vi.fn();
const setFilters = vi.fn();

const commandCenter = {
  jobs: [
    {
      id: "job-failed",
      status: "failed",
      projectName: "Summer UGC",
      jobType: "render-final-video",
      attemptCount: 2,
      progress: 75,
      progressMessage: "Render stopped",
      error: "The source video was unavailable.",
      payload: { title: "Campaign note", apiKey: "secret-key", token: "secret-token", authorization: "secret-header" },
      requestedBy: "Admin",
      createdAt: "2026-07-14T08:00:00.000Z",
      startedAt: "2026-07-14T08:01:00.000Z",
      completedAt: "2026-07-14T08:02:00.000Z"
    },
    {
      id: "job-queued",
      status: "queued",
      projectName: "Summer UGC",
      jobType: "pipeline",
      attemptCount: 0,
      progress: 0,
      progressMessage: "Waiting for worker",
      payload: {},
      createdAt: "2026-07-14T08:03:00.000Z"
    },
    {
      id: "job-processing",
      status: "processing",
      projectName: "Clip Test",
      jobType: "clipper-render-variations",
      attemptCount: 1,
      progress: 25,
      progressMessage: "Inputs prepared",
      payload: {},
      createdAt: "2026-07-14T08:04:00.000Z",
      startedAt: "2026-07-14T08:05:00.000Z"
    },
    {
      id: "job-completed",
      status: "completed",
      projectName: "Clip Test",
      jobType: "render-final-video",
      attemptCount: 1,
      progress: 100,
      outputUrl: "https://media.example.test/output.mp4",
      payload: {},
      createdAt: "2026-07-14T08:06:00.000Z",
      startedAt: "2026-07-14T08:07:00.000Z",
      completedAt: "2026-07-14T08:08:00.000Z"
    }
  ],
  summary: { queued: 1, processing: 1, completed: 1, failed: 1, cancelled: 0, total: 4 },
  workers: [{ workerId: "worker-main", workerName: "Studio workstation", health: { status: "offline", ageMs: 30000 }, lastSeenAt: "2026-07-14T08:00:00.000Z" }],
  filters: { status: "", project: "", jobType: "", search: "" },
  setFilters,
  loading: false,
  error: "",
  refresh,
  retryJob,
  cancelJob,
  activeActionJobId: ""
};

vi.mock("../state/useProductionCommandCenter.js", () => ({
  useProductionCommandCenter: () => commandCenter
}));

describe("ProductionCommandCenter", () => {
  it("shows worker health, queue totals, and permitted job actions", () => {
    render(<MemoryRouter><ProductionCommandCenter app={{ projects: [] }} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Production Command Center" })).toBeInTheDocument();
    expect(screen.getByText("Worker offline")).toBeInTheDocument();
    expect(within(screen.getByText("Failed").closest("article")).getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry failed job" }));
    expect(retryJob).toHaveBeenCalledWith("job-failed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel queued job" }));
    expect(cancelJob).toHaveBeenCalledWith("job-queued");

    expect(screen.getByRole("link", { name: "Open output for completed job" })).toHaveAttribute("href", "https://media.example.test/output.mp4");
    const processingJob = screen.getByRole("button", { name: "Open processing job details" }).closest("article");
    expect(within(processingJob).queryByRole("button", { name: /retry|cancel/i })).not.toBeInTheDocument();
  });

  it("updates the queue filters and sanitizes details before display", () => {
    render(<MemoryRouter><ProductionCommandCenter app={{ projects: [{ name: "Summer UGC" }, { name: "Clip Test" }] }} /></MemoryRouter>);

    fireEvent.click(within(screen.getByLabelText("Filter jobs by status")).getByRole("button", { name: "failed" }));
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    fireEvent.change(screen.getByLabelText("Search jobs"), { target: { value: "Summer" } });
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ search: "Summer" }));

    fireEvent.click(screen.getByRole("button", { name: "Open failed job details" }));
    expect(screen.getByRole("heading", { name: "Job details" })).toBeInTheDocument();
    expect(screen.getByText(/Campaign note/)).toBeInTheDocument();
    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.queryByText("secret-key")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-header")).not.toBeInTheDocument();
    expect(screen.queryByText("apiKey")).not.toBeInTheDocument();
    expect(screen.queryByText("authorization")).not.toBeInTheDocument();
  });
});
