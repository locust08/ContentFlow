import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
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
      payload: {
        title: "Campaign note",
        apiKey: "secret-key",
        token: "secret-token",
        authorization: "secret-header",
        notes: "Bearer private-credential-value",
        sessionReference: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature-value",
        requestReference: "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK",
        integrationNote: "secret-token",
        configurationNote: "apiKey=abc",
        connectionDetail: "authorization: xyz",
        auditDetail: "password=not-for-display",
        safeNote: "Approved campaign guidance"
      },
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
    expect(screen.getByText(/Approved campaign guidance/)).toBeInTheDocument();
    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.queryByText("secret-key")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-header")).not.toBeInTheDocument();
    expect(screen.queryByText("apiKey")).not.toBeInTheDocument();
    expect(screen.queryByText("authorization")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bearer private-credential-value/)).not.toBeInTheDocument();
    expect(screen.queryByText(/eyJhbGciOiJIUzI1NiJ9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-abcdefghijklmnopqrstuvwxyz/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/apiKey=abc/)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorization: xyz/)).not.toBeInTheDocument();
    expect(screen.queryByText(/password=not-for-display/)).not.toBeInTheDocument();
  });

  it("uses all worker heartbeats to report a healthy command center", () => {
    const originalWorkers = commandCenter.workers;
    commandCenter.workers = [
      { workerId: "worker-stale", workerName: "Old workstation", health: { status: "offline" }, lastSeenAt: "2026-07-14T08:00:00.000Z" },
      { workerId: "worker-live", workerName: "Studio workstation", health: { status: "online" }, lastSeenAt: "2026-07-14T08:01:00.000Z" }
    ];

    render(<MemoryRouter><ProductionCommandCenter app={{ projects: [] }} /></MemoryRouter>);

    expect(screen.getByText("Worker online")).toBeInTheDocument();
    expect(screen.getByText("1 online · 0 busy · 1 offline")).toBeInTheDocument();
    commandCenter.workers = originalWorkers;
  });

  it("focuses details, closes with Escape, and restores the opener focus", () => {
    render(<MemoryRouter><ProductionCommandCenter app={{ projects: [] }} /></MemoryRouter>);
    const opener = screen.getByRole("button", { name: "Open failed job details" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Job details" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Job details" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function loadRealCommandCenterHook(apiMock) {
  vi.resetModules();
  vi.doUnmock("../state/useProductionCommandCenter.js");
  vi.doMock("../api/client.js", () => ({ api: apiMock }));
  return import("../state/useProductionCommandCenter.js");
}

describe("useProductionCommandCenter", () => {
  it("keeps concurrent job actions pending independently", async () => {
    const apiMock = vi.fn().mockResolvedValueOnce({ jobs: [], summary: {}, workers: [] });
    const retry = deferred();
    const cancel = deferred();
    apiMock.mockImplementationOnce(() => retry.promise).mockImplementationOnce(() => cancel.promise).mockResolvedValue({ jobs: [], summary: {}, workers: [] });
    const { useProductionCommandCenter } = await loadRealCommandCenterHook(apiMock);
    const { result } = renderHook(() => useProductionCommandCenter());
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));

    let retryPromise;
    let cancelPromise;
    act(() => {
      retryPromise = result.current.retryJob("job-failed");
      cancelPromise = result.current.cancelJob("job-queued");
    });
    expect(result.current.pendingActions).toEqual({ "job-failed:retry": true, "job-queued:cancel": true });

    await act(async () => { retry.resolve({ job: {} }); await retryPromise; });
    expect(result.current.pendingActions).toEqual({ "job-queued:cancel": true });
    await act(async () => { cancel.resolve({ job: {} }); await cancelPromise; });
    expect(result.current.pendingActions).toEqual({});
  });

  it("ignores stale refresh responses and stops polling after unmount", async () => {
    vi.useFakeTimers();
    const apiMock = vi.fn();
    const first = deferred();
    const latest = deferred();
    apiMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => latest.promise);
    const { useProductionCommandCenter } = await loadRealCommandCenterHook(apiMock);
    const { result, unmount } = renderHook(() => useProductionCommandCenter());
    await act(async () => { await Promise.resolve(); });
    expect(apiMock).toHaveBeenCalledTimes(1);

    act(() => result.current.setFilters({ status: "", project: "", jobType: "", search: "latest" }));
    await act(async () => { await Promise.resolve(); });
    expect(apiMock).toHaveBeenCalledTimes(2);
    await act(async () => { latest.resolve({ jobs: [{ id: "latest" }], summary: {}, workers: [] }); });
    expect(result.current.jobs).toEqual([{ id: "latest" }]);
    await act(async () => { first.resolve({ jobs: [{ id: "stale" }], summary: {}, workers: [] }); });
    expect(result.current.jobs).toEqual([{ id: "latest" }]);

    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(apiMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
