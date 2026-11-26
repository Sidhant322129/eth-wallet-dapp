const express = require("express");
const { syncHistory } = require("../controllers/syncController");
const { protect } = require("../middleware/authMiddleware");
const { syncLimiter } = require("../middleware/rateLimitMiddleware");
const { validate } = require("../middleware/validationMiddleware");
const { syncBodySchema } = require("../validators/requestSchemas");

const router = express.Router();

// Protected synchronization endpoint with per-wallet rate limiting and input validation
router.post("/", protect, syncLimiter, validate(syncBodySchema, "body"), syncHistory);

module.exports = router;
