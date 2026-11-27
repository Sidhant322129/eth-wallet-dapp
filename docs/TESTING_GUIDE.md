# Testing Guide

## Automated Test Suites

| Suite | Command | Scope |
|---|---|---|
| **Backend Unit, Security & Monitoring** | `cd backend && npm test` | `19` tests (`4` suites): auth/SIWE/JWT, RBAC, headers/CORS/rate-limits, tx verification, sync, `/health`, `/health/ready`, redaction & `X-Request-Id` (mocked Supabase/RPC) |
| **Frontend Lint & Build** | `cd frontend && npm run lint && npm run build` | ESLint & Vite production bundle (`188` modules) |
| **Frontend Auth Reliability** | `cd frontend && npm test` | `7` tests: account/network switch mid-auth, rejections, timeout abort, stale response prevention (mocked providers/API) |
| **Frontend Playwright Browser** | `cd frontend && npm run test:browser` | `3` suites against `vite preview` with mocked EIP-1193 `window.ethereum` |
| **Smart Contracts** | `cd contracts-project && npx hardhat test` | `8` tests on local Hardhat EVM (`SendWithdrawMoney.sol`) |
| **CD Gate Simulation** | `node --test scripts/cdGateCheck.test.mjs` | `5` tests simulating failed, incomplete, stale, no-op, and duplicate CD gates |
| **Live Production Smoke Suite** | `node scripts/smokeTestProduction.mjs` | `22` live checks against Vercel, Render, Supabase & Sepolia (ephemeral random wallet) |
| **Production Dependency Audits** | `npm audit --omit=dev` (all 3 packages) | `0` production vulnerabilities |
