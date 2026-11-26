# Security Test & Audit Report — `eth-wallet-dapp` (Phase 4.6)

## 1. Executive Summary
A comprehensive security audit and automated regression suite was implemented across the Express backend and Hardhat smart contract project. All **12** backend security & regression tests (`node --test`), **8** Hardhat smart contract security tests, frontend ESLint, and frontend production build passed with **0 failures** and **0 skipped** tests. Both `backend` and `frontend` report **0 vulnerabilities** in production dependencies (`npm audit --omit=dev`).

---

## 2. Files Inspected
- **Root & Templates**: `.gitignore`, `backend/.env.example`, `frontend/.env.example`, `contracts-project/.env.example`
- **Backend**: `backend/package.json`, `backend/server.js`, `backend/config/env.js`, `backend/config/supabase.js`, `backend/controllers/authController.js`, `backend/controllers/transactionController.js`, `backend/controllers/syncController.js`, `backend/middleware/authMiddleware.js`, `backend/middleware/rateLimitMiddleware.js`, `backend/middleware/validationMiddleware.js`, `backend/validators/requestSchemas.js`, `backend/services/siweService.js`, `backend/services/sessionService.js`, `backend/services/blockchainService.js`, `backend/services/syncService.js`, `backend/services/syncStateService.js`, `backend/routes/authRoutes.js`, `backend/routes/transactionRoutes.js`, `backend/routes/syncRoutes.js`
- **Smart Contracts**: `contracts-project/contracts/SendWithdrawMoney.sol`, `contracts-project/test/SendWithdrawMoney.js`, `contracts-project/hardhat.config.js`
- **Frontend**: `frontend/package.json`, `frontend/src/App.jsx`, `frontend/src/services/authApi.js`, `frontend/src/services/TransactionApi.js`, `frontend/contracts/walletContract.js`

---

## 3. Files Created or Modified
- **Created**:
  - `backend/tests/securityAudit.test.js` — Automated authentication, authorization, API, transaction verification, and synchronization security suite.
  - `contracts-project/contracts/test/SecurityTestHelpers.sol` — Local test-only `ReentrancyAttacker` and `RejectEtherRecipient` contracts.
  - `docs/SECURITY_TEST_REPORT.md` — This audit report.
- **Modified**:
  - `backend/server.js` — Minimal testability refactor: guarded `app.listen()` with `if (require.main === module)` and exported `app` (`module.exports = app;`).
  - `contracts-project/test/SendWithdrawMoney.js` — Extended from 4 to 8 local Hardhat security tests.

*(No deployed smart contracts, database schemas, or `.env` secrets were modified.)*

---

## 4. Security Test Coverage
- **Backend Authentication (`securityAudit.test.js`)**: Missing/malformed/tampered/expired JWT, wrong `iss`/`aud`/`chainId`, missing/revoked/expired/wallet-mismatched DB session, fail-closed `503` on DB outage, SIWE login, concurrent nonce consumption (`Promise.all`), nonce replay, wrong signer, bad SIWE domain, expired nonce.
- **Authorization (`securityAudit.test.js`)**: Own wallet checksum/lowercase access (`200`), cross-wallet history (`403`), cross-wallet tx save (`403`), unauthorized sync (`401`).
- **API & Headers (`securityAudit.test.js`)**: Invalid address/hash (`400`), unexpected fields (`400`), malformed JSON (`400`), unsupported `Content-Type` (`415`), >10 KB JSON (`413`), Helmet headers (`nosniff`, `SAMEORIGIN`, `CSP`), `Cache-Control: no-store`, absence of `X-Powered-By`, CORS allowlist vs disallowed origin, isolated rate limiter (`429`, `Retry-After`, `RateLimit` header, independent wallet counters).
- **Transaction Verification (`transactionRegression.test.js` + `securityAudit.test.js`)**: Valid `deposit`/`withdraw`/`send`, temporary receipt retry, permanent missing receipt (`409`), transient RPC error (`503`), failed tx (`status: 0`), wrong contract, wrong network, wrong event/amount/recipient (`422`), concurrent duplicate `txHash` idempotency preserving existing ID.
- **Synchronization (`securityAudit.test.js`)**: Oversized range (`400`), concurrent sync lock (`409`) and lock release after RPC failure, confirmation lag (`latest - 12`), manual range isolation, checkpoint preservation on RPC failure.
- **Smart Contract (`SendWithdrawMoney.js`)**: Valid deposit/withdraw/send + events, zero deposit revert, balance isolation, exceeding balance revert, failed recipient transfer rollback, reentrancy attack blocked via Checks-Effects-Interactions, and documented zero-amount / zero-address behavior.

---

## 5. Test Commands Executed & 6. Actual Counts

| Suite / Check | Command | Passed | Failed | Skipped |
|---|---|---|---|---|
| Backend Security & Regression | `cd backend && npm test` (`node --test`) | **12** | **0** | **0** |
| Smart Contract Security (Local VM) | `cd contracts-project && npx hardhat compile && npx hardhat test` | **8** | **0** | **0** |
| Frontend Lint & Build | `cd frontend && npm run lint && npm run build` | **2** | **0** | **0** |

---

