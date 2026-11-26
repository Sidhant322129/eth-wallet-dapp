const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { z } = require("zod");
const { isAddress } = require("ethers");

// Load backend/.env once before validating configuration
const envFilePath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envFilePath)) {
    dotenv.config({ path: envFilePath });
}

/**
 * Inspect a .env file for duplicate variable declarations without exposing values.
 * @param {string} filePath
 * @returns {string[]}
 */
function findDuplicateEnvKeys(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const counts = new Map();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([key]) => key);
}

const duplicateKeys = findDuplicateEnvKeys(envFilePath);
if (duplicateKeys.length > 0) {
    console.warn(
        `[env] Warning: Duplicate declarations in backend/.env for: ${duplicateKeys.join(", ")}`
    );
}

// Strict integer parser that rejects empty strings, whitespace, decimals, and NaN
function parseStrictInt(fieldName, { min, max }) {
    return z.preprocess(
        (val) => {
            if (val === undefined) return undefined;
            if (typeof val === "number") return val;
            if (typeof val !== "string") return NaN;
            const trimmed = val.trim();
            if (!/^-?\d+$/.test(trimmed)) return NaN;
            return Number(trimmed);
        },
        z
            .number({ error: `${fieldName} must be an integer` })
            .int(`${fieldName} must be an integer`)
            .refine(Number.isSafeInteger, `${fieldName} must be a safe integer`)
            .refine((n) => n >= min, `${fieldName} must be >= ${min}`)
            .refine(
                (n) => max === undefined || n <= max,
                `${fieldName} must be <= ${max}`
            )
    );
}

function isValidUrlWithProtocols(value, allowedProtocols) {
    try {
        const parsed = new URL(value);
        return allowedProtocols.includes(parsed.protocol);
    } catch {
        return false;
    }
}

