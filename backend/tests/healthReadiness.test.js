const test = require("node:test");
const assert = require("node:assert/strict");

const env = require("../config/env");
const supabase = require("../config/supabase");
const { provider } = require("../services/blockchainService");
const app = require("../server");

test.describe("Phase 5.4 — Production Health, Readiness, Security Headers & Env Validation", () => {
    let server;
    let baseUrl;
    let origSupabaseFrom;
    let origGetBlockNumber;
    let dbHealthy = true;
    let rpcHealthy = true;

    test.before(async () => {
        origSupabaseFrom = supabase.from;
        origGetBlockNumber = provider.getBlockNumber;

        supabase.from = (table) => {
            if (table === "transactions") {
                return {
                    select: async () =>
                        dbHealthy
                            ? { count: 0, error: null }
                            : { count: null, error: new Error("Simulated DB down") }
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        };

        provider.getBlockNumber = async () => {
            if (!rpcHealthy) {
                throw new Error("Simulated RPC down");
            }
            return 12203950;
        };

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

    test("GET /health returns minimal HTTP 200 without sensitive info or DB dependency", async () => {
        dbHealthy = false;
        rpcHealthy = false;

        const res = await fetch(`${baseUrl}/health`, {
            headers: { Origin: env.ALLOWED_ORIGINS_LIST[0] }
        });
        const body = await res.json();

        assert.equal(res.status, 200);
        assert.equal(body.status, "ok");
        assert.equal(body.service, "eth-wallet-backend");
        assert.equal(typeof body.uptimeSeconds, "number");
        assert.equal(res.headers.get("cache-control"), "no-store");
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
        assert.equal(res.headers.get("x-powered-by"), null);
        assert.equal(
            res.headers.get("access-control-allow-origin"),
            env.ALLOWED_ORIGINS_LIST[0]
        );
        assert.equal(body.dependencies, undefined);
    });

    test("GET /health/ready distinguishes healthy (200) vs degraded (503) dependencies", async () => {
        dbHealthy = true;
        rpcHealthy = true;

        const okRes = await fetch(`${baseUrl}/health/ready`);
        const okBody = await okRes.json();
        assert.equal(okRes.status, 200);
        assert.equal(okBody.status, "ready");
        assert.deepEqual(okBody.dependencies, {
            database: "up",
            blockchainRpc: "up"
        });

        dbHealthy = false;
        rpcHealthy = true;
        const degRes = await fetch(`${baseUrl}/health/ready`);
        const degBody = await degRes.json();
        assert.equal(degRes.status, 503);
        assert.equal(degBody.status, "degraded");
        assert.deepEqual(degBody.dependencies, {
            database: "down",
            blockchainRpc: "up"
        });
    });

    test("CORS rejects disallowed origin on health/API responses", async () => {
        const res = await fetch(`${baseUrl}/health`, {
            headers: { Origin: "https://evil.example.com" }
        });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("access-control-allow-origin"), null);
    });

    test("validateEnv enforces strict HTTPS origins and SIWE alignment in production mode", () => {
        const validProd = env.validateEnv({
            NODE_ENV: "production",
            PORT: "10000",
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SECRET_KEY: "sb_secret_ci_test_only_placeholder_key_12345",
            SEPOLIA_RPC_URL: "https://ci-mock-rpc.invalid",
            CONTRACT_ADDRESS: "0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67",
            JWT_SECRET: "ci_test_only_jwt_secret_0123456789abcdef0123456789abcdef01234567",
            JWT_EXPIRES_IN: "1h",
            CONTRACT_DEPLOYMENT_BLOCK: "12203912",
            SYNC_BLOCK_RANGE: "10",
            SYNC_MAX_BLOCKS: "200",
            SYNC_CONFIRMATIONS: "12",
            ALLOWED_ORIGINS: "https://wallet.example.com",
            SIWE_DOMAIN: "wallet.example.com",
            SIWE_URI: "https://wallet.example.com",
            SIWE_CHAIN_ID: "11155111",
            NONCE_TTL_SECONDS: "300"
        });
        assert.equal(validProd.NODE_ENV, "production");
        assert.equal(validProd.PORT, 10000);

        assert.throws(
            () =>
                env.validateEnv({
                    NODE_ENV: "production",
                    PORT: "10000",
                    SUPABASE_URL: "https://example.supabase.co",
                    SUPABASE_SECRET_KEY: "sb_secret_ci_test_only_placeholder_key_12345",
                    SEPOLIA_RPC_URL: "https://ci-mock-rpc.invalid",
                    CONTRACT_ADDRESS: "0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67",
                    JWT_SECRET: "ci_test_only_jwt_secret_0123456789abcdef0123456789abcdef01234567",
                    CONTRACT_DEPLOYMENT_BLOCK: "12203912",
                    ALLOWED_ORIGINS: "http://wallet.example.com",
                    SIWE_DOMAIN: "wallet.example.com",
                    SIWE_URI: "https://wallet.example.com"
                }),
            /Invalid environment configuration/
        );
    });
});
