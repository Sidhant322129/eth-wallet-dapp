# Portfolio Summary — `eth-wallet-dapp`

## Highlights
- **Full-Stack Web3 Vault**: React 19 + Vite + Ethers.js v6 + MetaMask frontend; Node.js 22 + Express 5 backend; Supabase PostgreSQL; Solidity `0.8.20` on Ethereum Sepolia.
- **Cryptographic Auth & Integrity**: EIP-4361 Sign-In with Ethereum (SIWE), single-use nonces, `HS256` JWTs with DB-backed revocation, and server-side on-chain receipt/event verification.
- **DevSecOps & Observability**: GitHub Actions CI, CodeQL SAST, Gitleaks secret scanning, Dependabot, gated Render/Vercel CD, 22-point live production smoke tests, Playwright mocked-wallet browser tests, structured JSON logging with redaction & `X-Request-Id`, and scheduled uptime checks.

## Live Links
- **Live App**: https://eth-wallet-dapp-eta.vercel.app
- **API Health**: https://eth-wallet-dapp-backend.onrender.com/health
- **Sepolia Contract**: `0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67`

## Resume Bullet Points
- Engineered a full-stack Web3 ETH vault (`React`, `Node.js/Express`, `Solidity`, `Supabase`) with EIP-4361 SIWE authentication, `HS256` JWTs, and database-backed session revocation (`wallet_sessions`).
- Implemented server-side Sepolia transaction receipt/event verification and idempotent incremental block-history synchronization (`eth_getLogs` chunking + confirmation lag + `UNIQUE tx_hash`).
- Built a gated DevSecOps CI/CD pipeline (`GitHub Actions`, `CodeQL`, `Gitleaks`, `npm audit`, `Dependabot`, `Render`, `Vercel`, `Playwright`) with docs-only skip logic, automated 22-point production smoke testing, and structured JSON observability (`X-Request-Id` + secret redaction).

## Interview Preparation Q&A
1. **Why verify transactions on the backend instead of trusting the frontend?**
   - Client payloads can be forged. The backend fetches the Sepolia receipt via Alchemy RPC, verifies contract address, `status === 1`, decoded `Deposited`/`Withdrawn` event args, and sender ownership before writing to Supabase.
2. **How do you prevent JWT replay after logout?**
   - Every JWT carries a `jti` UUID mapped to `wallet_sessions`. `POST /api/auth/logout` sets `revoked_at`, and `authMiddleware.js` checks `revoked_at` on every protected request (failing closed with `503` if DB is unreachable).
3. **How did you fix the indefinite `"Authenticating..."` UI bug?**
   - Reset `loading` inside `clearLocalSession()` when MetaMask `accountsChanged`/`chainChanged` fires mid-auth, and added a 60s `AbortController` timeout (`fetchWithTimeout`) for Render cold starts.
