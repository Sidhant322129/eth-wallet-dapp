# Phase 5.6 — Continuous Deployment (CD) and Automated Production Smoke Testing Report

## 1. CD Pipeline Architecture (`.github/workflows/cd.yml`)
Phase 5.6 introduces a strictly gated Continuous Deployment pipeline triggered on `workflow_run` completion of `CI`, `Security Scanning`, and `CodeQL` on `main` (plus `workflow_dispatch`):

1. **`verify-gates`**:
   - Confirms `branch === "main"` and `event !== "pull_request"`.
   - Verifies `RUN_SHA` is the current tip of `origin/main` (prevents stale commits from overwriting newer releases).
   - Verifies **all three** required workflows (`CI`, `Security Scanning`, `CodeQL`) have `status === "completed"` and `conclusion === "success"` for that exact commit SHA.
   - Deduplicates multiple `workflow_run` completion triggers for the same SHA, and uses `concurrency: { group: "production-deployment-main", cancel-in-progress: false }` so in-flight deploys are never interrupted.
2. **`deploy-render`**:
   - Triggers Render deployment for the exact validated `DEPLOY_SHA` via Render REST API (`RENDER_API_KEY`, `RENDER_SERVICE_ID`).
   - Polls deployment status up to 40 times (15s interval) until `live`, failing fast on `build_failed`, `update_failed`, `canceled`, or `deactivated`.
   - Verifies `GET /health` (`200`) and `GET /health/ready` (`200`, `database: "up"`, `blockchainRpc: "up"`) with cold-start retry tolerance before allowing frontend deployment.
3. **`deploy-vercel`** (`needs: [verify-gates, deploy-render]`):
   - Runs only after Render backend deployment and readiness pass.
   - Uses official Vercel CLI (`vercel pull`, `vercel build --prod`, `vercel deploy --prebuilt --prod`) from the repository root using `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` (respecting Vercel's configured `frontend` root directory without nesting).
   - `frontend/vercel.json` sets `"git": { "deploymentEnabled": false }` so provider-native Git auto-deployments cannot bypass CD gates.
4. **`smoke-test`** (`needs: [verify-gates, deploy-render, deploy-vercel]`):
   - Runs `node scripts/smokeTestProduction.mjs` against `https://eth-wallet-dapp-eta.vercel.app` and `https://eth-wallet-dapp-backend.onrender.com`.
5. **`browser-tests`** (`needs: [verify-gates, smoke-test]`):
   - Runs `npm run test:browser` (`frontend/tests/browserMockWallet.test.mjs`) with Playwright Chromium and a mocked EIP-1193 provider.

## 2. Automated Production Smoke Tests (`scripts/smokeTestProduction.mjs`)
Verifies without modifying existing user data or broadcasting funded transactions:
- Frontend HTTPS & HTTP `200`; bundle references Render API URL and Sepolia contract `0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67`; zero backend secret patterns in bundle.
- Backend `GET /` (`200`), `GET /health` (`200`), `GET /health/ready` (`200`, Supabase + Sepolia RPC `up`), and `GET /api/test-db` (`404`).
- CORS allowlist (`https://eth-wallet-dapp-eta.vercel.app` allowed; `https://evil.example.com` rejected) and Helmet headers.
- Unauthenticated (`401`) and malformed/invalid JWT (`401`) rejection.
- Isolated ephemeral random wallet (`Wallet.createRandom()`): SIWE nonce (`200`), verify (`200`), `/api/auth/me` (`200`), nonce replay (`401`), cross-wallet `/api/transactions/0x...0001` (`403`), own history (`200`), logout (`200`), immediate post-logout revocation (`401`).
- Read-only Sepolia contract check: `chainId=11155111`, bytecode `2549B`, `contract.getContractBalance()` matching on-chain balance.

## 3. Playwright Mocked Browser Tests (`frontend/tests/browserMockWallet.test.mjs`)
- Runs against `vite preview` with an injected mocked EIP-1193 `window.ethereum` provider and mocked `/api/**` routes:
  - Wallet connection, `"Authenticating..."` loading state, `"Wallet Authenticated"`, and Logout.
  - Mid-session `accountsChanged` and `chainChanged` resets.
  - Signature rejection (`code: 4001`) and stalled/aborted API request recovery (never stuck on `"Authenticating..."`).
- **Scope note**: These tests validate UI state transitions using a **mocked** EIP-1193 provider and mocked API responses; they complement (and do not replace) live MetaMask end-to-end validation.

## 4. Local Verification Results
- **YAML & JSON**: `.github/workflows/cd.yml` (`js-yaml`) and `frontend/vercel.json` valid.
- **Frontend**: `npm run lint` (`0`), `npm test` (`7/7` passed), `npm run build` (`187` modules, `1.94s`), `npm run test:browser` (`3/3` Playwright suites passed, `6.06s`).
- **Backend**: `npm test` (`16/16` passed, `10.16s`).
- **Smart Contracts**: `npx hardhat compile` (`Nothing to compile`), `npx hardhat test` (`8 passing (1s)`).
- **Secret Scan**: `SECRET_SCAN: CLEAN`.

## 5. Rollback & Token Renewal Procedures
- **Render Rollback**: Render Dashboard → `eth-wallet-dapp-backend` → **Events / Deploys** → select previous healthy deploy → **Rollback to this deploy** (or revert commit on `main`).
- **Vercel Rollback**: Vercel Dashboard → `eth-wallet-dapp` → **Deployments** → select previous production deployment → **Promote to Production** (or `vercel rollback --token=...`).
- **Vercel Token Renewal**: Vercel Account Settings → **Tokens** → create a new scoped token before expiration → update `VERCEL_TOKEN` in GitHub Repository → **Settings → Secrets and variables → Actions** → revoke the old token.
- **Provider Auto-Deploy Check**: `render.yaml` sets `autoDeployTrigger: off`; `frontend/vercel.json` sets `"git": { "deploymentEnabled": false }`. Also confirm Vercel Dashboard → Project Settings → Git has auto-deploy disabled if configured separately.

## 6. Pending Remote Verification
- Remote execution of `.github/workflows/cd.yml` (`verify-gates`, `deploy-render`, `deploy-vercel`, `smoke-test`, `browser-tests`) has not run yet because Phase 5.6 files have not been committed or pushed.
