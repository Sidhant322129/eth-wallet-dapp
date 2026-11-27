const test = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../utils/logger");
const supabase = require("../config/supabase");
const { provider } = require("../services/blockchainService");
const app = require("../server");

test.describe("Phase 5.7 — Structured Logging, Redaction & Correlation IDs", () => {
    let server;
    let baseUrl;
    let origSupabaseFrom;
    let origGetBlockNumber;

    test.before(async () => {
        origSupabaseFrom = supabase.from;
        origGetBlockNumber = provider.getBlockNumber;

        supabase.from = () => ({
            select: async () => ({ count: 0, error: null })
        });
        provider.getBlockNumber = async () => 12222900;

        await new Promise((resolve) => {
            server = app.listen(0, "127.0.0.1", () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    test.after(async () => {
        supabase.from = origSupabaseFrom;
        provider.getBlockNumber = origGetBlockNumber;
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test("logger redacts JWTs, Bearer tokens, Supabase keys, Alchemy paths, signatures, and masks wallets", () => {
        const sanitized = logger.sanitizeValue({
            authorization: "Bearer secret-jwt-token",
            jwt_secret: "super-secret-value",
            signature: "0x" + "ab".repeat(65),
            wallet: "0x1234567890abcdef1234567890abcdef12345678",
            msg: "Failed calling https://eth-sepolia.g.alchemy.com/v2/mySecretAlchemyKey with sb_secret_abc123456789 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig123456789"
        });

        assert.equal(sanitized.authorization, "[REDACTED]");
        assert.equal(sanitized.jwt_secret, "[REDACTED]");
        assert.equal(sanitized.signature, "[REDACTED]");
        assert.equal(sanitized.wallet, "0x1234...5678");
        assert.ok(!sanitized.msg.includes("mySecretAlchemyKey"));
        assert.ok(!sanitized.msg.includes("sb_secret_abc123456789"));
        assert.ok(!sanitized.msg.includes("eyJhbGciOiJIUzI1NiJ9"));
    });

    test("X-Request-Id is generated when absent, propagated when valid, and replaced when invalid", async () => {
        const res1 = await fetch(`${baseUrl}/health`);
        const generatedId = res1.headers.get("x-request-id");
        assert.equal(res1.status, 200);
        assert.match(generatedId, /^[0-9a-f-]{36}$/i);

        const validCustomId = "req-trace-12345678";
        const res2 = await fetch(`${baseUrl}/health`, {
            headers: { "X-Request-Id": validCustomId }
        });
        assert.equal(res2.headers.get("x-request-id"), validCustomId);

        const res3 = await fetch(`${baseUrl}/health`, {
            headers: { "X-Request-Id": "bad id with spaces; <script>" }
        });
        const replacedId = res3.headers.get("x-request-id");
        assert.notEqual(replacedId, "bad id with spaces; <script>");
        assert.match(replacedId, /^[0-9a-f-]{36}$/i);
    });

    test("GET /health/ready returns 503 degraded without exposing internal error details when dependencies fail", async () => {
        supabase.from = () => ({
            select: async () => {
                throw new Error("Connection string secret leaked");
            }
        });
        provider.getBlockNumber = async () => {
            throw new Error("https://eth-sepolia.g.alchemy.com/v2/secretKey999 failed");
        };

        const res = await fetch(`${baseUrl}/health/ready`);
        const body = await res.json();
        assert.equal(res.status, 503);
        assert.equal(body.status, "degraded");
        assert.deepEqual(body.dependencies, {
            database: "down",
            blockchainRpc: "down"
        });
        assert.equal(JSON.stringify(body).includes("secretKey999"), false);

        // Verify dependency recovery transitions 503 degraded -> 200 ready
        supabase.from = () => ({ select: async () => ({ count: 0, error: null }) });
        provider.getBlockNumber = async () => 12222901;
        const recovered = await fetch(`${baseUrl}/health/ready`);
        const recoveredBody = await recovered.json();
        assert.equal(recovered.status, 200);
        assert.equal(recoveredBody.status, "ready");
    });

    test("logger redacts deeply nested private keys, apiKeys, rpc_url and malformed JSON returns sanitized error", async () => {
        const nested = logger.sanitizeValue({
            nested: {
                privateKey: "0x" + "12".repeat(32),
                apiKey: "alchemy_secret_key_value",
                rpc_url: "https://eth-sepolia.g.alchemy.com/v2/secretPart"
            }
        });
        assert.equal(nested.nested.privateKey, "[REDACTED]");
        assert.equal(nested.nested.apiKey, "[REDACTED]");
        assert.equal(nested.nested.rpc_url, "[REDACTED]");

        const badJsonRes = await fetch(`${baseUrl}/api/auth/nonce`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{invalid-json"
        });
        const badJsonBody = await badJsonRes.json();
        assert.equal(badJsonRes.status, 400);
        assert.equal(badJsonBody.message, "Malformed JSON request body");
        assert.equal(badJsonBody.stack, undefined);
    });
});
