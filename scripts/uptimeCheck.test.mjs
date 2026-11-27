import test from "node:test";
import assert from "node:assert/strict";
import { probeWithColdStartTolerance, runUptimeCheck } from "./uptimeCheck.mjs";

test("probeWithColdStartTolerance retries 502/503 cold-start responses and recovers", async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    if (calls < 3) {
      return { status: 503, text: async () => "Cold starting" };
    }
    return { status: 200, text: async () => '{"status":"ok"}' };
  };

  const res = await probeWithColdStartTolerance("https://example.invalid/health", {
    retries: 3,
    retryDelayMs: 5,
    fetchImpl: mockFetch,
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.attempts, 3);
});

test("probeWithColdStartTolerance fails cleanly when retries are exhausted", async () => {
  const mockFetch = async () => {
    throw new Error("Network unreachable");
  };

  const res = await probeWithColdStartTolerance("https://example.invalid/health", {
    retries: 2,
    retryDelayMs: 5,
    fetchImpl: mockFetch,
  });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 2);
  assert.match(res.error, /Network unreachable/);
});

test("runUptimeCheck reports degraded when /health/ready has database down", async () => {
  const mockFetch = async (url) => {
    if (url.endsWith("/health/ready")) {
      return {
        status: 503,
        text: async () => JSON.stringify({ status: "degraded", dependencies: { database: "down", blockchainRpc: "up" } }),
      };
    }
    return { status: 200, text: async () => '{"status":"ok"}' };
  };

  const res = await runUptimeCheck({ probeOpts: { retries: 1, retryDelayMs: 5, fetchImpl: mockFetch } });
  assert.equal(res.ok, false);
  assert.equal(res.readyOk, false);
  assert.match(res.summary, /DEGRADED/);
});
