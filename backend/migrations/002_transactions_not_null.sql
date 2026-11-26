-- Phase 4.6: Enforce NOT NULL constraints on public.transactions.block_number and created_at
-- Pre-check confirmed: 11 total rows, 0 NULL block_number, 0 NULL created_at.
-- Review carefully and run manually in Supabase SQL Editor after approval.

BEGIN;

-- Ensure created_at always has a database default for inserts omitting created_at
ALTER TABLE public.transactions
    ALTER COLUMN created_at SET DEFAULT NOW();

-- Enforce NOT NULL on block_number and created_at
ALTER TABLE public.transactions
    ALTER COLUMN block_number SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL;

COMMIT;

-- ─── Rollback SQL (run only if you need to revert this migration) ─────────────
-- BEGIN;
-- ALTER TABLE public.transactions
--     ALTER COLUMN block_number DROP NOT NULL,
--     ALTER COLUMN created_at DROP NOT NULL;
-- COMMIT;
