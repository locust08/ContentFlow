import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";

const emptySummary = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, total: 0 };

export function useProductionCommandCenter() {
  const [filters, setFilters] = useState({ status: "", project: "", jobType: "", search: "" });
  const [data, setData] = useState({ jobs: [], summary: emptySummary, workers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingActions, setPendingActions] = useState({});
  const mountedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const refreshControllerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshControllerRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequenceRef.current;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    try {
      const result = await api(`/api/production-jobs?${params.toString()}`, { signal: controller.signal });
      if (!mountedRef.current || requestId !== requestSequenceRef.current || controller.signal.aborted) return result;
      setData({ jobs: result.jobs || [], summary: { ...emptySummary, ...(result.summary || {}) }, workers: result.workers || [] });
      setError("");
      setLoading(false);
      return result;
    } catch (reason) {
      if (controller.signal.aborted || reason?.name === "AbortError") return undefined;
      if (mountedRef.current && requestId === requestSequenceRef.current) {
        setError(reason.message || "Production jobs could not be loaded.");
        setLoading(false);
      }
      throw reason;
    } finally {
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
    }
  }, [filters]);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = window.setInterval(() => { refresh().catch(() => {}); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runJobAction = useCallback(async (jobId, action) => {
    const actionKey = `${jobId}:${action}`;
    setPendingActions((current) => ({ ...current, [actionKey]: true }));
    try {
      await api(`/api/production-jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
      await refresh();
    } catch (reason) {
      if (mountedRef.current) setError(reason.message || `Unable to ${action} this job.`);
      throw reason;
    } finally {
      if (mountedRef.current) setPendingActions((current) => {
        const { [actionKey]: ignored, ...remaining } = current;
        return remaining;
      });
    }
  }, [refresh]);

  return {
    ...data,
    filters,
    setFilters,
    loading,
    error,
    refresh,
    pendingActions,
    retryJob: (jobId) => runJobAction(jobId, "retry"),
    cancelJob: (jobId) => runJobAction(jobId, "cancel")
  };
}
