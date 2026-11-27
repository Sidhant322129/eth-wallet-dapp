import fs from "node:fs";

export async function probeWithColdStartTolerance(
  url,
  { expectedStatus = 200, retries = 3, retryDelayMs = 15000, timeoutMs = 35000, fetchImpl = fetch } = {}
) {
  for (let i = 1; i <= retries; i++) {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (res.status === expectedStatus) {
        return { ok: true, status: res.status, latencyMs, attempts: i, body: await res.text() };
      }
      if (res.status >= 502 && res.status <= 504 && i < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      return { ok: false, status: res.status, latencyMs, attempts: i };
    } catch (err) {
      clearTimeout(timer);
      if (i === retries) {
        return { ok: false, status: 0, latencyMs: Date.now() - start, attempts: i, error: err.message };
      }
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}

export async function runUptimeCheck({
  frontendUrl = "https://eth-wallet-dapp-eta.vercel.app",
  backendUrl = "https://eth-wallet-dapp-backend.onrender.com",
  probeOpts = {},
} = {}) {
  const fe = await probeWithColdStartTolerance(frontendUrl, probeOpts);
  const beHealth = await probeWithColdStartTolerance(`${backendUrl}/health`, probeOpts);
  const beReady = await probeWithColdStartTolerance(`${backendUrl}/health/ready`, probeOpts);

  let readyOk = false;
  let deps = {};
  if (beReady.ok) {
    try {
      const parsed = JSON.parse(beReady.body);
      deps = parsed.dependencies || {};
      readyOk = parsed.status === "ready" && deps.database === "up" && deps.blockchainRpc === "up";
    } catch {
      readyOk = false;
    }
  }

  const allHealthy = Boolean(fe.ok && beHealth.ok && readyOk);
  const summary = [
    "### Production Uptime Check",
    "| Target | Status | Latency | Attempts | Details |",
    "|---|---|---|---|---|",
    `| Frontend (Vercel) | ${fe.ok ? "UP" : "DOWN"} (${fe.status}) | ${fe.latencyMs}ms | ${fe.attempts} | HTTPS check |`,
    `| Backend /health (Render) | ${beHealth.ok ? "UP" : "DOWN"} (${beHealth.status}) | ${beHealth.latencyMs}ms | ${beHealth.attempts} | Process liveness |`,
    `| Backend /health/ready | ${readyOk ? "UP" : "DEGRADED"} (${beReady.status}) | ${beReady.latencyMs}ms | ${beReady.attempts} | ${JSON.stringify(deps)} |`,
  ].join("\n");

  return { ok: allHealthy, fe, beHealth, beReady, readyOk, deps, summary };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("uptimeCheck.mjs")) {
  const result = await runUptimeCheck();
  console.log(result.summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.summary + "\n");
  }
  if (!result.ok) {
    process.exit(1);
  }
}
