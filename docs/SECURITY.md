# Security Architecture & Controls

## Authentication & Session Security
- **SIWE (EIP-4361)**: Cryptographic wallet signature bound to `SIWE_DOMAIN`, `SIWE_URI`, `SIWE_CHAIN_ID` (`11155111`), and single-use `wallet_nonces`.
- **JWT + DB Revocation**: `HS256` tokens validated for `issuer`, `audience`, `chainId`, `sub === wallet`, and `jti` UUID against Supabase `wallet_sessions.revoked_at`.
- **Fail-Closed Auth**: Returns `503` if the session database is unavailable.

## API, Transport & Database Security
- **Helmet**: Enforces HSTS (`max-age=31536000; includeSubDomains`) in production, `X-Content-Type-Options: nosniff`, and disables `X-Powered-By`.
- **CORS**: Strict `https://` allowlist (`ALLOWED_ORIGINS=https://eth-wallet-dapp-eta.vercel.app`, wildcards rejected).
- **Rate Limiting**: Global IP (`300/15m`), nonce/verify IP (`10/5m`), and wallet-scoped limiters (`history` `60/m`, `transactions` `20/m`, `sync` `10/m`, `logout` `20/m`) behind `trust proxy: 1`.
- **Input & Env Validation**: Strict Zod schemas (`requestSchemas.js`, `env.js`) with `10kb` JSON body limit and `Content-Type: application/json` enforcement.
- **Database**: Supabase RLS enabled, unique `tx_hash`, `NOT NULL` constraints on `block_number` and `created_at`.

## DevSecOps & Supply Chain
- **CodeQL SAST** (`javascript-typescript`), **Gitleaks `v8.30.0`** (full-history redacted secret scan), **npm audit** gates (`0` production vulnerabilities), and **Dependabot** weekly updates.
- **Limitation**: `SendWithdrawMoney.sol` has not undergone a paid third-party smart contract audit and is intended for Sepolia testnet demonstration only.
