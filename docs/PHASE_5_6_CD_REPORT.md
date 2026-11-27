# Phase 5.6 — Continuous Deployment (CD) and Automated Production Smoke Testing Report

## 1. Deployment & Verification Summary
- **Latest Deployed Runtime Commit SHA**: `2b60e5a1f134d75d09d9b4666feeddb6f2c1042a` (`2b60e5a`)
- **Production URLs**:
  - Frontend (Vercel): `https://eth-wallet-dapp-eta.vercel.app`
  - Backend (Render): `https://eth-wallet-dapp-backend.onrender.com`
- **Provider Auto-Deploy Protection**:
  - Render: `render.yaml` sets `autoDeployTrigger: off`.
  - Vercel: `frontend/vercel.json` sets `"git": { "deploymentEnabled": false }`.

## 2. GitHub Actions Results for `2b60e5a`
| Workflow | Run ID / Link | Status | Jobs & Durations |
|---|---|---|---|
| **CI** | [45999127087](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45999127087) | **success** | `Frontend CI` (`11s`), `Backend CI` (`19s`), `Smart Contract CI` (`24s`) |
| **Security Scanning** | [45999127102](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45999127102) | **success** | `Secret Scan (Gitleaks)` (`11s`), `Dependency Audit (Frontend)` (`8s`), `Dependency Audit (Backend)` (`9s`), `Dependency Audit (Contracts)` (`16s`) |
| **CodeQL** | [45999127089](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45999127089) | **success** | `Analyze (javascript-typescript)` |
| **CD (Active Rollout)** | [45999325986](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45999325986) | **success** | `Verify Required Gates & Commit Tip` (`16s`), `Deploy Backend (Render)` (`35s`), `Deploy Frontend (Vercel)` (`40s`), `Production Smoke Tests` (`16s`), `Mocked Wallet Browser Tests (Playwright)` (`32s`) |

*(Earlier commits `ad00b9e` — CD [45994457891](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45994457891) — and `5f14d1f` — CD [45997853341](https://github.com/Sidhant322129/eth-wallet-dapp/actions/runs/45997853341) — also completed all 5 CD jobs including `Mocked Wallet Browser Tests (Playwright)`.)*

## 3. Docs-Only Skip & Gate Hardening (`scripts/cdGateCheck.mjs`)
- Compares candidate `main` SHA against the **last successfully deployed runtime commit** (`baselineSha`) using GitHub Compare API (`/compare/{baselineSha}...{sha}`), skipping CD when only `README.md`, `docs/**`, or `*.md` changed, and failing safely (deploying) if `baselineSha` is missing or ambiguous.
- Ignores earlier skipped/no-op CD runs when checking for duplicate deployments.
- Records non-sensitive Render deploy ID and Vercel deploy URL in `$GITHUB_STEP_SUMMARY`.
- **Gate Simulation (`scripts/cdGateCheck.test.mjs`)**: `7/7` passed (`CI` fail, `CodeQL` in-progress, stale `main` SHA, skipped no-op CD run, duplicate completed CD run, docs-only skip, mixed docs+runtime deploy).
- **Live Production Smoke Tests (`scripts/smokeTestProduction.mjs`)**: `22/22` passed (`0` failed).
- **Playwright Mocked Browser Tests**: `3/3` passed locally and remotely (`32s` in `45999325986`).
