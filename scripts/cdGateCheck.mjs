import fs from "node:fs";

const DOC_ONLY_PATH_RE = /^(README\.md|docs\/.*|.*\.md)$/i;

export function isNonRuntimeDocPath(filename) {
  return typeof filename === "string" && DOC_ONLY_PATH_RE.test(filename);
}

/**
 * Evaluate whether CD should deploy the given commit SHA on main.
 * Distinguishes no-op/skipped CD runs from actual completed deployments
 * and skips documentation-only changes relative to the last deployed runtime SHA.
 */
export async function evaluateCdGate({
  repo,
  sha,
  branch,
  triggerEvent,
  eventName,
  token,
  fetchImpl = fetch,
}) {
  if (branch !== "main" || triggerEvent === "pull_request") {
    return {
      shouldDeploy: false,
      reason: `Skipping deploy: branch=${branch}, event=${triggerEvent}`,
    };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "eth-wallet-dapp-cd",
  };

  // 1. Verify sha is still the current tip of main (prevents stale overwrites)
  const refRes = await fetchImpl(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers });
  const refData = await refRes.json();
  if (!refRes.ok || refData.object?.sha !== sha) {
    return {
      shouldDeploy: false,
      reason: `Skipping stale commit ${sha}; current main tip is ${refData.object?.sha}`,
    };
  }

  // 2. Verify CI, Security Scanning, and CodeQL all completed with success on this exact sha
  const runsRes = await fetchImpl(
    `https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`,
    { headers }
  );
  const runsData = await runsRes.json();
  const runs = runsData.workflow_runs || [];
  const required = ["CI", "Security Scanning", "CodeQL"];

  for (const wf of required) {
    const match = runs.find(
      (r) => r.name === wf && r.status === "completed" && r.conclusion === "success"
    );
    if (!match) {
      const current = runs.find((r) => r.name === wf);
      return {
        shouldDeploy: false,
        failDispatch: eventName === "workflow_dispatch",
        reason: `Gate not satisfied for ${wf}: status=${current?.status || "missing"}, conclusion=${current?.conclusion || "none"}`,
      };
    }
  }

  // 3. Prevent duplicate CD deployment only if a prior CD run ACTUALLY deployed (not skipped no-op)
  const priorCdRuns = runs.filter((r) => r.name === "CD" && r.status === "completed");
  for (const cdRun of priorCdRuns) {
    const jobsRes = await fetchImpl(
      `https://api.github.com/repos/${repo}/actions/runs/${cdRun.id}/jobs`,
      { headers }
    );
    const jobsData = await jobsRes.json();
    const jobs = jobsData.jobs || [];
    const deployedVercel = jobs.some(
      (j) =>
        j.name === "Deploy Frontend (Vercel)" &&
        j.status === "completed" &&
        j.conclusion === "success"
    );
    if (deployedVercel) {
      return {
        shouldDeploy: false,
        reason: `CD already deployed ${sha} (run ${cdRun.id}); skipping duplicate.`,
      };
    }
  }

  // 4. Skip docs-only changes compared against the last successfully deployed runtime commit
  const cdHistRes = await fetchImpl(
    `https://api.github.com/repos/${repo}/actions/workflows/cd.yml/runs?branch=main&status=completed&per_page=20`,
    { headers }
  );
  let baselineSha = null;
  if (cdHistRes.ok) {
    const cdHist = await cdHistRes.json();
    for (const histRun of cdHist.workflow_runs || []) {
      if (histRun.head_sha === sha) continue;
      const jobsRes = await fetchImpl(
        `https://api.github.com/repos/${repo}/actions/runs/${histRun.id}/jobs`,
        { headers }
      );
      if (!jobsRes.ok) continue;
      const jobsData = await jobsRes.json();
      const deployedBoth = ["Deploy Backend (Render)", "Deploy Frontend (Vercel)"].every((name) =>
        (jobsData.jobs || []).some(
          (j) => j.name === name && j.status === "completed" && j.conclusion === "success"
        )
      );
      if (deployedBoth) {
        baselineSha = histRun.head_sha;
        break;
      }
    }
  }

  if (baselineSha) {
    const cmpRes = await fetchImpl(
      `https://api.github.com/repos/${repo}/compare/${baselineSha}...${sha}`,
      { headers }
    );
    if (cmpRes.ok) {
      const cmpData = await cmpRes.json();
      const files = cmpData.files || [];
      // Only skip if file list is non-empty, not truncated (< 300), and all files are docs/screenshots
      if (files.length > 0 && files.length < 300 && files.every((f) => isNonRuntimeDocPath(f.filename))) {
        return {
          shouldDeploy: false,
          reason: `Skipping CD: only documentation/screenshot files changed since deployed baseline ${baselineSha}.`,
        };
      }
    }
  }

  return {
    shouldDeploy: true,
    reason: `All required gates passed for main tip ${sha}.`,
  };
}

// CLI entrypoint for GitHub Actions
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cdGateCheck.mjs")) {
  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    const result = await evaluateCdGate({
      repo: process.env.GITHUB_REPOSITORY,
      sha: process.env.RUN_SHA,
      branch: process.env.RUN_BRANCH,
      triggerEvent: process.env.RUN_EVENT,
      eventName: process.env.EVENT_NAME,
      token: process.env.GITHUB_TOKEN,
    });
    console.log(result.reason);
    fs.appendFileSync(outFile, `sha=${process.env.RUN_SHA}\n`);
    fs.appendFileSync(outFile, `should_deploy=${result.shouldDeploy ? "true" : "false"}\n`);
    if (result.failDispatch) {
      process.exit(1);
    }
  }
}
