const crypto = require("crypto");
const { isAddress } = require("ethers");
const supabase = require("../config/supabase");

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Convert JWT_EXPIRES_IN (e.g. "1h", "30m", "60s", "7d") into milliseconds.
 */
function parseDurationToMs(expiresIn) {
    const match = /^(\d+)(s|m|h|d)$/.exec(String(expiresIn).trim());
    if (!match) {
        throw new Error("Invalid JWT_EXPIRES_IN format");
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };
    return amount * multipliers[unit];
}

function createInfraError(message) {
    const err = new Error(message);
    err.isInfraError = true;
    return err;
}

/**
 * Create a persistent session row in public.wallet_sessions.
 */
async function createSession({ wallet, chainId, expiresIn }) {
    if (typeof wallet !== "string" || !isAddress(wallet)) {
        throw new Error("Invalid wallet address");
    }

    const sessionId = crypto.randomUUID();
    const nowMs = Date.now();
    const ttlMs = parseDurationToMs(expiresIn);
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlMs).toISOString();

    const { data, error } = await supabase
        .from("wallet_sessions")
        .insert({
            session_id: sessionId,
            wallet: wallet.toLowerCase(),
            chain_id: Number(chainId),
            created_at: createdAt,
            expires_at: expiresAt,
            revoked_at: null
        })
        .select("session_id, wallet, chain_id, created_at, expires_at")
        .single();

    if (error || !data) {
        throw createInfraError(
            `Session creation failed: ${error?.message || "Unknown error"}`
        );
    }

    return data;
}

/**
 * Retrieve and validate an active session by sessionId, wallet, and chainId.
 * Fails closed on any database error or mismatch.
 */
async function validateActiveSession({ sessionId, wallet, chainId }) {
    if (typeof sessionId !== "string" || !UUID_REGEX.test(sessionId)) {
        return { valid: false, reason: "Invalid session identifier" };
    }

    if (typeof wallet !== "string" || !isAddress(wallet)) {
        return { valid: false, reason: "Invalid wallet address" };
    }

    const { data, error } = await supabase
        .from("wallet_sessions")
        .select("session_id, wallet, chain_id, expires_at, revoked_at")
        .eq("session_id", sessionId)
        .maybeSingle();

    if (error) {
        throw createInfraError(
            `Session lookup failed: ${error.message}`
        );
    }

    if (!data) {
        return { valid: false, reason: "Session not found" };
    }

    if (data.revoked_at !== null) {
        return { valid: false, reason: "Session revoked" };
    }

    if (new Date(data.expires_at).getTime() <= Date.now()) {
        return { valid: false, reason: "Session expired" };
    }

    if (data.wallet.toLowerCase() !== wallet.toLowerCase()) {
        return { valid: false, reason: "Session wallet mismatch" };
    }

    if (Number(data.chain_id) !== Number(chainId)) {
        return { valid: false, reason: "Session chain mismatch" };
    }

    return { valid: true, session: data };
}

/**
 * Revoke only the specified active session belonging to the authenticated wallet.
 */
async function revokeSession({ sessionId, wallet }) {
    if (typeof sessionId !== "string" || !UUID_REGEX.test(sessionId)) {
        throw new Error("Invalid session identifier");
    }

    if (typeof wallet !== "string" || !isAddress(wallet)) {
        throw new Error("Invalid wallet address");
    }

    const revokedAt = new Date().toISOString();

    const { data, error } = await supabase
        .from("wallet_sessions")
        .update({ revoked_at: revokedAt })
        .eq("session_id", sessionId)
        .eq("wallet", wallet.toLowerCase())
        .is("revoked_at", null)
        .select("session_id, revoked_at")
        .maybeSingle();

    if (error) {
        throw createInfraError(
            `Session revocation failed: ${error.message}`
        );
    }

    return data;
}

module.exports = {
    UUID_REGEX,
    parseDurationToMs,
    createSession,
    validateActiveSession,
    revokeSession
};
