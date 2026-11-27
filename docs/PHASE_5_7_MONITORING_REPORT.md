# Phase 5.7 — Monitoring and Observability Report

## 1. Monitoring Architecture
Phase 5.7 adds lightweight, zero-cost production observability tailored to Vercel + Render + Supabase + Ethereum Sepolia:
- **Backend Structured JSON Logging (`backend/utils/logger.js`, `backend/middleware/requestLogger.js`)**:
  - Assigns or validates `X-Request-Id` (`^[a-zA-Z0-9_-]{8,64}$`, otherwise `crypto.randomUUID()`) on every request and exposes it via `X-Request-Id` response header.
  - Emits single-line JSON logs (`timestamp`, `level`, `service`, `event`, `requestId`, `method`, `path`, `statusCode`, `durationMs`).
  - Automatically redacts sensitive keys (`authorization`, `cookie`, `token`, `jwt`, `secret`, `password`, `privateKey`, `apiKey`, `signature`, `supabase_secret_key`, `sepolia_rpc_url`, `jwt_secret`), Bearer/JWT strings, `sb_secret_` keys, Alchemy `/v2/...` credentials, 65-byte signatures, and masks wallet addresses (`0x1234...5678`).
  - Logs `server_started`, `server_shutdown`, `rate_limit_exceeded`, `auth_session_validation_failed`, `readiness_db_failed`, `readiness_rpc_failed`, `unhandled_server_error`, `unhandledRejection`, and `uncaughtException`.
- **Health & Readiness Endpoints (`backend/server.js`)**:
  - `GET /health`: Fast, dependency-free HTTP `200` liveness check.
  - `GET /health/ready`: Bounded `3000ms` Supabase + Sepolia RPC readiness check (`200` `ready` or `503` `degraded`), exposing zero secrets or internal diagnostics.
- **Automated Uptime Monitoring (`.github/workflows/uptime.yml`)**:
  - Runs every 6 hours (`cron: "17 */6 * * *"`) and via `workflow_dispatch` with `contents: read` permissions.
  - Probes `https://eth-wallet-dapp-eta.vercel.app`, `https://eth-wallet-dapp-backend.onrender.com/health`, and `/health/ready` with bounded cold-start retries (3×, 15s backoff) and writes latency metrics to `$GITHUB_STEP_SUMMARY`. Does not trigger CD or bypass free-tier sleep.
- **Frontend Error Boundary (`frontend/src/components/ErrorBoundary.jsx`, `frontend/src/main.jsx`)**:
  - Catches uncaught React render errors and renders an accessible recovery screen without exposing stack traces.
- **External Error Tracking (Sentry — Pending Configuration)**:
  - Not enabled yet because it requires external Sentry account creation and `VITE_SENTRY_DSN` / `SENTRY_DSN` secrets. Setup: create a Sentry project, add `VITE_SENTRY_DSN` in Vercel and `SENTRY_DSN` in Render, and initialize `@sentry/react` / `@sentry/node` with `beforeSend` header/token scrubbing.

## 2. Actual Test Results
- **Backend Suite (`cd backend && npm test`)**: **PASS** — `19` tests, `4` suites, `19` passed, `0` failed, `0` skipped (`11.17s`), including `monitoring.test.js` (redaction, `X-Request-Id` generation/propagation/sanitization, and `503` degraded readiness).
- **Frontend Suite**: `npm run lint` (`0` errors), `npm test` (`7/7` passed), `npm run build` (`188` modules, `1.80s`), `npm run test:browser` (`3/3` Playwright tests passed, `6.10s`).
- **Smart Contracts**: `npx hardhat test` (`8 passing (981ms)`).
- **Uptime & CD YAML**: `.github/workflows/uptime.yml` and `.github/workflows/cd.yml` validated with `js-yaml`.

## 3. Operational Limitations & Incident Response
- **Limitations**: Free-tier Render logs are ephemeral in the Render dashboard; Render free tier sleeps after inactivity (~30–50s cold start); Sentry external alerting is pending DSN configuration.
- **Incident Response**:
  1. Check `.github/workflows/uptime.yml` summary and GitHub email/notifications for target (`Frontend`, `/health`, `/health/ready`).
  2. Correlate failing requests in Render logs using `X-Request-Id`.
  3. If `database: "down"`, inspect Supabase status/RLS; if `blockchainRpc: "down"`, inspect Alchemy Sepolia quota/status.
  4. For bad releases, roll back via Render Deploys or Vercel Deployments as documented in `docs/PHASE_5_6_CD_REPORT.md`.
