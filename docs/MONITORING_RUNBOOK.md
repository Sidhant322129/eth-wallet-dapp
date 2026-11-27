# Monitoring & Incident Response Runbook

## Observability Components
- **Backend Structured Logging (`backend/utils/logger.js`, `backend/middleware/requestLogger.js`)**: Single-line JSON logs with `X-Request-Id` correlation, latency (`durationMs`), status codes, and automatic redaction of JWTs, Bearer tokens, Supabase keys, Alchemy URLs, signatures, and masked wallets (`0x1234...5678`).
- **Health Endpoints**: `GET /health` (process liveness) and `GET /health/ready` (`3000ms` bounded check for Supabase + Sepolia RPC).
- **Scheduled Uptime (`.github/workflows/uptime.yml`)**: Runs every 6 hours (`17 */6 * * *`) with cold-start retry tolerance (`3 × 15s`) and latency summary in `$GITHUB_STEP_SUMMARY`.
- **Frontend `ErrorBoundary`**: Catches uncaught React render errors with a reload recovery UI.
- **Optional Sentry**: Pending external Sentry account/DSN configuration (`VITE_SENTRY_DSN`, `SENTRY_DSN`).

## Incident Triage
1. **Uptime Failure**: Inspect `Uptime Monitoring` job logs in GitHub Actions to isolate Frontend vs `/health` vs `/health/ready`.
2. **Backend 5xx**: Correlate `X-Request-Id` in Render logs (`unhandled_server_error`, `readiness_db_failed`, `readiness_rpc_failed`).
3. **Database / RPC Degraded (`503`)**: Check Supabase project status or Alchemy Sepolia RPC quota/connectivity.
4. **Bad Release**: Roll back Render/Vercel per `docs/DEPLOYMENT_GUIDE.md`.
