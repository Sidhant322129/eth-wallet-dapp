# Phase 5.6 — Continuous Deployment (CD) and Automated Production Smoke Testing Report

## 1. Deployment & Verification Summary (Commit `751a9e9` + `browser-tests` fix)
- **Verified Deployed Commit SHA**: `751a9e92e11b5ea7f42a4f98360a3d5b114415d3` (`751a9e9`)
- **Production URLs**:
  - Frontend (Vercel): `https://eth-wallet-dapp-eta.vercel.app` (bundle `/assets/index-B_aNPZCq.js`)
  - Backend (Render): `https://eth-wallet-dapp-backend.onrender.com`
- **Provider Auto-Deploy Protection**:
  - Render: `render.yaml` sets `autoDeployTrigger: off`.
  - Vercel: `frontend/vercel.json` sets `"git": { "deploymentEnabled": false }`.

## 2. GitHub Actions Results for `751a9e9`
| Workflow | Run ID / Link | Status | Jobs |
|---|---|---|---|
| **CI** | [45993256606](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45993256606) | **success** | `Frontend CI`, `Backend CI`, `Smart Contract CI` (`completed/success`) |
| **Security Scanning** | [45993256670](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45993256670) | **success** | `Secret Scan (Gitleaks)`, `Dependency Audit (Frontend/Backend/Contracts)` (`completed/success`) |
| **CodeQL** | [45993256551](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45993256551) | **success** | `Analyze (javascript-typescript)` (`completed/success`) |
| **CD (Gate Wait 1)** | [45993309140](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45993309140) | no-op skip | `verify-gates` `success`; deploy jobs `skipped` (gates incomplete) |
| **CD (Gate Wait 2)** | [45993318809](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45993318809) | no-op skip | `verify-gates` `success`; deploy jobs `skipped` (gates incomplete) |
| **CD (Active Rollout)** | [45993420692](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45993420692) | partial | `verify-gates` (`success`), `deploy-render` (`success`), `deploy-vercel` (`success`), `smoke-test` (`success`), `browser-tests` (`failure`: missing `npm run build` before `vite preview`) |

- **Root Cause & Fix for `browser-tests`**: `frontend/dist/` is gitignored, so `vite preview` required `npm run build` in the `browser-tests` job of `.github/workflows/cd.yml`. Fixed and carried into the next gated CD rollout alongside Phase 5.7.

## 3. Gate Simulation, Audits & Live Smoke Tests
- **Gate Simulation (`scripts/cdGateCheck.test.mjs`)**: `5/5` passed (`193.84ms`) — verifies failed CI blocks, in-progress CodeQL blocks, stale `main` SHA blocks, earlier skipped no-op CD runs do NOT block real deploys, and completed `deploy-vercel` runs prevent duplicate deploys.
- **Production Audits (`npm audit --omit=dev`)**: `0` vulnerabilities across `frontend`, `backend`, and `contracts-project`.
- **Live Production Smoke Tests (`scripts/smokeTestProduction.mjs`)**: `22/22` passed (`0` failed) — HTTPS `200`, bundle URL/contract verified, `0` secrets in bundle, `/health` `200`, `/health/ready` `200` (`database:"up"`, `blockchainRpc:"up"`), CORS allow/reject, Helmet headers, `/api/test-db` `404`, `401` unauth/invalid JWT, ephemeral wallet SIWE auth, replay `401`, cross-wallet `403`, history `200`, logout `200` + revocation `401`, Sepolia `chainId=11155111`, bytecode `2549B`, balance `0.0575 ETH`.
- **Ephemeral Wallet Cleanup**: `smokeTestProduction.mjs` revokes the ephemeral session via `POST /api/auth/logout`, and `wallet_nonces` expires automatically after `NONCE_TTL_SECONDS=300` without needing `SUPABASE_SECRET_KEY` in GitHub Secrets.
- **Playwright Mocked Browser Tests (`npm run test:browser`)**: `3/3` passed locally (`6.06s`) against `vite preview` with mocked EIP-1193 provider.

## 4. Rollback & Token Renewal
- **Render**: Render Dashboard → `eth-wallet-dapp-backend` → **Events / Deploys** → **Rollback to this deploy**.
- **Vercel**: Vercel Dashboard → `eth-wallet-dapp` → **Deployments** → **Promote to Production**.
- **Vercel Token Renewal**: Vercel Account Settings → **Tokens** → update `VERCEL_TOKEN` in GitHub Repository Secrets → revoke old token.
- **Status**: Phase 5.6 core deployment & `22/22` live smoke tests passed; `cd.yml` `browser-tests` build fix will be verified in the Phase 5.7 gated CD rollout.
