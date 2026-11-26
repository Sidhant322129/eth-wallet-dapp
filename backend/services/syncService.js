const { Interface, isAddress, zeroPadValue } = require("ethers");
const env = require("../config/env");
const supabase = require("../config/supabase");
const { provider, verifyTransaction } = require("./blockchainService");
const {
    getLastSyncedBlock,
    updateLastSyncedBlock
} = require("./syncStateService");

const contractAddress = env.CONTRACT_ADDRESS;

const eventInterface = new Interface([
    "event Deposited(address indexed user, uint256 amount)",
    "event Withdrawn(address indexed user, address indexed to, uint256 amount)"
]);

const DEPOSITED_TOPIC = eventInterface.getEvent("Deposited").topicHash;
const WITHDRAWN_TOPIC = eventInterface.getEvent("Withdrawn").topicHash;

function createValidationError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

/**
 * Synchronize historical Deposited and Withdrawn transactions for a single wallet.
 * @param {string} wallet
 * @param {{ fromBlock?: number, toBlock?: number }} [options]
 */
async function syncTransactions(wallet, options = {}) {
    if (typeof wallet !== "string" || !isAddress(wallet)) {
        throw createValidationError("Invalid wallet address");
    }

    if (!isAddress(contractAddress || "")) {
        throw new Error("Invalid CONTRACT_ADDRESS configuration");
    }

    const deploymentBlock = env.CONTRACT_DEPLOYMENT_BLOCK;
    const blockRange = env.SYNC_BLOCK_RANGE;
    const maxBlocks = env.SYNC_MAX_BLOCKS;
    const confirmations = env.SYNC_CONFIRMATIONS;

    const normalizedWallet = wallet.toLowerCase();
    const paddedWalletTopic = zeroPadValue(normalizedWallet, 32);

    const isManualRange =
        options.fromBlock !== undefined || options.toBlock !== undefined;

    if (options.fromBlock !== undefined) {
        if (!Number.isSafeInteger(options.fromBlock) || options.fromBlock < deploymentBlock) {
            throw createValidationError("Invalid fromBlock parameter");
        }
    }

    if (options.toBlock !== undefined) {
        if (!Number.isSafeInteger(options.toBlock) || options.toBlock < deploymentBlock) {
            throw createValidationError("Invalid toBlock parameter");
        }
    }

    if (
        options.fromBlock !== undefined &&
        options.toBlock !== undefined &&
        options.toBlock < options.fromBlock
    ) {
        throw createValidationError("toBlock must be greater than or equal to fromBlock");
    }

    const latestBlock = await provider.getBlockNumber();
    if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
        throw new Error("Invalid latest block number from provider");
    }

    const safeLatestBlock = latestBlock - confirmations;
    const currentCheckpoint = await getLastSyncedBlock(normalizedWallet);

    const startBlock = isManualRange
        ? (options.fromBlock !== undefined
            ? options.fromBlock
            : Math.max(deploymentBlock, (options.toBlock ?? safeLatestBlock) - maxBlocks + 1))
        : (currentCheckpoint !== null ? currentCheckpoint + 1 : deploymentBlock);

    if (startBlock > safeLatestBlock) {
        return {
            totalFound: 0,
            inserted: 0,
            skipped: 0,
            failed: 0,
            scannedFrom: null,
            scannedTo: null,
            hasMore: false,
            lastSyncedBlock: currentCheckpoint
        };
    }

    const requestedEnd =
        isManualRange && options.toBlock !== undefined
            ? Math.min(options.toBlock, safeLatestBlock)
            : safeLatestBlock;

    const endBlock = Math.min(requestedEnd, startBlock + maxBlocks - 1);

    if (endBlock < startBlock) {
        return {
            totalFound: 0,
            inserted: 0,
            skipped: 0,
            failed: 0,
            scannedFrom: null,
            scannedTo: null,
            hasMore: false,
            lastSyncedBlock: currentCheckpoint
        };
    }

    const estimatedBlocks = endBlock - startBlock + 1;
    const estimatedChunks = Math.ceil(estimatedBlocks / blockRange);
    console.log(
        `[sync] Scanning ${estimatedBlocks} blocks (${startBlock} -> ${endBlock}) in ${estimatedChunks} chunk(s) of ${blockRange} for ${normalizedWallet}`
    );

    const txHashesSet = new Set();

    // Sequential chunked scan to respect Alchemy Free Tier eth_getLogs limits
    for (let from = startBlock; from <= endBlock; from += blockRange) {
        const to = Math.min(from + blockRange - 1, endBlock);

        const logs = await provider.getLogs({
            address: contractAddress,
            fromBlock: from,
            toBlock: to,
            topics: [
                [DEPOSITED_TOPIC, WITHDRAWN_TOPIC],
                paddedWalletTopic
            ]
        });

        for (const log of logs) {
            if (log.transactionHash) {
                txHashesSet.add(log.transactionHash.toLowerCase());
            }
        }
    }

    const uniqueHashes = Array.from(txHashesSet);
    const totalFound = uniqueHashes.length;
    let skipped = 0;
    let inserted = 0;
    let failed = 0;

    if (totalFound > 0) {
        // Check which transactions already exist in Supabase
        const { data: existingRows, error: selectError } = await supabase
            .from("transactions")
            .select("tx_hash")
            .in("tx_hash", uniqueHashes);

        if (selectError) {
            throw new Error(`Database lookup failed: ${selectError.message}`);
        }

        const existingSet = new Set(
            (existingRows || []).map((row) => row.tx_hash.toLowerCase())
        );

        const missingHashes = uniqueHashes.filter((hash) => !existingSet.has(hash));
        skipped = totalFound - missingHashes.length;

        for (const txHash of missingHashes) {
            let verified;
            try {
                verified = await verifyTransaction(txHash);
            } catch (err) {
                console.error(`[sync] Verification failed for ${txHash}:`, err.message);
                failed += 1;
                continue;
            }

            // Verify wallet ownership before database insertion
            if (verified.wallet.toLowerCase() !== normalizedWallet) {
                console.error(`[sync] Ownership mismatch for ${txHash}`);
                failed += 1;
                continue;
            }

            const { data: upsertedRows, error: insertError } = await supabase
                .from("transactions")
                .upsert(verified, {
                    onConflict: "tx_hash",
                    ignoreDuplicates: true
                })
                .select("tx_hash");

            if (insertError) {
                throw new Error(`Database insert failed: ${insertError.message}`);
            }

            if (upsertedRows && upsertedRows.length > 0) {
                inserted += upsertedRows.length;
            } else {
                skipped += 1;
            }
        }
    }

    let lastSyncedBlock = currentCheckpoint;

    // Advance checkpoint only for normal incremental syncs with zero failures
    if (!isManualRange && failed === 0) {
        lastSyncedBlock = await updateLastSyncedBlock(normalizedWallet, endBlock);
    }

    const hasMore = endBlock < safeLatestBlock;

    return {
        totalFound,
        inserted,
        skipped,
        failed,
        scannedFrom: startBlock,
        scannedTo: endBlock,
        hasMore,
        lastSyncedBlock
    };
}

module.exports = {
    syncTransactions
};
