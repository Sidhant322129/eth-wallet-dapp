const { z } = require("zod");
const { isAddress } = require("ethers");
const env = require("../config/env");

// Ethereum wallet address (rejects non-strings; preserves checksum semantics)
const walletAddressSchema = z
    .string({ error: "Wallet address must be a string" })
    .refine((val) => isAddress(val), {
        message: "Invalid wallet address"
    });

// 0x-prefixed 64-character hexadecimal transaction hash
const txHashSchema = z
    .string({ error: "Transaction hash must be a string" })
    .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash");

// Supports standard 65-byte (130 hex) and EIP-2098 compact 64-byte (128 hex) signatures
const signatureSchema = z
    .string({ error: "Signature must be a string" })
    .regex(
        /^0x([a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/,
        "Invalid Ethereum signature format"
    );

// Non-negative safe integer block number (no string/decimal/boolean coercion)
const safeBlockNumberSchema = z
    .number({ error: "Block number must be a number" })
    .int("Block number must be an integer")
    .nonnegative("Block number must be non-negative")
    .refine((val) => Number.isSafeInteger(val), {
        message: "Block number must be a safe integer"
    });

// POST /api/auth/nonce
const nonceBodySchema = z
    .object({
        wallet: walletAddressSchema
    })
    .strict();

// POST /api/auth/verify
const verifyBodySchema = z
    .object({
        wallet: walletAddressSchema,
        signature: signatureSchema
    })
    .strict();

// POST /api/transactions
const saveTransactionBodySchema = z
    .object({
        txHash: txHashSchema
    })
    .strict();

// GET /api/transactions/:wallet
const walletParamSchema = z
    .object({
        wallet: walletAddressSchema
    })
    .strict();

// POST /api/sync (empty/{} for incremental sync, or both fromBlock and toBlock for manual bounded sync)
const syncBodySchema = z
    .object({
        fromBlock: safeBlockNumberSchema.optional(),
        toBlock: safeBlockNumberSchema.optional()
    })
    .strict()
    .superRefine((data, ctx) => {
        const hasFrom = data.fromBlock !== undefined;
        const hasTo = data.toBlock !== undefined;

        if (!hasFrom && !hasTo) {
            return;
        }

        if (hasFrom !== hasTo) {
            ctx.addIssue({
                code: "custom",
                path: [hasFrom ? "toBlock" : "fromBlock"],
                message: "Both fromBlock and toBlock are required for manual synchronization"
            });
            return;
        }

        const deploymentBlock = env.CONTRACT_DEPLOYMENT_BLOCK;
        if (data.fromBlock < deploymentBlock) {
            ctx.addIssue({
                code: "custom",
                path: ["fromBlock"],
                message: `fromBlock cannot be earlier than deployment block (${deploymentBlock})`
            });
        }

        if (data.toBlock < data.fromBlock) {
            ctx.addIssue({
                code: "custom",
                path: ["toBlock"],
                message: "toBlock must be greater than or equal to fromBlock"
            });
            return;
        }

        const maxBlocks = env.SYNC_MAX_BLOCKS;
        const inclusiveCount = data.toBlock - data.fromBlock + 1;
        if (inclusiveCount > maxBlocks) {
            ctx.addIssue({
                code: "custom",
                path: ["toBlock"],
                message: `Manual block range cannot exceed ${maxBlocks} blocks`
            });
        }
    });

module.exports = {
    walletAddressSchema,
    txHashSchema,
    signatureSchema,
    nonceBodySchema,
    verifyBodySchema,
    saveTransactionBodySchema,
    walletParamSchema,
    syncBodySchema
};
