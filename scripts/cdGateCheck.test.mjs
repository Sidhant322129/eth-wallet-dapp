import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCdGate } from "./cdGateCheck.mjs";

function createMockFetch({ mainTip = "sha-1", workflowRuns = [], cdJobsByRunId = {} }) {
  return async (url) => {
    if (url.endsWith("/git/ref/heads/main")) {
      return { ok: true, json: async () => ({ object: { sha: mainTip } }) };
    }
    if (url.includes("/actions/runs?head_sha=")) {
      return { ok: true, json: async () => ({ workflow_runs: workflowRuns }) };
    }
    const jobsMatch = url.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if (jobsMatch) {
      const id = Number(jobsMatch[1]);
      return { ok: true, json: async () => ({ jobs: cdJobsByRunId[id] || [] }) };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

const baseArgs = {
  repo: "Sidhant322129/eth-wallet-dapp",
  sha: "sha-1",
  branch: "main",
  triggerEvent: "push",
  eventName: "workflow_run",
  token: "dummy-token",
};

test("Gate blocks when CI failed", async () => {
  const res = await evaluateCdGate({
    ...baseArgs,
    fetchImpl: createMockFetch({
      workflowRuns: [
        { id: 1, name: "CI", status: "completed", conclusion: "failure" },
        { id: 2, name: "Security Scanning", status: "completed", conclusion: "success" },
        { id: 3, name: "CodeQL", status: "completed", conclusion: "success" },
      ],
    }),
  });
  assert.equal(res.shouldDeploy, false);
});

test("Gate blocks when CodeQL is still in_progress", async () => {
  const res = await evaluateCdGate({
    ...baseArgs,
    fetchImpl: createMockFetch({
      workflowRuns: [
        { id: 1, name: "CI", status: "completed", conclusion: "success" },
        { id: 2, name: "Security Scanning", status: "completed", conclusion: "success" },
        { id: 3, name: "CodeQL", status: "in_progress", conclusion: null },
      ],
    }),
  });
  assert.equal(res.shouldDeploy, false);
});

test("Gate blocks stale commit when main moved ahead", async () => {
  const res = await evaluateCdGate({
    ...baseArgs,
    fetchImpl: createMockFetch({
      mainTip: "sha-2",
      workflowRuns: [
        { id: 1, name: "CI", status: "completed", conclusion: "success" },
        { id: 2, name: "Security Scanning", status: "completed", conclusion: "success" },
        { id: 3, name: "CodeQL", status: "completed", conclusion: "success" },
      ],
    }),
  });
  assert.equal(res.shouldDeploy, false);
});

test("Gate does NOT mistake an earlier skipped no-op CD run for a real deployment", async () => {
  const res = await evaluateCdGate({
    ...baseArgs,
    fetchImpl: createMockFetch({
      workflowRuns: [
        { id: 1, name: "CI", status: "completed", conclusion: "success" },
        { id: 2, name: "Security Scanning", status: "completed", conclusion: "success" },
        { id: 3, name: "CodeQL", status: "completed", conclusion: "success" },
        { id: 4, name: "CD", status: "completed", conclusion: "success" },
      ],
      cdJobsByRunId: {
        4: [
          { name: "Verify Required Gates & Commit Tip", status: "completed", conclusion: "success" },
          { name: "Deploy Backend (Render)", status: "completed", conclusion: "skipped" },
          { name: "Deploy Frontend (Vercel)", status: "completed", conclusion: "skipped" },
        ],
      },
    }),
  });
  assert.equal(res.shouldDeploy, true);
});

test("Gate blocks duplicate deployment when an earlier CD run actually deployed Vercel", async () => {
  const res = await evaluateCdGate({
    ...baseArgs,
    fetchImpl: createMockFetch({
      workflowRuns: [
        { id: 1, name: "CI", status: "completed", conclusion: "success" },
        { id: 2, name: "Security Scanning", status: "completed", conclusion: "success" },
        { id: 3, name: "CodeQL", status: "completed", conclusion: "success" },
        { id: 4, name: "CD", status: "completed", conclusion: "success" },
      ],
      cdJobsByRunId: {
        4: [
          { name: "Deploy Backend (Render)", status: "completed", conclusion: "success" },
          { name: "Deploy Frontend (Vercel)", status: "completed", conclusion: "success" },
        ],
      },
    }),
  });
  assert.equal(res.shouldDeploy, false);
});
