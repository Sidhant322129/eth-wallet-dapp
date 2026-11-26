const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Interface, Wallet, parseEther } = require("ethers");

// Load validated config and singletons before mounting routes
const env = require("../config/env");
const supabase = require("../config/supabase");
const blockchainService = require("../services/blockchainService");
const { provider, verifyTransaction } = blockchainService;

const transactionRoutes = require("../routes/transactionRoutes");

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
const txHash1 = "0x" + "a".repeat(64);
const txHash2 = "0x" + "b".repeat(64);
const txHash3 = "0x" + "c".repeat(64);

function encodeEvent(name, args) {
    const encoded = iface.encodeEventLog(iface.getEvent(name), args);
    return {
        address: env.CONTRACT_ADDRESS,
        topics: encoded.topics,
        data: encoded.data
    };
}

function makeJwt(walletAddress, sessionId) {
    return jwt.sign(
        { wallet: walletAddress.toLowerCase(), chainId: env.SIWE_CHAIN_ID },
        env.JWT_SECRET,
        {
            algorithm: "HS256",
            expiresIn: "1h",
            issuer: "eth-wallet-dapp",
            audience: "eth-wallet-api",
            subject: walletAddress.toLowerCase(),
            jwtid: sessionId
        }
    );
}

test.describe("Transaction verification & API regression suite (mocked RPC & DB)", () => {
    let server;
    let baseUrl;
    const mockSessions = new Map();
    const mockTransactions = new Map();

    const activeSessionA = crypto.randomUUID();
    const revokedSessionA = crypto.randomUUID();
    const activeSessionB = crypto.randomUUID();

    // Save original methods to restore in after()
    const origSupabaseFrom = supabase.from.bind(supabase);
    const origGetNetwork = provider.getNetwork.bind(provider);
    const origGetTransaction = provider.getTransaction.bind(provider);
    const origGetTransactionReceipt = provider.getTransactionReceipt.bind(provider);

    test.before(async () => {
        mockSessions.set(activeSessionA, {
            session_id: activeSessionA,
            wallet: addrA,
            chain_id: env.SIWE_CHAIN_ID,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            revoked_at: null
        });
        mockSessions.set(revokedSessionA, {
            session_id: revokedSessionA,
            wallet: addrA,
            chain_id: env.SIWE_CHAIN_ID,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            revoked_at: new Date().toISOString()
        });
        mockSessions.set(activeSessionB, {
            session_id: activeSessionB,
            wallet: addrB,
            chain_id: env.SIWE_CHAIN_ID,
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            revoked_at: null
        });

        supabase.from = (table) => {
            if (table === "wallet_sessions") {
                return {
                    select: () => ({
                        eq: (_col, val) => ({
                            maybeSingle: async () => ({
                                data: mockSessions.get(val) || null,
                                error: null
                            })
                        })
                    })
                };
            }

            if (table === "transactions") {
                return {
                    upsert: (row) => ({
                        select: () => ({
                            single: async () => {
                                mockTransactions.set(row.tx_hash, {
                                    id: mockTransactions.size + 1,
                                    ...row,
                                    created_at: new Date().toISOString()
                                });
                                return {
                                    data: mockTransactions.get(row.tx_hash),
                                    error: null
                                };
                            }
                        })
                    }),
                    select: () => ({
                        eq: (_col, walletVal) => ({
                            order: async () => ({
                                data: Array.from(mockTransactions.values()).filter(
                                    (t) => t.wallet === walletVal
                                ),
                                error: null
                            })
                        })
                    })
                };
            }

            throw new Error(`Unexpected table in test: ${table}`);
        };

        provider.getNetwork = async () => ({ chainId: 11155111n });

        const app = express();
        app.use(express.json());
        app.use("/api/transactions", transactionRoutes);

        await new Promise((resolve) => {
            server = app.listen(0, () => {
                baseUrl = `http://127.0.0.1:${server.address().port}/api/transactions`;
                resolve();
            });
        });
    });

    test.after(async () => {
        supabase.from = origSupabaseFrom;
        provider.getNetwork = origGetNetwork;
        provider.getTransaction = origGetTransaction;
        provider.getTransactionReceipt = origGetTransactionReceipt;
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test("accepts valid deposit, withdraw, and send transactions", async () => {
        // 1. Deposit
        provider.getTransaction = async () => ({
            hash: txHash1,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: parseEther("0.05"),
            data: iface.encodeFunctionData("deposit")
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210001,
            logs: [encodeEvent("Deposited", [walletA.address, parseEther("0.05")])]
        });
        const dep = await verifyTransaction(txHash1, { maxAttempts: 2, initialDelayMs: 5 });
        assert.equal(dep.type, "deposit");
        assert.equal(dep.amount_eth, "0.05");
        assert.equal(dep.recipient, null);

        // 2. Withdraw
        provider.getTransaction = async () => ({
            hash: txHash2,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: 0n,
            data: iface.encodeFunctionData("withdraw", [parseEther("0.02")])
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210002,
            logs: [encodeEvent("Withdrawn", [walletA.address, walletA.address, parseEther("0.02")])]
        });
        const wdr = await verifyTransaction(txHash2, { maxAttempts: 2, initialDelayMs: 5 });
        assert.equal(wdr.type, "withdraw");
        assert.equal(wdr.amount_eth, "0.02");
        assert.equal(wdr.recipient, addrA);

        // 3. Send (withdrawToAddress)
        provider.getTransaction = async () => ({
            hash: txHash3,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: 0n,
            data: iface.encodeFunctionData("withdrawToAddress", [recipientAddr, parseEther("0.01")])
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210003,
            logs: [encodeEvent("Withdrawn", [walletA.address, recipientAddr, parseEther("0.01")])]
        });
        const snd = await verifyTransaction(txHash3, { maxAttempts: 2, initialDelayMs: 5 });
        assert.equal(snd.type, "send");
        assert.equal(snd.amount_eth, "0.01");
        assert.equal(snd.recipient, recipientAddr);
    });

    test("retries temporarily unavailable receipt and recovers", async () => {
        let attempts = 0;
        provider.getTransaction = async () => ({
            hash: txHash3,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: 0n,
            data: iface.encodeFunctionData("withdrawToAddress", [recipientAddr, parseEther("0.01")])
        });
        provider.getTransactionReceipt = async () => {
            attempts += 1;
            if (attempts < 2) return null;
            return {
                status: 1,
                blockNumber: 12210003,
                logs: [encodeEvent("Withdrawn", [walletA.address, recipientAddr, parseEther("0.01")])]
            };
        };

        const res = await verifyTransaction(txHash3, { maxAttempts: 3, initialDelayMs: 5 });
        assert.equal(attempts, 2);
        assert.equal(res.type, "send");
    });

    test("returns HTTP 409 when receipt remains unavailable after bounded retries", async () => {
        provider.getTransaction = async () => null;
        provider.getTransactionReceipt = async () => null;

        const token = makeJwt(addrA, activeSessionA);
        const res = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ txHash: txHash1 })
        });
        const body = await res.json();
        assert.equal(res.status, 409);
        assert.equal(body.code, "TX_PENDING_OR_NOT_INDEXED");
    });

    test("returns HTTP 503 on temporary RPC failure", async () => {
        provider.getTransaction = async () => {
            const err = new Error("429 rate limit");
            err.code = "SERVER_ERROR";
            throw err;
        };
        provider.getTransactionReceipt = async () => null;

        const token = makeJwt(addrA, activeSessionA);
        const res = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ txHash: txHash1 })
        });
        const body = await res.json();
        assert.equal(res.status, 503);
        assert.equal(body.code, "RPC_TEMPORARY_ERROR");
    });

    test("rejects failed tx, wrong contract, and event mismatches with HTTP 422", async () => {
        const token = makeJwt(addrA, activeSessionA);
        const postTx = async () => {
            const r = await fetch(baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ txHash: txHash1 })
            });
            return { status: r.status, body: await r.json() };
        };

        // Failed on-chain receipt (status 0)
        provider.getTransaction = async () => ({
            hash: txHash1,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: parseEther("0.01"),
            data: iface.encodeFunctionData("deposit")
        });
        provider.getTransactionReceipt = async () => ({
            status: 0,
            blockNumber: 12210004,
            logs: []
        });
        assert.equal((await postTx()).status, 422);

        // Wrong contract address
        provider.getTransaction = async () => ({
            hash: txHash1,
            from: walletA.address,
            to: recipientAddr,
            value: 0n,
            data: "0x"
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210005,
            logs: []
        });
        assert.equal((await postTx()).status, 422);

        // Wrong event signature
        provider.getTransaction = async () => ({
            hash: txHash1,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: 0n,
            data: iface.encodeFunctionData("withdrawToAddress", [recipientAddr, parseEther("0.01")])
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210006,
            logs: [encodeEvent("Deposited", [walletA.address, parseEther("0.01")])]
        });
        assert.equal((await postTx()).status, 422);

        // Event amount mismatch
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210007,
            logs: [encodeEvent("Withdrawn", [walletA.address, recipientAddr, parseEther("0.02")])]
        });
        assert.equal((await postTx()).status, 422);

        // Event recipient mismatch
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210008,
            logs: [encodeEvent("Withdrawn", [walletA.address, walletA.address, parseEther("0.01")])]
        });
        assert.equal((await postTx()).status, 422);
    });

    test("enforces wallet ownership (403) and prevents duplicate tx_hash records", async () => {
        provider.getTransaction = async () => ({
            hash: txHash3,
            from: walletA.address,
            to: env.CONTRACT_ADDRESS,
            value: 0n,
            data: iface.encodeFunctionData("withdrawToAddress", [recipientAddr, parseEther("0.01")])
        });
        provider.getTransactionReceipt = async () => ({
            status: 1,
            blockNumber: 12210009,
            logs: [encodeEvent("Withdrawn", [walletA.address, recipientAddr, parseEther("0.01")])]
        });

        // Wallet B attempting to save Wallet A's transaction -> 403
        const tokenB = makeJwt(addrB, activeSessionB);
        const rOtherSave = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenB}`
            },
            body: JSON.stringify({ txHash: txHash3 })
        });
        assert.equal(rOtherSave.status, 403);

        // Wallet B attempting to read Wallet A's history -> 403
        const rOtherGet = await fetch(`${baseUrl}/${addrA}`, {
            headers: { Authorization: `Bearer ${tokenB}` }
        });
        assert.equal(rOtherGet.status, 403);

        // Wallet A saves txHash3 twice -> only 1 record stored
        const tokenA = makeJwt(addrA, activeSessionA);
        const rSave1 = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenA}`
            },
            body: JSON.stringify({ txHash: txHash3 })
        });
        const rSave2 = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenA}`
            },
            body: JSON.stringify({ txHash: txHash3 })
        });
        assert.equal(rSave1.status, 200);
        assert.equal(rSave2.status, 200);
        assert.equal(mockTransactions.size, 1);
    });

    test("rejects missing, invalid, and revoked JWTs (401) and invalid txHash (400)", async () => {
        const rNoJwt = await fetch(`${baseUrl}/${addrA}`);
        assert.equal(rNoJwt.status, 401);

        const rBadJwt = await fetch(`${baseUrl}/${addrA}`, {
            headers: { Authorization: "Bearer invalid.jwt.token" }
        });
        assert.equal(rBadJwt.status, 401);

        const revokedToken = makeJwt(addrA, revokedSessionA);
        const rRevoked = await fetch(`${baseUrl}/${addrA}`, {
            headers: { Authorization: `Bearer ${revokedToken}` }
        });
        assert.equal(rRevoked.status, 401);

        const activeToken = makeJwt(addrA, activeSessionA);
        const rBadHash = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${activeToken}`
            },
            body: JSON.stringify({ txHash: "0x123" })
        });
        assert.equal(rBadHash.status, 400);
    });
});