## 7. Mocked vs. Live Test Classification
- **Mocked Tests**: All 12 `node --test` cases in `backend/tests/` mock `supabase.from` and `blockchainService.provider` in-memory to avoid Alchemy CU consumption and production DB mutations. Rate-limit threshold tests use an isolated `createRateLimiter` Express instance (`limit: 2`, `windowMs: 500`) so production limits are not weakened.
- **Local Blockchain VM**: All 8 Hardhat tests run against the ephemeral local Hardhat EVM (zero Sepolia ETH spent).
- **Previously Verified Live (Prior Phases)**:
  - Live Supabase 4-table connectivity (`transactions`, `wallet_nonces`, `wallet_sync_state`, `wallet_sessions`).
  - Live SIWE login, session creation, `POST /api/auth/logout`, and post-logout `401`.
  - Live transaction replay idempotency (`id: 13`, 1 row per `tx_hash`).
- **Pending Live Checks**:
  - Read-only Supabase RLS/policy inspection queries in SQL Editor (Section 11).
  - User confirmation of Alchemy API key rotation (from Phase 4.4).

---

## 8. Security Findings Categorized by Severity

| Severity | Component | Finding & Practical Impact |
|---|---|---|
| **Medium** | `SendWithdrawMoney.sol` | `withdrawToAddress(address(0), amount)` does not check `to != address(0)`. Calling it with the zero address permanently burns the user's deposited ETH. *(Already deployed on Sepolia; documented without modifying deployed contract.)* |
| **Low** | `SendWithdrawMoney.sol` | `withdraw(0)` and `withdrawToAddress(to, 0)` do not require `amount > 0`; they succeed and emit `Withdrawn(..., 0)` while wasting gas. |
| **Low / Operational** | `syncController.js` & `rateLimitMiddleware.js` | `activeSyncWallets` lock and `express-rate-limit` `MemoryStore` are single-process in-memory structures. Multi-instance deployments would not share rate limits or sync locks across processes. |
| **Low / Operational** | `backend/server.js` | `trust proxy` is intentionally unset for local dev; if deployed behind a reverse proxy without `app.set("trust proxy", 1)`, IP rate limiters would key on the proxy IP. |
| **Info** | `backend/services/syncService.js` | `12` confirmations reduce but do not eliminate deep chain reorganization risk; concurrent sync calls across processes could race checkpoint updates without a DB-level conditional update. |
| **Info** | Project Root | Directory is not yet initialized as a Git repository (`NOT_A_GIT_REPO`), so `git ls-files` tracking checks cannot run until `git init`. |

---

## 9. Dependency Audit Results

| Project | Production (`npm audit --omit=dev`) | Full Audit (incl. DevDeps) | Practical Risk |
|---|---|---|---|
| `backend` | **0 vulnerabilities** | 2 moderate (`minimatch`, `nodemon`) | Dev-only file watcher; zero production runtime risk |
| `frontend` | **0 vulnerabilities** | 1 moderate (`esbuild`), 1 high (`vite@5`) | Dev-server only (excluded from `dist/`); zero static build risk |
| `contracts-project` | N/A (dev toolchain) | 36 (20 low, 9 moderate, 7 high) | All inside `hardhat@2` / `hardhat-toolbox@6`; requires breaking `hardhat@3` upgrade |

---

## 10. Remaining Limitations
- Alchemy Free Tier limits `eth_getLogs` to 10 blocks per call (`SYNC_BLOCK_RANGE=10`), requiring 20 sequential RPC calls per 200-block sync batch.
- Frontend E2E browser interactions (MetaMask popup, `accountsChanged`/`chainChanged`, **Retry Recording** click) were verified by inspection and build/lint, not automated headless Chrome.
- Credential rotation for **Alchemy API key** remains pending user completion/confirmation.

---

## 11. Manual Verification Checklist

### A. Read-Only Supabase Security Audit SQL (Run in Supabase SQL Editor)
```sql
-- 1. Verify RLS is enabled on all 4 tables
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'wallet_nonces', 'wallet_sync_state', 'wallet_sessions');

-- 2. Inspect existing RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Verify unique constraints and indexes
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'wallet_nonces', 'wallet_sync_state', 'wallet_sessions')
ORDER BY tablename, indexname;

-- 4. Verify zero duplicate tx_hash records
SELECT tx_hash, COUNT(*)
FROM public.transactions
GROUP BY tx_hash
HAVING COUNT(*) > 1;
```

### B. PowerShell Local Test Commands
```powershell
cd c:\Users\sidha\OneDrive\Desktop\eth-wallet-dapp\backend
npm test

cd c:\Users\sidha\OneDrive\Desktop\eth-wallet-dapp\contracts-project
npx hardhat test

cd c:\Users\sidha\OneDrive\Desktop\eth-wallet-dapp\frontend
npm run lint
npm run build
```

---

## 12. Recommended Fixes Requiring Approval
1. **Before production deployment**: Configure `app.set("trust proxy", 1)` in `backend/server.js` (if behind a single reverse proxy) and consider Redis-backed rate-limit/sync locks if running >1 backend instance.
2. **Future contract v2 (optional)**: Add `require(to != address(0), "Invalid recipient")` and `require(amount > 0, "Amount must be > 0")` in `SendWithdrawMoney.sol` if you ever deploy a new contract version.
3. **Database RLS tightening**: Confirm in Supabase SQL Editor (query #2 above) that `transactions` and `wallet_nonces` no longer have any permissive `anon` insert/select policies left over from Phase 1.

---

## 13. Deployment Readiness Assessment
**Conditionally Ready for Staging / Testnet Deployment** once you:
1. Run the read-only Supabase RLS audit queries above and confirm no permissive `anon` policies remain.
2. Complete and confirm Alchemy API key rotation.
3. Set `NODE_ENV=production`, explicit `https://` `ALLOWED_ORIGINS` & `SIWE_URI`, and `trust proxy` for your hosting environment.