const envSchema = z
    .object({
        NODE_ENV: z
            .enum(["development", "test", "production"])
            .default("development"),

        PORT: parseStrictInt("PORT", { min: 1, max: 65535 }).default(5000),

        SUPABASE_URL: z
            .string({ error: "SUPABASE_URL is required" })
            .trim()
            .min(1, "SUPABASE_URL cannot be empty")
            .refine((v) => isValidUrlWithProtocols(v, ["https:"]), {
                message: "SUPABASE_URL must be a valid https:// URL"
            }),

        // Validate Supabase secret credential type without exposing its value
        SUPABASE_SECRET_KEY: z
            .string({ error: "SUPABASE_SECRET_KEY is required" })
            .trim()
            .min(20, "SUPABASE_SECRET_KEY is missing or too short")
            .refine((v) => !v.startsWith("sb_publishable_"), {
                message: "SUPABASE_SECRET_KEY must not be a publishable/anon key"
            })
            .refine(
                (v) => v.startsWith("sb_secret_") || v.startsWith("eyJ"),
                {
                    message:
                        "SUPABASE_SECRET_KEY must be a valid Supabase secret or service_role key"
                }
            ),

        SEPOLIA_RPC_URL: z
            .string({ error: "SEPOLIA_RPC_URL is required" })
            .trim()
            .min(1, "SEPOLIA_RPC_URL cannot be empty")
            .refine((v) => isValidUrlWithProtocols(v, ["https:", "http:"]), {
                message: "SEPOLIA_RPC_URL must be a valid http:// or https:// URL"
            }),

        CONTRACT_ADDRESS: z
            .string({ error: "CONTRACT_ADDRESS is required" })
            .trim()
            .refine((v) => isAddress(v), {
                message: "CONTRACT_ADDRESS must be a valid Ethereum address"
            }),

        // Length alone does not guarantee cryptographic randomness/entropy;
        // enforce >= 64 chars and reject trivial low-uniqueness/placeholder strings
        JWT_SECRET: z
            .string({ error: "JWT_SECRET is required" })
            .trim()
            .min(64, "JWT_SECRET must be at least 64 characters")
            .refine((v) => new Set(v).size >= 8, {
                message: "JWT_SECRET has insufficient character diversity"
            })
            .refine(
                (v) => !/^(secret|changeme|placeholder|your_)/i.test(v),
                {
                    message: "JWT_SECRET must not be a placeholder value"
                }
            ),

        JWT_EXPIRES_IN: z
            .string()
            .trim()
            .default("1h")
            .refine((v) => /^\d+(s|m|h|d)$/.test(v), {
                message: "JWT_EXPIRES_IN must match <number>(s|m|h|d), e.g. 1h"
            }),

        CONTRACT_DEPLOYMENT_BLOCK: parseStrictInt(
            "CONTRACT_DEPLOYMENT_BLOCK",
            { min: 0 }
        ),

        SYNC_BLOCK_RANGE: parseStrictInt("SYNC_BLOCK_RANGE", {
            min: 1,
            max: 10
        }).default(10),

        SYNC_MAX_BLOCKS: parseStrictInt("SYNC_MAX_BLOCKS", {
            min: 1
        }).default(200),

        SYNC_CONFIRMATIONS: parseStrictInt("SYNC_CONFIRMATIONS", {
            min: 0
        }).default(12),

        ALLOWED_ORIGINS: z.string().optional(),

        // SIWE (EIP-4361) configuration
        SIWE_DOMAIN: z.string().trim().optional(),
        SIWE_URI: z.string().trim().optional(),
        SIWE_CHAIN_ID: parseStrictInt("SIWE_CHAIN_ID", { min: 1 }).default(
            11155111
        ),
        NONCE_TTL_SECONDS: parseStrictInt("NONCE_TTL_SECONDS", {
            min: 30,
            max: 900
        }).default(300)
    })
    .superRefine((data, ctx) => {
        if (data.SYNC_BLOCK_RANGE > data.SYNC_MAX_BLOCKS) {
            ctx.addIssue({
                code: "custom",
                path: ["SYNC_BLOCK_RANGE"],
                message: "SYNC_BLOCK_RANGE cannot exceed SYNC_MAX_BLOCKS"
            });
        }

        const rawOrigins =
            data.ALLOWED_ORIGINS !== undefined
                ? data.ALLOWED_ORIGINS.trim()
                : data.NODE_ENV === "production"
                    ? ""
                    : "http://localhost:5173,http://localhost:5174";

        if (!rawOrigins) {
            ctx.addIssue({
                code: "custom",
                path: ["ALLOWED_ORIGINS"],
                message: "ALLOWED_ORIGINS is required in production"
            });
            return;
        }

        const origins = rawOrigins
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean);

        if (origins.length === 0) {
            ctx.addIssue({
                code: "custom",
                path: ["ALLOWED_ORIGINS"],
                message: "ALLOWED_ORIGINS must contain at least one valid origin"
            });
            return;
        }

        const parsedOrigins = [];
        for (const origin of origins) {
            if (origin === "*" || origin.includes("*")) {
                ctx.addIssue({
                    code: "custom",
                    path: ["ALLOWED_ORIGINS"],
                    message: "ALLOWED_ORIGINS must not contain wildcard (*)"
                });
                return;
            }

            const allowedProtocols =
                data.NODE_ENV === "production"
                    ? ["https:"]
                    : ["http:", "https:"];

            if (!isValidUrlWithProtocols(origin, allowedProtocols)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["ALLOWED_ORIGINS"],
                    message:
                        data.NODE_ENV === "production"
                            ? "Production ALLOWED_ORIGINS must be valid https:// URLs"
                            : "ALLOWED_ORIGINS must contain valid http:// or https:// URLs"
                });
                return;
            }
            parsedOrigins.push(new URL(origin).origin);
        }

        // SIWE domain and URI validation
        const siweDomain =
            data.SIWE_DOMAIN !== undefined
                ? data.SIWE_DOMAIN
                : data.NODE_ENV === "production"
                    ? ""
                    : "localhost:5173";

        const siweUri =
            data.SIWE_URI !== undefined
                ? data.SIWE_URI
                : data.NODE_ENV === "production"
                    ? ""
                    : "http://localhost:5173";

        if (!siweDomain || /[:/]{2}|[/?#]/.test(siweDomain)) {
            ctx.addIssue({
                code: "custom",
                path: ["SIWE_DOMAIN"],
                message:
                    "SIWE_DOMAIN must be a valid host[:port] without protocol or path"
            });
        }

        const siweProtocols =
            data.NODE_ENV === "production" ? ["https:"] : ["http:", "https:"];

        if (!siweUri || !isValidUrlWithProtocols(siweUri, siweProtocols)) {
            ctx.addIssue({
                code: "custom",
                path: ["SIWE_URI"],
                message:
                    data.NODE_ENV === "production"
                        ? "Production SIWE_URI must be a valid https:// URL"
                        : "SIWE_URI must be a valid http:// or https:// URL"
            });
            return;
        }

        const parsedSiweUri = new URL(siweUri);
        if (siweDomain && parsedSiweUri.host !== siweDomain) {
            ctx.addIssue({
                code: "custom",
                path: ["SIWE_DOMAIN"],
                message: "SIWE_DOMAIN must match SIWE_URI host"
            });
        }

        if (!parsedOrigins.includes(parsedSiweUri.origin)) {
            ctx.addIssue({
                code: "custom",
                path: ["SIWE_URI"],
                message: "SIWE_URI origin must be explicitly permitted by ALLOWED_ORIGINS"
            });
        }
    });

