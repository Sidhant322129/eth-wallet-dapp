# Monitoring & Incident Response Runbook

## Observability Components
- **Backend Structured Logging (`backend/utils/logger.js`, `backend/middleware/requestLogger.js`)**: Single-line JSON logs with `X-Request-Id` correlation, latency (`durationMs`), status codes, and automatic redaction of JWTs, Bearer tokens, Supabase keys, Alchemy URLs, private keys, signatures, and masked wallets (`0x1234...5678`).
- **Health Endpoints**: `GET /health` (`200` liveness) and `GET /health/ready` (`3000ms` bounded check for Supabase + Sepolia RPC).
- **Scheduled Uptime (`scripts/uptimeCheck.mjs`, `.github/workflows/uptime.yml`)**: Runs every 6 hours (`17 */6 * * *`) or via manual `workflow_dispatch` with cold-start retry tolerance (`3 × 15s`) and latency summary in `$GITHUB_STEP_SUMMARY`.
- **Frontend `ErrorBoundary`**: Catches uncaught React render errors with a reload recovery UI.
- **Optional Sentry**: Excluded from mandatory scope; documented as an optional future enhancement pending external DSN configuration.

## Incident Triage & Notifications
1. **GitHub Failure Notifications**: Enable GitHub Actions email/web notifications in GitHub Account Settings → **Notifications → Actions** for failed `Uptime Monitoring` or `CD` runs.
2. **Uptime Failure**: Inspect `Uptime Monitoring` job logs in GitHub Actions to isolate Frontend vs `/health` vs `/health/ready`.
3. **Backend 5xx**: Correlate `X-Request-Id` in Render logs (`unhandled_server_error`, `readiness_db_failed`, `readiness_rpc_failed`).
4. **Database / RPC Degraded (`503`)**: Check Supabase project status or Alchemy Sepolia RPC quota/connectivity.
5. **Bad Release**: Roll back Render/Vercel per `docs/DEPLOYMENT_GUIDE.md`.
