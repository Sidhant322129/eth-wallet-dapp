const express = require("express");

const {
    saveTransaction,
    getTransactions
} = require("../controllers/transactionController");

const {
    protect
} = require("../middleware/authMiddleware");

const {
    transactionLimiter,
    historyLimiter
} = require("../middleware/rateLimitMiddleware");

const {
    validate
} = require("../middleware/validationMiddleware");

const {
    saveTransactionBodySchema,
    walletParamSchema
} = require("../validators/requestSchemas");

const router = express.Router();

// Protected transaction routes with per-wallet rate limiting and input validation
router.post("/", protect, transactionLimiter, validate(saveTransactionBodySchema, "body"), saveTransaction);
router.get("/:wallet", protect, historyLimiter, validate(walletParamSchema, "params"), getTransactions);

module.exports = router;
