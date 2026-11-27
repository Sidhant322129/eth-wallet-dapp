# Deployment Guide

## Architecture
- **Frontend**: Vercel (`frontend/` root directory, `https://eth-wallet-dapp-eta.vercel.app`)
- **Backend**: Render Free Web Service (`backend/` root directory, `https://eth-wallet-dapp-backend.onrender.com`)
- **Database**: Supabase PostgreSQL
- **Smart Contract**: Already deployed on Sepolia (`0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67`)

## Gated Continuous Deployment (`.github/workflows/cd.yml`)
1. Push to `main` triggers `CI`, `Security Scanning`, and `CodeQL`.
2. `CD` (`verify-gates`) confirms all 3 passed on the current `main` tip SHA and prevents duplicate deploys.
3. `deploy-render` triggers Render API deploy, polls until `live`, and verifies `/health` & `/health/ready`.
4. `deploy-vercel` deploys via Vercel CLI (`vercel@67.0.0`) using `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
5. `smoke-test` runs `scripts/smokeTestProduction.mjs` (`22` live checks) and `browser-tests` runs Playwright.

Provider-native auto-deploys are disabled (`render.yaml` `autoDeployTrigger: off`, `frontend/vercel.json` `git.deploymentEnabled: false`).

## Rollback
- **Render**: Render Dashboard → `eth-wallet-dapp-backend` → **Deploys** → **Rollback to this deploy**.
- **Vercel**: Vercel Dashboard → `eth-wallet-dapp` → **Deployments** → **Promote to Production**.
