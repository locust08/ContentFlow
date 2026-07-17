const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000;

export class ProductionLeaseLostError extends Error {
  constructor(job, cause) {
    super(`Production lease lost for job ${job.id}.`, { cause });
    this.name = "ProductionLeaseLostError";
    this.code = "PRODUCTION_LEASE_LOST";
    this.jobId = job.id;
  }
}

export function createProductionQueue({
  cloudflareClient,
  claimLegacy,
  updateLegacy,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  scheduleHeartbeat = setTimeout,
  cancelHeartbeat = clearTimeout,
  onHeartbeatError = (error, job) => console.warn(`[worker] heartbeat failed for ${job.id}: ${error.message}`)
}) {
  return {
    async claim() {
      return cloudflareClient ? cloudflareClient.claimJob() : claimLegacy();
    },
    async run(job, work) {
      if (!cloudflareClient || typeof cloudflareClient.renewJobLease !== "function") {
        return work();
      }

      let stopped = false;
      let timer;
      let heartbeat = Promise.resolve();
      const abortController = new AbortController();
      let rejectLeaseLoss;
      const leaseLoss = new Promise((_, reject) => {
        rejectLeaseLoss = reject;
      });
      const scheduleNext = () => {
        timer = scheduleHeartbeat(() => {
          timer = undefined;
          if (stopped) return undefined;
          heartbeat = Promise.resolve()
            .then(() => cloudflareClient.renewJobLease(job.id, job.leaseToken))
            .catch((error) => {
              if (error?.status === 409) {
                stopped = true;
                const leaseLostError = new ProductionLeaseLostError(job, error);
                abortController.abort(leaseLostError);
                rejectLeaseLoss(leaseLostError);
                return;
              }
              try {
                onHeartbeatError(error, job);
              } catch {
                // Error reporting must not turn a handled heartbeat failure into a rejection.
              }
            })
            .finally(() => {
              if (!stopped) scheduleNext();
            });
          return heartbeat;
        }, heartbeatMs);
      };

      scheduleNext();
      let workPromise;
      try {
        workPromise = Promise.resolve(work(abortController.signal));
      } catch (error) {
        workPromise = Promise.reject(error);
      }
      try {
        return await Promise.race([workPromise, leaseLoss]);
      } finally {
        stopped = true;
        if (timer !== undefined) {
          cancelHeartbeat(timer);
          timer = undefined;
        }
        await heartbeat;
      }
    },
    async complete(job, updates) {
      if (cloudflareClient) return cloudflareClient.completeJob(job.id, job.leaseToken, updates);
      return updateLegacy(job.id, { status: "completed", ...updates });
    },
    async fail(job, error) {
      const message = error instanceof Error ? error.message : String(error || "Production job failed.");
      if (cloudflareClient) {
        try {
          return await cloudflareClient.failJob(job.id, job.leaseToken, message);
        } catch (reportingError) {
          if (reportingError?.status === 409) return null;
          throw reportingError;
        }
      }
      return updateLegacy(job.id, { status: "failed", error: message });
    }
  };
}
