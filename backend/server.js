// Validate and load environment configuration before initializing services
const env = require("./config/env");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// Import Supabase client and blockchain provider
const supabase = require("./config/supabase");
const { provider } = require("./services/blockchainService");
const transactionRoutes = require("./routes/transactionRoutes");
const authRoutes = require("./routes/authRoutes");
const syncRoutes = require("./routes/syncRoutes");
const { globalLimiter } = require("./middleware/rateLimitMiddleware");

const app = express();
app.disable("x-powered-by");

// Trust single reverse-proxy hop in production (Render TLS proxy) for accurate client IP rate limiting
if (env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

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

// Root service banner
app.get("/", (req, res) => {
    res.json({
        message: "Ethereum Wallet Backend is running"
    });
});

// Process liveness check for Render (must remain fast and independent of external services)
app.get("/health", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
        status: "ok",
        service: "eth-wallet-backend",
        uptimeSeconds: Math.floor(process.uptime())
    });
});

// Dependency readiness check (database + Sepolia RPC) without exposing internal details
app.get("/health/ready", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const CHECK_TIMEOUT_MS = 3000;

    const withTimeout = (promise) => {
        let timer;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Dependency check timed out")),
                    CHECK_TIMEOUT_MS
                );
            })
        ]).finally(() => clearTimeout(timer));
    };

    let database = "down";
    let blockchainRpc = "down";

    try {
        const { error } = await withTimeout(
            supabase.from("transactions").select("id", { count: "exact", head: true })
        );
        if (!error) {
            database = "up";
        }
    } catch (error) {
        console.error("Readiness DB check failed:", error?.message || "Unknown error");
    }

    try {
        await withTimeout(provider.getBlockNumber());
        blockchainRpc = "up";
    } catch (error) {
        console.error("Readiness RPC check failed:", error?.message || "Unknown error");
    }

    const ready = database === "up" && blockchainRpc === "up";
    return res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "degraded",
        dependencies: {
            database,
            blockchainRpc
        }
    });
});

// Restrict local DB debug endpoint to non-production environments
if (env.NODE_ENV !== "production") {
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
            console.error("Database test error:", error?.message || "Unknown error");

            res.status(500).json({
                success: false,
                message: "Database connection failed"
            });
        }
    });
}

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
    const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on port ${PORT} (${env.NODE_ENV})`);
    });

    const shutdown = (signal) => {
        console.log(`Received ${signal}; shutting down gracefully...`);
        server.close(() => {
            process.exit(0);
        });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;