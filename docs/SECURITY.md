# Security Architecture & Controls

## Authentication & Session Security
- **SIWE (EIP-4361)**: Cryptographic wallet signature bound to `SIWE_DOMAIN`, `SIWE_URI`, `SIWE_CHAIN_ID` (`11155111`), and single-use `wallet_nonces`.
- **JWT + DB Revocation**: `HS256` tokens validated for `issuer`, `audience`, `chainId`, `sub === wallet`, and `jti` UUID against Supabase `wallet_sessions.revoked_at` (fail-closed `503` if DB unreachable).

## API, Transport & Database Security
- **Helmet & CORS**: Production HSTS (`max-age=31536000; includeSubDomains`), `nosniff`, no `x-powered-by`, strict `https://` `ALLOWED_ORIGINS` (`https://eth-wallet-dapp-eta.vercel.app`).
- **Rate Limiting & Validation**: Global/auth IP limiters + wallet-scoped limiters behind `trust proxy: 1`; strict Zod schemas (`requestSchemas.js`, `env.js`), `10kb` JSON limit, `application/json` enforcement.
- **Database**: Supabase RLS enabled, unique `tx_hash`, `NOT NULL` constraints on `block_number` and `created_at`.

## Credential Rotation & Advisories
- **Credential Hygiene**: Supabase secret key and Alchemy Sepolia RPC key were rotated in Phase 4 (confirmed by user); fresh 64-byte `JWT_SECRET` generated in Phase 5.4; zero `.env` files tracked in Git; zero secrets in frontend bundle.
- **Dependency Audits**: `0` production vulnerabilities (`npm audit --omit=dev`). Dev-only advisories remain in `vite <=6.4.3` (`1` high, `1` moderate), `nodemon` (`2` moderate), and Hardhat 2.30.0 tooling (`7` high, `9` moderate, `20` low) — intentionally not force-upgraded.
- **Smart Contract Disclaimer**: `SendWithdrawMoney.sol` has not undergone an independent third-party audit and is intended strictly for Sepolia testnet demonstration, not mainnet assets.
