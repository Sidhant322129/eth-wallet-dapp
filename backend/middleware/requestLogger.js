const crypto = require("crypto");
const logger = require("../utils/logger");

const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

function requestLogger(req, res, next) {
    const incomingId = req.headers["x-request-id"];
    const requestId =
        typeof incomingId === "string" && VALID_REQUEST_ID_RE.test(incomingId)
            ? incomingId
            : crypto.randomUUID();

    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    const startNs = process.hrtime.bigint();
    res.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
        const level =
            res.statusCode >= 500
                ? "error"
                : res.statusCode >= 400
                    ? "warn"
                    : "info";

        logger[level]("http_request", {
            requestId,
            method: req.method,
            path: `${req.baseUrl || ""}${req.path || "/"}`,
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100
        });
    });

    next();
}

module.exports = { requestLogger };
