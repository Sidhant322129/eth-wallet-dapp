# Testing Guide

## Automated Test Suites

| Suite | Command | Latest Observed Result |
|---|---|---|
| **Backend Unit, Security & Monitoring** | `cd backend && npm test` | `20/20` passed (`4` suites, `9.82s`, mocked Supabase/RPC) |
| **Frontend Lint & Build** | `cd frontend && npm run lint && npm run build` | `0` ESLint errors; `188` modules (`1.87s`) |
| **Frontend Auth Reliability** | `cd frontend && npm test` | `7/7` passed (`146.65ms`, mocked providers/API) |
| **Frontend Playwright Browser** | `cd frontend && npm run test:browser` | `3/3` passed (local & remote `32s` in CD `45999325986`, mocked EIP-1193) |
| **Smart Contracts** | `cd contracts-project && npx hardhat test` | `8/8` passed (`993ms`, local Hardhat EVM) |
| **DevOps Gate & Uptime Simulation** | `node --test scripts/cdGateCheck.test.mjs scripts/uptimeCheck.test.mjs` | `10/10` passed (`166.65ms`: `7` CD gate + `3` uptime tests) |
| **Live Production Smoke Suite** | `node scripts/smokeTestProduction.mjs` | `22/22` passed (Vercel, Render, Supabase, Sepolia) |
| **Production Dependency Audits** | `npm audit --omit=dev` (all 3 packages) | `0` production vulnerabilities |
