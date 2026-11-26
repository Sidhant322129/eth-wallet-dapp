const supabase = require("../config/supabase");
const { verifyTransaction } = require("../services/blockchainService");
const { isAddress } = require("ethers");

// Save verified blockchain transaction
async function saveTransaction(req, res) {
    const { txHash } = req.body;

    if (
        typeof txHash !== "string" ||
        !/^0x[a-fA-F0-9]{64}$/.test(txHash)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid transaction hash"
        });
    }

    let verifiedTransaction;

    try {
        // Verify transaction directly from blockchain
        verifiedTransaction = await verifyTransaction(txHash);
    } catch (error) {
        console.error("Transaction verification error:", error.message);

        if (error.statusCode === 503) {
            return res.status(503).json({
                success: false,
                code: error.code || "RPC_TEMPORARY_ERROR",
                message: "Blockchain RPC temporarily unavailable. Please retry."
            });
        }

        if (error.statusCode === 409) {
            return res.status(409).json({
                success: false,
                code: error.code || "TX_PENDING_OR_NOT_INDEXED",
                message: "Transaction is still being indexed on-chain. Please retry in a moment."
            });
        }

        return res.status(422).json({
            success: false,
            code: error.code || "TX_VERIFICATION_FAILED",
            message: "Transaction verification failed"
        });
    }

    // Verify transaction ownership
    if (verifiedTransaction.wallet.toLowerCase() !== req.wallet) {
        return res.status(403).json({
            success: false,
            message: "You cannot save another wallet's transaction"
        });
    }

    try {
        // Save verified data in Supabase
        const { data, error } = await supabase
            .from("transactions")
            .upsert(verifiedTransaction, {
                onConflict: "tx_hash"
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: "Transaction saved successfully",
            transaction: data
        });
    } catch (error) {
        console.error(error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to save transaction"
        });
    }
}

// Get transaction history by wallet address
async function getTransactions(req, res) {
    try {
        const { wallet } = req.params;

        if (!isAddress(wallet)) {
            return res.status(400).json({
                success: false,
                message: "Invalid wallet address"
            });
        }

        // Verify authenticated wallet ownership
        if (wallet.toLowerCase() !== req.wallet) {
            return res.status(403).json({
                success: false,
                message: "Access denied to this wallet's transactions"
            });
        }

        const { data, error } = await supabase
            .from("transactions")
            .select("*")
            .eq("wallet", wallet.toLowerCase())
            .order("block_number", { ascending: false });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            count: data.length,
            transactions: data
        });
    } catch (error) {
        console.error(error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch transactions"
        });
    }
}

module.exports = {
    saveTransaction,
    getTransactions
};
