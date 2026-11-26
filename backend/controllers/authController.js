const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { isAddress } = require("ethers");
const env = require("../config/env");
const supabase = require("../config/supabase");
const {
    createSiweChallenge,
    verifySiweChallenge
} = require("../services/siweService");
const {
    createSession,
    revokeSession
} = require("../services/sessionService");

const NONCE_REUSE_MIN_REMAINING_MS = 60 * 1000;

// Generate EIP-4361 SIWE authentication challenge
async function generateNonce(req, res) {
    try {
        const { wallet } = req.body;

        if (typeof wallet !== "string" || !isAddress(wallet)) {
            return res.status(400).json({
                success: false,
                message: "Invalid wallet address"
            });
        }

        const address = wallet.toLowerCase();
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        // Opportunistically purge expired nonces to keep wallet_nonces bounded
        await supabase
            .from("wallet_nonces")
            .delete()
            .lt("expires_at", nowIso);

        // Mitigate unauthenticated nonce-replacement DoS: reuse active challenge if > 60s left
        const { data: existing, error: existingError } = await supabase
            .from("wallet_nonces")
            .select("nonce, message, expires_at")
            .eq("wallet", address)
            .maybeSingle();

        if (existingError) throw existingError;

        if (
            existing &&
            new Date(existing.expires_at).getTime() - nowMs >
                NONCE_REUSE_MIN_REMAINING_MS
        ) {
            return res.status(200).json({
                success: true,
                wallet: address,
                message: existing.message,
                expiresAt: existing.expires_at
            });
        }

        // Generate a cryptographically secure alphanumeric nonce (32 hex chars)
        const nonce = crypto.randomBytes(16).toString("hex");
        const issuedAt = nowIso;
        const expiresAt = new Date(
            nowMs + env.NONCE_TTL_SECONDS * 1000
        ).toISOString();

        const challenge = createSiweChallenge({
            wallet,
            nonce,
            issuedAt,
            expirationTime: expiresAt
        });

        const { error } = await supabase
            .from("wallet_nonces")
            .upsert(
                {
                    wallet: address,
                    nonce,
                    message: challenge.message,
                    expires_at: expiresAt,
                    created_at: issuedAt
                },
                { onConflict: "wallet" }
            );

        if (error) throw error;

        return res.status(200).json({
            success: true,
            wallet: address,
            message: challenge.message,
            expiresAt
        });
    } catch (error) {
        console.error("Nonce generation error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to generate nonce"
        });
    }
}

// Verify SIWE signature, consume nonce atomically, create persistent session, and issue JWT
async function verifySignature(req, res) {
    try {
        const { wallet, signature } = req.body;

        if (
            typeof wallet !== "string" ||
            !isAddress(wallet) ||
            typeof signature !== "string" ||
            !signature
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid wallet or signature"
            });
        }

        const address = wallet.toLowerCase();

        // Retrieve stored SIWE challenge (never trust client-supplied message/domain/nonce)
        const { data, error } = await supabase
            .from("wallet_nonces")
            .select("*")
            .eq("wallet", address)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(401).json({
                success: false,
                message: "Nonce not found"
            });
        }

        // Check expiration
        if (new Date(data.expires_at).getTime() <= Date.now()) {
            return res.status(401).json({
                success: false,
                message: "Nonce expired"
            });
        }

        // Verify SIWE message bindings and signature
        try {
            await verifySiweChallenge({
                storedMessage: data.message,
                expectedWallet: address,
                expectedNonce: data.nonce,
                signature
            });
        } catch (verifyErr) {
            console.warn("SIWE verification rejected:", verifyErr.message);
            return res.status(401).json({
                success: false,
                message: "Signature verification failed"
            });
        }

        // Atomically consume the single-use nonce before creating a session
        const {
            data: consumed,
            error: deleteError
        } = await supabase
            .from("wallet_nonces")
            .delete()
            .eq("wallet", address)
            .eq("nonce", data.nonce)
            .gt("expires_at", new Date().toISOString())
            .select("nonce")
            .maybeSingle();

        if (deleteError) throw deleteError;

        if (!consumed) {
            return res.status(401).json({
                success: false,
                message: "Nonce already used or expired"
            });
        }

        // Create persistent server-side session; never issue JWT if this fails
        const session = await createSession({
            wallet: address,
            chainId: env.SIWE_CHAIN_ID,
            expiresIn: env.JWT_EXPIRES_IN
        });

        // Generate hardened HS256 JWT bound to persistent session (jti)
        const token = jwt.sign(
            {
                wallet: address,
                chainId: env.SIWE_CHAIN_ID
            },
            env.JWT_SECRET,
            {
                algorithm: "HS256",
                expiresIn: env.JWT_EXPIRES_IN,
                issuer: "eth-wallet-dapp",
                audience: "eth-wallet-api",
                subject: address,
                jwtid: session.session_id
            }
        );

        return res.status(200).json({
            success: true,
            message: "Wallet authenticated successfully",
            wallet: address,
            sessionId: session.session_id,
            expiresAt: session.expires_at,
            token
        });
    } catch (error) {
        console.error("Authentication error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Authentication failed"
        });
    }
}

// Revoke only the current authenticated session
async function logout(req, res) {
    try {
        await revokeSession({
            sessionId: req.sessionId,
            wallet: req.wallet
        });

        return res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        console.error("Logout error:", error.message);

        return res.status(503).json({
            success: false,
            message: "Authentication service unavailable"
        });
    }
}

module.exports = {
    generateNonce,
    verifySignature,
    logout
};
