const { syncTransactions } = require("../services/syncService");

// In-memory per-wallet synchronization lock (single backend process)
const activeSyncWallets = new Set();

function parseBlockParam(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }
    if (typeof value === "string" && value.trim() === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

async function syncHistory(req, res) {
    // Obtain authenticated wallet exclusively from req.wallet
    const wallet = req.wallet;

    if (activeSyncWallets.has(wallet)) {
        return res.status(409).json({
            success: false,
            message: "Synchronization already in progress for this wallet"
        });
    }

    const options = {};
    if (req.body && req.body.fromBlock !== undefined) {
        const parsedFrom = parseBlockParam(req.body.fromBlock);
        if (parsedFrom === null) {
            return res.status(400).json({
                success: false,
                message: "Invalid fromBlock parameter"
            });
        }
        options.fromBlock = parsedFrom;
    }

    if (req.body && req.body.toBlock !== undefined) {
        const parsedTo = parseBlockParam(req.body.toBlock);
        if (parsedTo === null) {
            return res.status(400).json({
                success: false,
                message: "Invalid toBlock parameter"
            });
        }
        options.toBlock = parsedTo;
    }

    if (
        options.fromBlock !== undefined &&
        options.toBlock !== undefined &&
        options.toBlock < options.fromBlock
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid block range: toBlock must be >= fromBlock"
        });
    }

    activeSyncWallets.add(wallet);

    try {
        const summary = await syncTransactions(wallet, options);

        return res.status(200).json({
            ...summary,
            success: summary.failed === 0,
            message: summary.failed === 0
                ? "Synchronization completed"
                : "Synchronization partially completed"
        });
    } catch (error) {
        console.error("Sync error:", error.message);

        if (error.statusCode === 400) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Synchronization failed"
        });
    } finally {
        activeSyncWallets.delete(wallet);
    }
}

module.exports = {
    syncHistory
};
