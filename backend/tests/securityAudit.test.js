const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Interface, Wallet, parseEther } = require("ethers");
const { SiweMessage } = require("siwe");

const env = require("../config/env");
const supabase = require("../config/supabase");
const blockchainService = require("../services/blockchainService");
const { provider } = blockchainService;
const { createRateLimiter } = require("../middleware/rateLimitMiddleware");
const app = require("../server");

const CONTRACT_ABI = [
    "function deposit() payable",
    "function withdraw(uint256 amount)",
    "function withdrawToAddress(address to, uint256 amount)",
    "event Deposited(address indexed user, uint256 amount)",
    "event Withdrawn(address indexed user, address indexed to, uint256 amount)"
];
const iface = new Interface(CONTRACT_ABI);

const walletA = Wallet.createRandom();
const walletB = Wallet.createRandom();
const addrA = walletA.address.toLowerCase();
const addrB = walletB.address.toLowerCase();
const recipientAddr = "0x1b46467eacd2d97be2aa66692fa67b3c96a57660";

function encodeEvent(name, args) {
    const encoded = iface.encodeEventLog(iface.getEvent(name), args);
    return {
        address: env.CONTRACT_ADDRESS,
        topics: encoded.topics,
        data: encoded.data
    };
}

function signJwt(payload, options = {}) {
    return jwt.sign(payload, options.secret || env.JWT_SECRET, {
        algorithm: options.algorithm || "HS256",
        expiresIn: options.expiresIn ?? "1h",
        issuer: options.issuer ?? "eth-wallet-dapp",
        audience: options.audience ?? "eth-wallet-api",
        subject: options.subject,
        jwtid: options.jwtid
    });
}

