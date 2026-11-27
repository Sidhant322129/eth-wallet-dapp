const SENSITIVE_KEY_RE =
    /^(authorization|cookie|set-cookie|token|jwt|secret|password|privatekey|apikey|signature|supabase_secret_key|sepolia_rpc_url|rpc_url|jwt_secret)$/i;

function maskWallet(address) {
    if (typeof address !== "string" || address.length < 10) return "[redacted]";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function redactString(value) {
    if (typeof value !== "string") return value;
    return value
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
        .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]")
        .replace(/sb_secret_[A-Za-z0-9_-]{6,}/g, "[REDACTED_SUPABASE_KEY]")
        .replace(/(alchemy\.com\/v2\/)[A-Za-z0-9_-]+/gi, "$1[REDACTED]")
        .replace(/\b0x[a-fA-F0-9]{130}\b/g, "[REDACTED_SIGNATURE]");
}

function sanitizeValue(value, depth = 0) {
    if (depth > 4 || value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (SENSITIVE_KEY_RE.test(k)) {
                out[k] = "[REDACTED]";
            } else if (k === "wallet" && typeof v === "string") {
                out[k] = maskWallet(v);
            } else {
                out[k] = sanitizeValue(v, depth + 1);
            }
        }
        return out;
    }
    return String(value);
}

function writeLog(level, event, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        service: "eth-wallet-backend",
        event,
        ...sanitizeValue(meta)
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.log(line);
    }
    return entry;
}

const logger = {
    info: (event, meta) => writeLog("info", event, meta),
    warn: (event, meta) => writeLog("warn", event, meta),
    error: (event, meta) => writeLog("error", event, meta),
    maskWallet,
    redactString,
    sanitizeValue
};

module.exports = logger;