/**
 * Validate environment object without ever exposing raw credential values.
 * @param {Record<string, unknown>} rawEnv
 */
function validateEnv(rawEnv = process.env) {
    const result = envSchema.safeParse({
        NODE_ENV: rawEnv.NODE_ENV,
        PORT: rawEnv.PORT,
        SUPABASE_URL: rawEnv.SUPABASE_URL,
        SUPABASE_SECRET_KEY: rawEnv.SUPABASE_SECRET_KEY,
        SEPOLIA_RPC_URL: rawEnv.SEPOLIA_RPC_URL,
        CONTRACT_ADDRESS: rawEnv.CONTRACT_ADDRESS,
        JWT_SECRET: rawEnv.JWT_SECRET,
        JWT_EXPIRES_IN: rawEnv.JWT_EXPIRES_IN,
        CONTRACT_DEPLOYMENT_BLOCK: rawEnv.CONTRACT_DEPLOYMENT_BLOCK,
        SYNC_BLOCK_RANGE: rawEnv.SYNC_BLOCK_RANGE,
        SYNC_MAX_BLOCKS: rawEnv.SYNC_MAX_BLOCKS,
        SYNC_CONFIRMATIONS: rawEnv.SYNC_CONFIRMATIONS,
        ALLOWED_ORIGINS: rawEnv.ALLOWED_ORIGINS,
        SIWE_DOMAIN: rawEnv.SIWE_DOMAIN,
        SIWE_URI: rawEnv.SIWE_URI,
        SIWE_CHAIN_ID: rawEnv.SIWE_CHAIN_ID,
        NONCE_TTL_SECONDS: rawEnv.NONCE_TTL_SECONDS
    });

    if (!result.success) {
        const failedFields = result.error.issues.map((issue) => ({
            field: issue.path.join(".") || "ENV",
            message: issue.message
        }));
        const fieldNames = [...new Set(failedFields.map((f) => f.field))];
        const err = new Error(
            `Invalid environment configuration for: ${fieldNames.join(", ")}`
        );
        err.fields = failedFields;
        throw err;
    }

    const rawOrigins =
        result.data.ALLOWED_ORIGINS !== undefined
            ? result.data.ALLOWED_ORIGINS.trim()
            : "http://localhost:5173,http://localhost:5174";

    const allowedOriginsList = rawOrigins
        .split(",")
        .map((o) => new URL(o.trim()).origin);

    const siweDomain = result.data.SIWE_DOMAIN || "localhost:5173";
    const siweUri = result.data.SIWE_URI || "http://localhost:5173";

    return {
        ...result.data,
        SIWE_DOMAIN: siweDomain,
        SIWE_URI: siweUri,
        ALLOWED_ORIGINS_LIST: allowedOriginsList
    };
}

let validatedEnv;
try {
    validatedEnv = validateEnv(process.env);
} catch (error) {
    console.error(`[env] Startup aborted: ${error.message}`);
    process.exit(1);
}

module.exports = {
    ...validatedEnv,
    validateEnv,
    findDuplicateEnvKeys
};
