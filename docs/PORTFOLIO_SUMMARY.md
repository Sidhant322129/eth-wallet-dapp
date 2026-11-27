# Portfolio Summary — `eth-wallet-dapp`

## Highlights
- **Full-Stack Web3 Vault**: React 19 + Vite + Ethers.js v6 + MetaMask frontend; Node.js 22 + Express 5 backend; Supabase PostgreSQL; Solidity `0.8.20` on Ethereum Sepolia.
- **Cryptographic Auth & Integrity**: EIP-4361 Sign-In with Ethereum (SIWE), single-use nonces, `HS256` JWTs with DB-backed revocation, and server-side on-chain receipt/event verification.
- **DevSecOps & Observability**: GitHub Actions CI, CodeQL SAST, Gitleaks secret scanning, Dependabot, gated Render/Vercel CD, 22-point live production smoke tests, Playwright mocked-wallet browser tests, structured JSON logging with redaction & `X-Request-Id`, and scheduled uptime checks.

## Live Links
- **Live App**: https://eth-wallet-dapp-eta.vercel.app
- **API Health**: https://eth-wallet-dapp-backend.onrender.com/health
- **Sepolia Contract**: `0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67`
