import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";

const emptySummary = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, total: 0 };

export function useProductionCommandCenter() {
  const [filters, setFilters] = useState({ status: "", project: "", jobType: "", search: "" });
  const [data, setData] = useState({ jobs: [], summary: emptySummary, workers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeActionJobId, setActiveActionJobId] = useState("");

  const refresh = useCallback(async () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    const result = await api(`/api/production-jobs?${params.toString()}`);
    setData({ jobs: result.jobs || [], summary: { ...emptySummary, ...(result.summary || {}) }, workers: result.workers || [] });
    setError("");
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    refresh().catch((reason) => {
      setError(reason.message || "Production jobs could not be loaded.");
      setLoading(false);
    });
    const timer = window.setInterval(() => {
      refresh().catch((reason) => setError(reason.message || "Production jobs could not be loaded."));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runJobAction = useCallback(async (jobId, action) => {
    setActiveActionJobId(jobId);
    try {
      await api(`/api/production-jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
      await refresh();
    } catch (reason) {
      setError(reason.message || `Unable to ${action} this job.`);
      throw reason;
    } finally {
      setActiveActionJobId("");
    }
  }, [refresh]);

  return {
    ...data,
    filters,
    setFilters,
    loading,
    error,
    refresh,
    activeActionJobId,
    retryJob: (jobId) => runJobAction(jobId, "retry"),
    cancelJob: (jobId) => runJobAction(jobId, "cancel")
  };
}
