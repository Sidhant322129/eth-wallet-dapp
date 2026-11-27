# Phase 5.4 — Backend Production Deployment Preparation Report (Render)

## 1. Production Readiness Assessment
The `eth-wallet-dapp` Node.js `22` + Express `5` backend has been hardened and verified for production deployment on Render (single free-tier web service instance, manual deploy gated behind CI):
- **Process & Binding**: `backend/package.json` defines `"start": "node server.js"`; `backend/server.js` honors `env.PORT` (validated `1..65535`), binds explicitly to `0.0.0.0`, and handles `SIGTERM` / `SIGINT` graceful shutdown.
- **Health Checks**:
  - `GET /health`: Fast, dependency-free HTTP `200` liveness endpoint (`{ status: "ok", service: "eth-wallet-backend", uptimeSeconds }`) with `Cache-Control: no-store`.
  - `GET /health/ready`: Dependency readiness endpoint checking Supabase (`transactions` head select) and Sepolia RPC (`provider.getBlockNumber()`) with a `3000ms` timeout, returning HTTP `200` (`ready`) or HTTP `503` (`degraded`) without exposing credentials or internal counts.
- **Production Security Controls**:
  - **Reverse Proxy**: `app.set("trust proxy", 1)` is enabled in `production` for Render's single TLS proxy hop, allowing accurate per-client IP rate limiting without `X-Forwarded-For` spoofing.
  - **Debug Endpoint Restriction**: `GET /api/test-db` is only mounted when `NODE_ENV !== "production"` (returns HTTP `404` in production).
  - **Headers & CORS**: Helmet enables HSTS (`max-age=31536000; includeSubDomains`) in `production`, `x-powered-by` is disabled, `Cache-Control: no-store` is applied to auth/API/health routes, and `cors` enforces an explicit `https://` `ALLOWED_ORIGINS` allowlist (no wildcards `*`).
  - **SIWE & Auth**: `env.js` enforces matching `SIWE_DOMAIN`, `https://` `SIWE_URI`, `ALLOWED_ORIGINS` membership, >=64-char `JWT_SECRET`, and `authMiddleware.js` validates `HS256` JWT claims + Supabase-backed `wallet_sessions` revocation.

## 2. Files Created or Modified
- **Created**:
  - `render.yaml` — Render Web Service Blueprint (`plan: free`, `rootDir: backend`, `buildCommand: npm ci --omit=dev`, `startCommand: npm start`, `healthCheckPath: /health`, `autoDeploy: false`, `NODE_VERSION: "22"`).
  - `backend/tests/healthReadiness.test.js` — Automated tests for `/health`, `/health/ready`, security headers, CORS rejection, and production `validateEnv` rules.
  - `docs/PHASE_5_4_DEPLOYMENT_REPORT.md` — This deployment preparation report.
- **Modified**:
  - `backend/server.js` — Added `app.disable("x-powered-by")`, production `trust proxy: 1`, `GET /health`, `GET /health/ready`, production restriction on `GET /api/test-db`, `0.0.0.0` binding, and graceful `SIGTERM`/`SIGINT` shutdown.
  - `backend/.env.example` — Added production Render/SIWE/CORS placeholder guidance comments without exposing any real values.

## 3. Actual Commands Executed & 4. Actual Test Results

| Check | Command | Result | Details |
|---|---|---|---|
| **Render YAML** | `node -e "yaml.load(fs.readFileSync('render.yaml','utf8'))"` | **PASS** | Valid YAML |
| **Backend Tests** | `cd backend && npm test` (isolated CI dummy env) | **PASS** | `16` tests, `3` suites, `16` passed, `0` failed, `0` skipped (`10.34s`) |
| **Prod Startup Probe** | `NODE_ENV=production PORT=5099 node server.js` + `fetch /health` & `/api/test-db` | **PASS** | `/health` `200`, HSTS `max-age=31536000; includeSubDomains`, CORS exact origin, `/api/test-db` `404` |
| **Frontend Lint & Build** | `cd frontend && npm run lint && npm run build` | **PASS** | `eslint .` exit `0`; `vite build` `186` modules (`2.54s`) |
| **Smart Contract Tests** | `cd contracts-project && npx hardhat compile && npx hardhat test` | **PASS** | `Nothing to compile`; `8 passing (2s)` |
| **Prod Dependency Audits** | `npm audit --omit=dev` (`backend`, `frontend`, `contracts-project`) | **PASS** | `0` production vulnerabilities in all 3 subprojects |

*(Note: Gitleaks was not executed locally because `gitleaks` is not installed on the Windows host; remote Gitleaks + CodeQL run via GitHub Actions on push.)*

