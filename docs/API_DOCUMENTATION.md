# REST API Documentation

Base URL (Production): `https://eth-wallet-dapp-backend.onrender.com`

## Health & Readiness
- `GET /` — Returns `{ "message": "Ethereum Wallet Backend is running" }` (`200`).
- `GET /health` — Process liveness check (`200`, `{ "status": "ok", "service": "eth-wallet-backend", "uptimeSeconds": <number> }`, `Cache-Control: no-store`).
- `GET /health/ready` — Dependency readiness check (`200` `ready` or `503` `degraded` with `dependencies: { database, blockchainRpc }`, `3000ms` timeout).
- `GET /api/test-db` — Disabled in production (`404`).

## Authentication (`/api/auth`)
- `POST /api/auth/nonce` — Body: `{ "wallet": "0x..." }`. Returns `{ "success": true, "wallet", "message", "expiresAt" }`. Rate limit: 10 req / 5 min / IP.
- `POST /api/auth/verify` — Body: `{ "wallet": "0x...", "signature": "0x..." }`. Consumes single-use nonce, creates `wallet_sessions` row, returns `{ "success": true, "token", "wallet", "expiresIn" }`.
- `GET /api/auth/me` — Header: `Authorization: Bearer <jwt>`. Validates JWT claims and active Supabase session.
- `POST /api/auth/logout` — Header: `Authorization: Bearer <jwt>`. Sets `revoked_at` on the active session immediately.

## Transactions & Sync (`/api/transactions`, `/api/sync`)
- `POST /api/transactions` — Header: `Authorization: Bearer <jwt>`, Body: `{ "txHash": "0x..." }`. Fetches Sepolia receipt, verifies contract/event/sender/amount, and stores idempotently.
- `GET /api/transactions/:wallet` — Header: `Authorization: Bearer <jwt>`. Enforces `req.wallet === params.wallet` (`403` on mismatch).
- `POST /api/sync` — Header: `Authorization: Bearer <jwt>`. Incrementally scans up to `SYNC_MAX_BLOCKS` (`200`) in `SYNC_BLOCK_RANGE` (`10`) chunks from `wallet_sync_state`.

All responses include `X-Request-Id` correlation headers.
