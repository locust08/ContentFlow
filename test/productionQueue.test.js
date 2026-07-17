import assert from "node:assert/strict";
import test from "node:test";

import { createProductionQueue } from "../src/worker/productionQueue.js";

test("uses Cloudflare claim and lease-guarded completion when configured", async () => {
  const calls = [];
  const client = {
    claimJob: async () => ({ id: "job-1", leaseToken: "lease-1", projectName: "alpha", payload: {} }),
    completeJob: async (...args) => calls.push(["complete", ...args]),
    failJob: async (...args) => calls.push(["fail", ...args])
  };
  const queue = createProductionQueue({ cloudflareClient: client, claimLegacy: async () => null, updateLegacy: async () => {} });
  const job = await queue.claim();
  await queue.complete(job, { outputUrl: "/media/assets/asset-1", result: { ok: true } });

  assert.equal(job.id, "job-1");
  assert.deepEqual(calls[0], ["complete", "job-1", "lease-1", { outputUrl: "/media/assets/asset-1", result: { ok: true } }]);
});

test("renews Cloudflare leases without overlapping heartbeats and stops after work", async () => {
  const timers = [];
  const renewals = [];
  let finishRenewal;
  let finishWork;
  const client = {
    renewJobLease: (...args) => {
      renewals.push(args);
      return new Promise((resolve) => {
        finishRenewal = resolve;
      });
    }
  };
  const queue = createProductionQueue({
    cloudflareClient: client,
    claimLegacy: async () => null,
    updateLegacy: async () => {},
    heartbeatMs: 123,
    scheduleHeartbeat(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelHeartbeat(timer) {
      timer.cancelled = true;
    }
  });
  const job = { id: "job-1", leaseToken: "lease-1" };
  const running = queue.run(job, () => new Promise((resolve) => {
    finishWork = resolve;
  }));

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 123);
  const firstHeartbeat = timers[0].callback();
  await Promise.resolve();
  assert.deepEqual(renewals, [["job-1", "lease-1"]]);
  assert.equal(timers.length, 1, "the next heartbeat must wait for the current renewal");

  finishRenewal();
  await firstHeartbeat;
  assert.equal(timers.length, 2);

  finishWork("result");
  assert.equal(await running, "result");
  assert.equal(timers[1].cancelled, true);
  await timers[1].callback();
  assert.equal(renewals.length, 1, "no renewal may start after work has finished");
});

test("heartbeat rejection is handled and does not reject successful work", async () => {
  const timers = [];
  const heartbeatErrors = [];
  const queue = createProductionQueue({
    cloudflareClient: {
      renewJobLease: async () => {
        throw new Error("lease lost");
      }
    },
    claimLegacy: async () => null,
    updateLegacy: async () => {},
    heartbeatMs: 10,
    scheduleHeartbeat(callback) {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelHeartbeat(timer) {
      timer.cancelled = true;
    },
    onHeartbeatError(error) {
      heartbeatErrors.push(error.message);
    }
  });
  let finishWork;
  const running = queue.run(
    { id: "job-1", leaseToken: "lease-1" },
    () => new Promise((resolve) => {
      finishWork = resolve;
    })
  );

  await timers[0].callback();
  assert.deepEqual(heartbeatErrors, ["lease lost"]);
  assert.equal(timers.length, 2);

  finishWork("ok");
  assert.equal(await running, "ok");
  assert.equal(timers[1].cancelled, true);
});

test("lease renewal conflict aborts cooperative work and rejects without scheduling another heartbeat", async () => {
  const timers = [];
  const conflict = Object.assign(new Error("Job lease is no longer valid"), { status: 409 });
  const queue = createProductionQueue({
    cloudflareClient: {
      renewJobLease: async () => {
        throw conflict;
      }
    },
    claimLegacy: async () => null,
    updateLegacy: async () => {},
    heartbeatMs: 10,
    scheduleHeartbeat(callback) {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelHeartbeat(timer) {
      timer.cancelled = true;
    }
  });
  let workSignal;
  let finishWork;
  const running = queue.run(
    { id: "job-1", leaseToken: "lease-1" },
    (signal) => {
      workSignal = signal;
      return new Promise((resolve) => {
        finishWork = resolve;
      });
    }
  );

  await timers[0].callback();

  assert.equal(workSignal.aborted, true);
  assert.equal(timers.length, 1, "a lost lease must stop future renewals");
  await assert.rejects(
    running,
    (error) => error.name === "ProductionLeaseLostError"
      && error.code === "PRODUCTION_LEASE_LOST"
      && error.jobId === "job-1"
      && error.cause === conflict
  );

  finishWork("late result");
  await Promise.resolve();
});

test("ignores Cloudflare lease conflicts while reporting a processing failure", async () => {
  const conflict = Object.assign(new Error("Job lease is no longer valid"), { status: 409 });
  const queue = createProductionQueue({
    cloudflareClient: { failJob: async () => { throw conflict; } },
    claimLegacy: async () => null,
    updateLegacy: async () => {}
  });

  await assert.doesNotReject(() => queue.fail(
    { id: "job-1", leaseToken: "lease-1" },
    new Error("completion response was lost")
  ));
});

test("does not hide non-conflict Cloudflare failure-reporting errors", async () => {
  const outage = Object.assign(new Error("Cloudflare unavailable"), { status: 503 });
  const queue = createProductionQueue({
    cloudflareClient: { failJob: async () => { throw outage; } },
    claimLegacy: async () => null,
    updateLegacy: async () => {}
  });

  await assert.rejects(
    () => queue.fail({ id: "job-1", leaseToken: "lease-1" }, new Error("render failed")),
    /Cloudflare unavailable/
  );
});

test("uses the legacy queue only when Cloudflare is not configured", async () => {
  const updates = [];
  const queue = createProductionQueue({
    cloudflareClient: null,
    claimLegacy: async () => ({ id: "legacy-1", projectName: "alpha", payload: {} }),
    updateLegacy: async (...args) => updates.push(args)
  });
  const job = await queue.claim();
  const result = await queue.run(job, async () => "legacy-result");
  await queue.fail(job, new Error("render failed"));

  assert.equal(job.id, "legacy-1");
  assert.equal(result, "legacy-result");
  assert.deepEqual(updates[0], ["legacy-1", { status: "failed", error: "render failed" }]);
});
