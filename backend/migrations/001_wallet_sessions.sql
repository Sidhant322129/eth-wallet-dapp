-- Phase 4.5: Persistent server-side authentication sessions for JWT revocation
-- Run this manually in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.wallet_sessions (
    session_id UUID PRIMARY KEY,
    wallet TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    CONSTRAINT wallet_sessions_wallet_lowercase
        CHECK (wallet = LOWER(wallet)),
    CONSTRAINT wallet_sessions_valid_chain
        CHECK (chain_id > 0),
    CONSTRAINT wallet_sessions_valid_expiry
        CHECK (expires_at > created_at)
);

-- Indexes for active session lookup and expired-session cleanup
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_wallet
    ON public.wallet_sessions (wallet);

CREATE INDEX IF NOT EXISTS idx_wallet_sessions_expires_at
    ON public.wallet_sessions (expires_at);

-- Enable Row Level Security with no public policies (backend secret key only)
ALTER TABLE public.wallet_sessions
    ENABLE ROW LEVEL SECURITY;

-- Optional periodic cleanup queries (run manually or via scheduled job):
-- DELETE FROM public.wallet_nonces WHERE expires_at < NOW();
-- DELETE FROM public.wallet_sessions WHERE expires_at < NOW() - INTERVAL '7 days';