test.describe("Phase 4.6 — Comprehensive Security Audit Suite (mocked external I/O)", () => {
    let server;
    let baseUrl;

    const mockNonces = new Map();
    const mockSessions = new Map();
    const mockTransactions = new Map();
    const mockSyncState = new Map();
    let failSessionDb = false;
    let nextTxId = 100;

    const origSupabaseFrom = supabase.from.bind(supabase);
    const origGetNetwork = provider.getNetwork.bind(provider);
    const origGetBlockNumber = provider.getBlockNumber.bind(provider);
    const origGetLogs = provider.getLogs.bind(provider);
    const origGetTransaction = provider.getTransaction.bind(provider);
    const origGetTransactionReceipt = provider.getTransactionReceipt.bind(provider);

    function createActiveSession(walletAddr, overrides = {}) {
        const sid = crypto.randomUUID();
        const row = {
            session_id: sid,
            wallet: walletAddr.toLowerCase(),
            chain_id: env.SIWE_CHAIN_ID,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            revoked_at: null,
            ...overrides
        };
        mockSessions.set(sid, row);
        return sid;
    }

    test.before(async () => {
        supabase.from = (table) => {
            if (table === "wallet_nonces") {
                return {
                    delete: () => ({
                        lt: async (_col, nowIso) => {
                            for (const [k, v] of mockNonces.entries()) {
                                if (v.expires_at < nowIso) mockNonces.delete(k);
                            }
                            return { error: null };
                        },
                        eq: (c1, v1) => ({
                            eq: (_c2, v2) => ({
                                gt: (_c3, v3) => ({
                                    select: () => ({
                                        maybeSingle: async () => {
                                            const row = mockNonces.get(v1);
                                            if (!row || row.nonce !== v2 || row.expires_at <= v3) {
                                                return { data: null, error: null };
                                            }
                                            mockNonces.delete(v1);
                                            return { data: { nonce: row.nonce }, error: null };
                                        }
                                    })
                                })
                            })
                        })
                    }),
                    select: () => ({
                        eq: (_col, val) => ({
                            maybeSingle: async () => ({
                                data: mockNonces.get(val) || null,
                                error: null
                            })
                        })
                    }),
                    upsert: async (row) => {
                        mockNonces.set(row.wallet, { ...row });
                        return { error: null };
                    }
                };
            }

            if (table === "wallet_sessions") {
                return {
                    insert: (row) => ({
                        select: () => ({
                            single: async () => {
                                mockSessions.set(row.session_id, { ...row });
                                return { data: { ...row }, error: null };
                            }
                        })
                    }),
                    select: () => ({
                        eq: (_col, val) => ({
                            maybeSingle: async () => {
                                if (failSessionDb) {
                                    return { data: null, error: { message: "DB unavailable" } };
                                }
                                return { data: mockSessions.get(val) || null, error: null };
                            }
                        })
                    }),
                    update: (upd) => ({
                        eq: (_c1, sid) => ({
                            eq: (_c2, wal) => ({
                                is: () => ({
                                    select: () => ({
                                        maybeSingle: async () => {
                                            const s = mockSessions.get(sid);
                                            if (!s || s.wallet !== wal || s.revoked_at !== null) {
                                                return { data: null, error: null };
                                            }
                                            s.revoked_at = upd.revoked_at;
                                            return {
                                                data: { session_id: sid, revoked_at: s.revoked_at },
                                                error: null
                                            };
                                        }
                                    })
                                })
                            })
                        })
                    })
                };
            }

            if (table === "transactions") {
                return {
                    upsert: (row, opts = {}) => ({
                        select: (cols) => {
                            const existing = mockTransactions.get(row.tx_hash);
                            const exec = async () => {
                                if (existing) {
                                    if (opts.ignoreDuplicates) return { data: [], error: null };
                                    return { data: [existing], error: null };
                                }
                                const created = {
                                    id: nextTxId++,
                                    ...row,
                                    created_at: new Date().toISOString()
                                };
                                mockTransactions.set(row.tx_hash, created);
                                return { data: [created], error: null };
                            };
                            const p = exec();
                            return {
                                then: (cb, eb) => p.then(cb, eb),
                                single: async () => {
                                    const r = await p;
                                    return { data: r.data[0] || null, error: r.error };
                                }
                            };
                        }
                    }),
                    select: () => ({
                        eq: (_col, walletVal) => ({
                            order: async () => ({
                                data: Array.from(mockTransactions.values()).filter(
                                    (t) => t.wallet === walletVal
                                ),
                                error: null
                            })
                        }),
                        in: async (_col, hashes) => ({
                            data: hashes
                                .filter((h) => mockTransactions.has(h))
                                .map((h) => ({ tx_hash: h })),
                            error: null
                        })
                    })
                };
            }

            if (table === "wallet_sync_state") {
                return {
                    select: () => ({
                        eq: (_col, wal) => ({
                            maybeSingle: async () => ({
                                data: mockSyncState.has(wal)
                                    ? { last_synced_block: mockSyncState.get(wal) }
                                    : null,
                                error: null
                            })
                        })
                    }),
                    upsert: (row) => ({
                        select: () => ({
                            single: async () => {
                                mockSyncState.set(row.wallet, row.last_synced_block);
                                return {
                                    data: { last_synced_block: row.last_synced_block },
                                    error: null
                                };
                            }
                        })
                    })
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        };

        provider.getNetwork = async () => ({ chainId: 11155111n });
        provider.getBlockNumber = async () => env.CONTRACT_DEPLOYMENT_BLOCK + 50;
        provider.getLogs = async () => [];

        await new Promise((resolve) => {
            server = app.listen(0, () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    test.after(async () => {
        supabase.from = origSupabaseFrom;
        provider.getNetwork = origGetNetwork;
        provider.getBlockNumber = origGetBlockNumber;
        provider.getLogs = origGetLogs;
        provider.getTransaction = origGetTransaction;
        provider.getTransactionReceipt = origGetTransactionReceipt;
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test("Authentication security: JWT claims, session state, SIWE bindings & concurrent nonce", async () => {
        const sid = createActiveSession(addrA);

        // Missing, malformed, tampered, expired, wrong issuer/audience/chainId
        assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 401);
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: "Bearer malformed" } })).status,
            401
        );
        const validJwt = signJwt({ wallet: addrA, chainId: env.SIWE_CHAIN_ID }, { subject: addrA, jwtid: sid });
        const tampered = validJwt.slice(0, -4) + "AAAA";
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${tampered}` } })).status,
            401
        );
        const expiredJwt = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: sid, expiresIn: -10 }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${expiredJwt}` } })).status,
            401
        );
        const badIssuer = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: sid, issuer: "wrong-issuer" }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${badIssuer}` } })).status,
            401
        );
        const badAudience = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: sid, audience: "wrong-aud" }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${badAudience}` } })).status,
            401
        );
        const badChainJwt = signJwt(
            { wallet: addrA, chainId: 1 },
            { subject: addrA, jwtid: sid }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${badChainJwt}` } })).status,
            401
        );

        // Missing, revoked, expired, wallet-mismatched DB sessions
        const missingSidJwt = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: crypto.randomUUID() }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${missingSidJwt}` } })).status,
            401
        );

        const revokedSid = createActiveSession(addrA, { revoked_at: new Date().toISOString() });
        const revokedJwt = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: revokedSid }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${revokedJwt}` } })).status,
            401
        );

        const expiredSid = createActiveSession(addrA, {
            expires_at: new Date(Date.now() - 1000).toISOString()
        });
        const expSessJwt = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: expiredSid }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${expSessJwt}` } })).status,
            401
        );

        const mismatchSid = createActiveSession(addrB);
        const mismatchJwt = signJwt(
            { wallet: addrA, chainId: env.SIWE_CHAIN_ID },
            { subject: addrA, jwtid: mismatchSid }
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${mismatchJwt}` } })).status,
            401
        );

        // Fail-closed DB error -> 503
        failSessionDb = true;
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${validJwt}` } })).status,
            503
        );
        failSessionDb = false;

        // Full SIWE login + concurrent nonce consumption + replay rejection
        const rNonce = await fetch(`${baseUrl}/api/auth/nonce`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet: walletA.address })
        });
        assert.equal(rNonce.status, 200);
        const { message } = await rNonce.json();
        const sig = await walletA.signMessage(message);

        const [rV1, rV2] = await Promise.all([
            fetch(`${baseUrl}/api/auth/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: walletA.address, signature: sig })
            }),
            fetch(`${baseUrl}/api/auth/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: walletA.address, signature: sig })
            })
        ]);
        const statuses = [rV1.status, rV2.status].sort();
        assert.deepEqual(statuses, [200, 401]);

        // Replay after use -> 401
        const rReplay = await fetch(`${baseUrl}/api/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet: walletA.address, signature: sig })
        });
        assert.equal(rReplay.status, 401);

        // Wrong wallet signature, bad domain, bad URI, expired nonce
        const rN2 = await fetch(`${baseUrl}/api/auth/nonce`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet: walletB.address })
        });
        const { message: msgB } = await rN2.json();
        const wrongSig = await walletA.signMessage(msgB);
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: walletB.address, signature: wrongSig })
            })).status,
            401
        );

        const badDomMsg = new SiweMessage({
            domain: "evil.com",
            address: walletB.address,
            statement: "Sign in",
            uri: env.SIWE_URI,
            version: "1",
            chainId: env.SIWE_CHAIN_ID,
            nonce: "badDomainNonce1234",
            issuedAt: new Date().toISOString(),
            expirationTime: new Date(Date.now() + 60_000).toISOString()
        }).prepareMessage();
        mockNonces.set(addrB, {
            wallet: addrB,
            nonce: "badDomainNonce1234",
            message: badDomMsg,
            expires_at: new Date(Date.now() + 60_000).toISOString()
        });
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    wallet: walletB.address,
                    signature: await walletB.signMessage(badDomMsg)
                })
            })).status,
            401
        );

        mockNonces.set(addrB, {
            wallet: addrB,
            nonce: "expiredNonce123456",
            message: msgB,
            expires_at: new Date(Date.now() - 1000).toISOString()
        });
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    wallet: walletB.address,
                    signature: await walletB.signMessage(msgB)
                })
            })).status,
            401
        );
    });

    test("Authorization security: cross-wallet isolation & case normalization", async () => {
        const sidA = createActiveSession(addrA);
        const tokenA = signJwt({ wallet: addrA, chainId: env.SIWE_CHAIN_ID }, { subject: addrA, jwtid: sidA });

        // Own wallet (mixed-case checksum) -> 200
        const rOwn = await fetch(`${baseUrl}/api/transactions/${walletA.address}`, {
            headers: { Authorization: `Bearer ${tokenA}` }
        });
        assert.equal(rOwn.status, 200);

        // Another wallet's history -> 403
        const rOther = await fetch(`${baseUrl}/api/transactions/${walletB.address}`, {
            headers: { Authorization: `Bearer ${tokenA}` }
        });
        assert.equal(rOther.status, 403);

        // Unauthorized sync -> 401
        assert.equal((await fetch(`${baseUrl}/api/sync`, { method: "POST" })).status, 401);
    });

    test("API security: validation, headers, CORS, error sanitization & isolated rate limits", async () => {
        const sidA = createActiveSession(addrA);
        const tokenA = signJwt({ wallet: addrA, chainId: env.SIWE_CHAIN_ID }, { subject: addrA, jwtid: sidA });

        // Invalid address, invalid txHash, extra fields, malformed JSON, 415, 413
        assert.equal(
            (await fetch(`${baseUrl}/api/transactions/not-an-address`, {
                headers: { Authorization: `Bearer ${tokenA}` }
            })).status,
            400
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/transactions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
                body: JSON.stringify({ txHash: "0x123", extra: true })
            })).status,
            400
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/nonce`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{bad"
            })).status,
            400
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/nonce`, {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: "hello"
            })).status,
            415
        );
        assert.equal(
            (await fetch(`${baseUrl}/api/auth/nonce`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: walletA.address, pad: "x".repeat(12_000) })
            })).status,
            413
        );

        // Helmet, Cache-Control: no-store, no X-Powered-By, CORS allowed vs disallowed
        const rHeaders = await fetch(`${baseUrl}/api/transactions/${addrA}`, {
            headers: { Authorization: `Bearer ${tokenA}`, Origin: "http://localhost:5173" }
        });
        assert.equal(rHeaders.status, 200);
        assert.equal(rHeaders.headers.get("x-content-type-options"), "nosniff");
        assert.equal(rHeaders.headers.get("x-frame-options"), "SAMEORIGIN");
        assert.ok(rHeaders.headers.get("content-security-policy"));
        assert.equal(rHeaders.headers.get("cache-control"), "no-store");
        assert.equal(rHeaders.headers.get("x-powered-by"), null);
        assert.equal(rHeaders.headers.get("access-control-allow-origin"), "http://localhost:5173");

        const rDisallowedCors = await fetch(`${baseUrl}/api/sync`, {
            method: "OPTIONS",
            headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" }
        });
        assert.equal(rDisallowedCors.headers.get("access-control-allow-origin"), null);

        // Isolated rate-limit store test (reduced limits; does not affect app limits)
        const rlApp = express();
        const testWalletLimiter = createRateLimiter({
            windowMs: 500,
            limit: 2,
            requireWallet: true,
            keyGenerator: (req) => req.wallet,
            message: "Wallet rate limit exceeded"
        });
        rlApp.get(
            "/rl",
            (req, _res, next) => {
                req.wallet = req.headers["x-w"];
                next();
            },
            testWalletLimiter,
            (_req, res) => res.json({ ok: true })
        );
        const rlSrv = await new Promise((resolve) => {
            const s = rlApp.listen(0, () => resolve(s));
        });
        try {
            const rlUrl = `http://127.0.0.1:${rlSrv.address().port}/rl`;
            assert.equal((await fetch(rlUrl, { headers: { "x-w": addrA } })).status, 200);
            assert.equal((await fetch(rlUrl, { headers: { "x-w": addrA } })).status, 200);
            const r429 = await fetch(rlUrl, { headers: { "x-w": addrA } });
            assert.equal(r429.status, 429);
            assert.ok(r429.headers.get("retry-after"));
            assert.ok(r429.headers.get("ratelimit"));
            // Independent counter for walletB
            assert.equal((await fetch(rlUrl, { headers: { "x-w": addrB } })).status, 200);
        } finally {
            await new Promise((resolve) => rlSrv.close(resolve));
        }
    });

    test("Transaction verification & duplicate/concurrent idempotency", async () => {
        const sidA = createActiveSession(addrA);
        const tokenA = signJwt({ wallet: addrA, chainId: env.SIWE_CHAIN_ID }, { subject: addrA, jwtid: sidA });
        const hashIdemp = "0x" + "d".repeat(64);

        provider.getTransaction = async () => ({
            hash: hashIdemp,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: parseEther("0.01"),
            data: iface.encodeFunctionData("deposit")
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210010,
            logs: [encodeEvent("Deposited", [walletA.address, parseEther("0.01")])]
        });

        // Concurrent duplicate submissions preserve existing ID and never create duplicates
        const [r1, r2] = await Promise.all([
            fetch(`${baseUrl}/api/transactions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
                body: JSON.stringify({ txHash: hashIdemp })
            }),
            fetch(`${baseUrl}/api/transactions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
                body: JSON.stringify({ txHash: hashIdemp })
            })
        ]);
        const b1 = await r1.json();
        const b2 = await r2.json();
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
        assert.equal(b1.transaction.id, b2.transaction.id);

        // Wrong network -> 422
        provider.getNetwork = async () => ({ chainId: 1n });
        const rWrongNet = await fetch(`${baseUrl}/api/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({ txHash: hashIdemp })
        });
        assert.equal(rWrongNet.status, 422);
        provider.getNetwork = async () => ({ chainId: 11155111n });
    });

    test("Synchronization security: batch cap, confirmation lag, concurrency lock & checkpoint safety", async () => {
        const sidA = createActiveSession(addrA);
        const tokenA = signJwt({ wallet: addrA, chainId: env.SIWE_CHAIN_ID }, { subject: addrA, jwtid: sidA });

        // Invalid / oversized block range -> 400
        assert.equal(
            (await fetch(`${baseUrl}/api/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
                body: JSON.stringify({
                    fromBlock: env.CONTRACT_DEPLOYMENT_BLOCK,
                    toBlock: env.CONTRACT_DEPLOYMENT_BLOCK + 250
                })
            })).status,
            400
        );

        // Concurrent sync -> 200 and 409; lock released after completion
        provider.getBlockNumber = async () => env.CONTRACT_DEPLOYMENT_BLOCK + 30;
        provider.getLogs = async () => {
            await new Promise((r) => setTimeout(r, 80));
            return [];
        };

        const [s1, s2] = await Promise.all([
            fetch(`${baseUrl}/api/sync`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenA}` }
            }),
            fetch(`${baseUrl}/api/sync`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenA}` }
            })
        ]);
        assert.deepEqual([s1.status, s2.status].sort(), [200, 409]);
        // Checkpoint advanced to latestBlock - 12 confirmations
        assert.equal(mockSyncState.get(addrA), env.CONTRACT_DEPLOYMENT_BLOCK + 30 - 12);

        // Manual range does not overwrite checkpoint
        const rManual = await fetch(`${baseUrl}/api/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
            body: JSON.stringify({
                fromBlock: env.CONTRACT_DEPLOYMENT_BLOCK,
                toBlock: env.CONTRACT_DEPLOYMENT_BLOCK + 5
            })
        });
        assert.equal(rManual.status, 200);
        assert.equal(mockSyncState.get(addrA), env.CONTRACT_DEPLOYMENT_BLOCK + 30 - 12);

        // RPC failure preserves checkpoint and releases lock for subsequent retry
        provider.getBlockNumber = async () => env.CONTRACT_DEPLOYMENT_BLOCK + 60;
        provider.getLogs = async () => {
            throw new Error("RPC down");
        };
        const rRpcFail = await fetch(`${baseUrl}/api/sync`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` }
        });
        assert.equal(rRpcFail.status, 500);
        assert.equal(mockSyncState.get(addrA), env.CONTRACT_DEPLOYMENT_BLOCK + 30 - 12);

        // Next sync succeeds (proves lock was released in finally)
        provider.getLogs = async () => [];
        const rRetry = await fetch(`${baseUrl}/api/sync`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenA}` }
        });
        assert.equal(rRetry.status, 200);
    });
});
