const { rateLimit } = require("express-rate-limit");
const { isAddress } = require("ethers");

/**
 * Reusable rate limiter factory.
 * Uses modern standard RateLimit headers and disables legacy X-RateLimit headers.
 * Express-rate-limit automatically includes Retry-After on HTTP 429 responses.
 */
function createRateLimiter({
    windowMs,
    limit,
    message,
    keyGenerator,
    requireWallet = false
}) {
    const options = {
        windowMs,
        limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (req, res, _next, opts) => {
            return res.status(opts.statusCode).json({
                success: false,
                message
            });
        }
    };

    if (keyGenerator) {
        options.keyGenerator = keyGenerator;
    }

    const limiter = rateLimit(options);

    if (!requireWallet) {
        return limiter;
    }

    // Fail safely if a wallet-scoped limiter is invoked without a verified req.wallet
    return (req, res, next) => {
        if (typeof req.wallet !== "string" || !isAddress(req.wallet)) {
            return res.status(401).json({
                success: false,
                message: "Authentication token required"
            });
        }
        return limiter(req, res, next);
    };
}

// 1. Global IP limiter: 300 requests per 15 minutes per IP
const globalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    message: "Too many requests from this IP. Please try again later."
});

// 2. Nonce IP limiter: 10 requests per 5 minutes per IP
const nonceLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    limit: 10,
    message: "Too many authentication challenge requests. Please wait before trying again."
});

// 3. Signature verification IP limiter: 10 requests per 5 minutes per IP
const verifyLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    limit: 10,
    message: "Too many login verification attempts. Please wait before trying again."
});

// 4. Transaction history wallet limiter: 60 requests per minute per authenticated wallet
const historyLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    limit: 60,
    requireWallet: true,
    keyGenerator: (req) => req.wallet,
    message: "Too many history requests for this wallet. Please wait a moment."
});

// 5. Transaction save wallet limiter: 20 requests per minute per authenticated wallet
const transactionLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    limit: 20,
    requireWallet: true,
    keyGenerator: (req) => req.wallet,
    message: "Too many transaction save requests for this wallet. Please wait a moment."
});

// 6. Historical sync wallet limiter: 10 requests per minute per authenticated wallet
const syncLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    limit: 10,
    requireWallet: true,
    keyGenerator: (req) => req.wallet,
    message: "Too many synchronization requests for this wallet. Please wait before retrying."
});

// 7. Logout wallet limiter: 20 requests per minute per authenticated wallet
const logoutLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    limit: 20,
    requireWallet: true,
    keyGenerator: (req) => req.wallet,
    message: "Too many logout requests for this wallet. Please wait a moment."
});

module.exports = {
    createRateLimiter,
    globalLimiter,
    nonceLimiter,
    verifyLimiter,
    historyLimiter,
    transactionLimiter,
    syncLimiter,
    logoutLimiter
};
