const jwt = require("jsonwebtoken");
const { isAddress } = require("ethers");
const env = require("../config/env");
const {
    UUID_REGEX,
    validateActiveSession
} = require("../services/sessionService");

async function protect(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication token required"
        });
    }

    let decoded;
    try {
        const token = authHeader.split(" ")[1];

        decoded = jwt.verify(token, env.JWT_SECRET, {
            algorithms: ["HS256"],
            issuer: "eth-wallet-dapp",
            audience: "eth-wallet-api"
        });
    } catch {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }

    // Reject legacy tokens or tokens missing required session claims
    if (
        !decoded ||
        typeof decoded.wallet !== "string" ||
        !isAddress(decoded.wallet) ||
        typeof decoded.sub !== "string" ||
        !isAddress(decoded.sub) ||
        decoded.wallet.toLowerCase() !== decoded.sub.toLowerCase() ||
        typeof decoded.jti !== "string" ||
        !UUID_REGEX.test(decoded.jti) ||
        !Number.isSafeInteger(Number(decoded.chainId)) ||
        Number(decoded.chainId) !== env.SIWE_CHAIN_ID ||
        typeof decoded.iat !== "number" ||
        typeof decoded.exp !== "number"
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }

    try {
        const sessionCheck = await validateActiveSession({
            sessionId: decoded.jti,
            wallet: decoded.wallet,
            chainId: decoded.chainId
        });

        if (!sessionCheck.valid) {
            return res.status(401).json({
                success: false,
                message: "Session expired or revoked"
            });
        }

        req.wallet = decoded.wallet.toLowerCase();
        req.sessionId = decoded.jti;

        next();
    } catch (error) {
        console.error("Session validation error:", error.message);

        // Fail closed when authentication database is unavailable
        return res.status(503).json({
            success: false,
            message: "Authentication service unavailable"
        });
    }
}

module.exports = { protect };