## 5. Required Render Configuration & Manual Dashboard Instructions
1. Sign in to [Render Dashboard](https://dashboard.render.com) → **New +** → **Web Service** → connect `Sidhant322129/eth-wallet-dapp` (`main` branch).
2. Configure service settings:
   - **Name**: `eth-wallet-dapp-backend`
   - **Region**: Choose closest to your Supabase region
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm ci --omit=dev`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (single instance)
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: **Off** (manual deploy only after CI + Security Scanning pass)
3. Add all environment variables listed in Section 6 in Render **Environment** settings (never commit real values).

## 6. Required Production Environment Variables (`backend/config/env.js`)
*(Render automatically injects `PORT` at runtime.)*

| Variable | Required | Production Rule / Description |
|---|---|---|
| `NODE_VERSION` | Recommended (`22`) | Pins Render Node.js runtime to Node 22. |
| `NODE_ENV` | Yes (`production`) | Enables HSTS, `trust proxy: 1`, strict `https://` checks, and disables `/api/test-db`. |
| `PORT` | Auto by Render | Port bound by `server.js` (`1..65535`, default `5000` locally). |
| `SUPABASE_URL` | Yes | `https://` URL of your Supabase project. |
| `SUPABASE_SECRET_KEY` | Yes (Secret) | Supabase `sb_secret_...` or `service_role` key (publishable/anon keys rejected). |
| `SEPOLIA_RPC_URL` | Yes (Secret) | Alchemy Sepolia HTTPS RPC endpoint URL. |
| `CONTRACT_ADDRESS` | Yes | Deployed Sepolia contract (`0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67`). |
| `JWT_SECRET` | Yes (Secret) | >= 64-character high-entropy secret (`crypto.randomBytes(64).toString('hex')`). |
| `JWT_EXPIRES_IN` | Optional (`1h`) | Token lifetime matching `<number>(s|m|h|d)`. |
| `ALLOWED_ORIGINS` | Yes (Prod) | Comma-separated `https://` frontend origins (no `*`, must include `SIWE_URI` origin). |
| `SIWE_DOMAIN` | Yes (Prod) | Hostname (and port if non-standard) matching `SIWE_URI` host, without protocol/path. |
| `SIWE_URI` | Yes (Prod) | `https://` frontend URL matching `SIWE_DOMAIN` and present in `ALLOWED_ORIGINS`. |
| `SIWE_CHAIN_ID` | Optional (`11155111`) | Ethereum Sepolia chain ID (`11155111`). |
| `NONCE_TTL_SECONDS` | Optional (`300`) | Nonce validity window (`30..900` seconds). |
| `CONTRACT_DEPLOYMENT_BLOCK` | Yes | `12203912` (Sepolia deployment block for sync floor). |
| `SYNC_BLOCK_RANGE` | Optional (`10`) | RPC `eth_getLogs` chunk size (`1..10`, Alchemy free-tier safe). |
| `SYNC_MAX_BLOCKS` | Optional (`200`) | Max blocks scanned per `/api/sync` request (`>= SYNC_BLOCK_RANGE`). |
| `SYNC_CONFIRMATIONS` | Optional (`12`) | Confirmation lag before persisting synced events. |

## 7. Remaining Blockers, Dev Vulnerabilities & Credential Hygiene
- **Dev Dependency Vulnerabilities (Non-Blocking)**:
  - `frontend`: `1` high (`vite <=6.4.3`), `1` moderate (`esbuild`) — dev server only, excluded from production `dist/`.
  - `backend`: `2` moderate (`nodemon`, `minimatch`) — local `npm run dev` only, excluded from production `npm start`.
  - `contracts-project`: `7` high, `9` moderate, `20` low — Hardhat 2.30.0 dev tooling only.
  - All production dependency trees (`--omit=dev`) have **0 vulnerabilities**.
- **Credential Rotation Before Production Go-Live**:
  - Rotate `JWT_SECRET` (generate a fresh 64+ char hex secret exclusively for Render production).
  - Rotate `SUPABASE_SECRET_KEY` and `SEPOLIA_RPC_URL` (Alchemy key) if previously shared across local/dev environments.
  - `.env` files remain excluded by `.gitignore` and untracked in Git.
- **Deployment Blockers**:
  - Frontend production URL (`ALLOWED_ORIGINS` / `SIWE_URI` / `SIWE_DOMAIN`) must be finalized (Phase 5.5) so CORS and SIWE match the live frontend origin.
  - Free-tier Render services spin down after inactivity, causing cold-start latency on the first request.

## 8. Deployment and Rollback Instructions
- **Deploy (after explicit approval to commit & push)**:
  1. Commit and push Phase 5.4 changes to `main` and confirm all GitHub Actions (`CI`, `CodeQL`, `Security Scanning`) pass.
  2. In Render Dashboard, verify environment variables and click **Manual Deploy → Deploy latest commit**.
  3. Verify `https://<render-service>.onrender.com/health` returns `200` and `https://<render-service>.onrender.com/health/ready` returns `200` (`database: "up"`, `blockchainRpc: "up"`), and confirm `/api/test-db` returns `404`.
- **Rollback**:
  - In Render Dashboard → **Events / Deploys**, select the previous healthy deploy and click **Rollback to this deploy**, or revert the commit on `main` and trigger a manual deploy after CI passes.
