const express = require("express");

const {
    generateNonce,
    verifySignature,
    logout
} = require("../controllers/authController");

const {
    protect
} = require("../middleware/authMiddleware");

const {
    nonceLimiter,
    verifyLimiter,
    logoutLimiter
} = require("../middleware/rateLimitMiddleware");

const {
    validate
} = require("../middleware/validationMiddleware");

const {
    nonceBodySchema,
    verifyBodySchema
} = require("../validators/requestSchemas");

const router = express.Router();

router.post("/nonce", nonceLimiter, validate(nonceBodySchema, "body"), generateNonce);

router.post("/verify", verifyLimiter, validate(verifyBodySchema, "body"), verifySignature);

// Revoke active server-side session
router.post("/logout", protect, logoutLimiter, logout);

// Test authenticated wallet and session
router.get("/me", protect, (req, res) => {

    res.status(200).json({
        success: true,
        wallet: req.wallet,
        sessionId: req.sessionId
    });

});

module.exports = router;
