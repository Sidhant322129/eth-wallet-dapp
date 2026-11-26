// Validate and load environment configuration before initializing services
const env = require("./config/env");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// Import Supabase client
const supabase = require("./config/supabase");
const transactionRoutes = require("./routes/transactionRoutes");
const authRoutes = require("./routes/authRoutes");
const syncRoutes = require("./routes/syncRoutes");
const { globalLimiter } = require("./middleware/rateLimitMiddleware");

const app = express();

// Security headers (HSTS disabled on local HTTP dev, enabled in production)
app.use(
    helmet({
        strictTransportSecurity:
            env.NODE_ENV === "production"
                ? undefined
                : false
    })
);

// Middleware
app.use(cors({
    origin: env.ALLOWED_ORIGINS_LIST,
    exposedHeaders: ["Retry-After", "RateLimit", "RateLimit-Policy"]
}));

app.use("/api", globalLimiter);

// Prevent caching of authentication and protected API responses (including errors)
function noStore(req, res, next) {
    res.setHeader("Cache-Control", "no-store");
    next();
}

app.use(["/api/auth", "/api/transactions", "/api/sync"], noStore);

// Enforce JSON Content-Type on JSON endpoints while preserving bodyless POST /api/sync
function requireJsonContentType(req, res, next) {
    if (req.method !== "POST") {
        return next();
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    const hasBody = contentLength > 0 || Boolean(req.headers["transfer-encoding"]);

    if ((req.baseUrl === "/api/sync" || req.path === "/logout") && !hasBody) {
        return next();
    }

    if (!req.is("application/json")) {
        return res.status(415).json({
            success: false,
            message: "Unsupported Media Type: Content-Type must be application/json"
        });
    }

    next();
}

app.use(["/api/auth", "/api/transactions", "/api/sync"], requireJsonContentType);
app.use(express.json({ limit: "10kb" }));
app.use("/api/auth", authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/sync", syncRoutes);

// Test backend API
app.get("/", (req, res) => {
    res.json({
        message: "Ethereum Wallet Backend is running"
    });
});

// Test Supabase database connection
app.get("/api/test-db", async (req, res) => {

    try {

        const { count, error } = await supabase
            .from("transactions")
            .select("*", {
                count: "exact",
                head: true
            });

        if (error) {
            throw error;
        }

        res.status(200).json({
            success: true,
            message: "Supabase connected successfully",
            transactionCount: count
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// Centralized JSON parsing, payload size, and fallback error handler
app.use((err, req, res, next) => {
    if (err && (err.type === "entity.too.large" || err.status === 413)) {
        return res.status(413).json({
            success: false,
            message: "Request payload too large"
        });
    }

    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({
            success: false,
            message: "Malformed JSON request body"
        });
    }

    console.error("Unhandled server error:", err?.message || "Unknown error");

    return res.status(err?.status || 500).json({
        success: false,
        message: "Internal server error"
    });
});

// Server port
const PORT = env.PORT;

// Start server only when executed directly (allows importing app in tests)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;