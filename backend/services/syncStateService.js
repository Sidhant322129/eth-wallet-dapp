const { isAddress } = require("ethers");
const supabase = require("../config/supabase");

/**
 * Retrieve the last synced block checkpoint for a wallet.
 * Returns null if no checkpoint exists yet.
 * @param {string} wallet
 * @returns {Promise<number|null>}
 */
async function getLastSyncedBlock(wallet) {
    if (typeof wallet !== "string" || !isAddress(wallet)) {
        throw new Error("Invalid wallet address");
    }

    const normalizedWallet = wallet.toLowerCase();

    const { data, error } = await supabase
        .from("wallet_sync_state")
        .select("last_synced_block")
        .eq("wallet", normalizedWallet)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to read sync state: ${error.message}`);
    }

    if (!data) {
        return null;
    }

    const blockNumber = Number(data.last_synced_block);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
        throw new Error("Invalid stored sync checkpoint");
    }

    return blockNumber;
}

/**
 * Update the last synced block checkpoint for a wallet.
 * Prevents checkpoint regression and uses conflict-safe upsert.
 * @param {string} wallet
 * @param {number} blockNumber
 * @returns {Promise<number>}
 */
async function updateLastSyncedBlock(wallet, blockNumber) {
    if (typeof wallet !== "string" || !isAddress(wallet)) {
        throw new Error("Invalid wallet address");
    }

    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
        throw new Error("Invalid checkpoint block number");
    }

    const normalizedWallet = wallet.toLowerCase();
    const existingBlock = await getLastSyncedBlock(normalizedWallet);

    if (existingBlock !== null && blockNumber < existingBlock) {
        throw new Error(
            `Checkpoint regression prevented: ${blockNumber} < ${existingBlock}`
        );
    }

    const { data, error } = await supabase
        .from("wallet_sync_state")
        .upsert(
            {
                wallet: normalizedWallet,
                last_synced_block: blockNumber,
                updated_at: new Date().toISOString()
            },
            { onConflict: "wallet" }
        )
        .select("last_synced_block")
        .single();

    if (error) {
        throw new Error(`Failed to update sync state: ${error.message}`);
    }

    const updatedBlock = Number(data.last_synced_block);
    if (!Number.isSafeInteger(updatedBlock) || updatedBlock < 0) {
        throw new Error("Invalid updated sync checkpoint");
    }

    return updatedBlock;
}

module.exports = {
    getLastSyncedBlock,
    updateLastSyncedBlock
};
