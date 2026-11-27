# Database Schema (Supabase PostgreSQL)

All tables have Row Level Security (RLS) enabled; backend access uses the server-side Supabase secret key.

## Tables
1. **`transactions`**
   - Stores verified Sepolia `deposit`, `withdraw`, and `send` events.
   - Key columns: `id`, `wallet` (lowercase), `type`, `amount_eth`, `recipient` (nullable), `tx_hash` (unique), `block_number` (`NOT NULL`), `created_at` (`NOT NULL DEFAULT NOW()`).
2. **`wallet_nonces`**
   - Stores active EIP-4361 SIWE challenges (`wallet`, `nonce`, `message`, `expires_at`).
   - Single-use consumption + automatic expiration (`NONCE_TTL_SECONDS=300`).
3. **`wallet_sessions`**
   - Stores session-bound JWT metadata (`id` UUID matching `jti`, `wallet`, `chain_id`, `expires_at`, `revoked_at`).
   - Checked on every protected request via `authMiddleware.js`.
4. **`wallet_sync_state`**
   - Tracks per-wallet `last_synced_block` checkpoint for incremental Sepolia event synchronization.

## Migrations
- `backend/migrations/001_wallet_sessions.sql` — Wallet session table & indexes.
- `backend/migrations/002_transactions_not_null.sql` — Enforces `NOT NULL` on `transactions.block_number` and `transactions.created_at`.
