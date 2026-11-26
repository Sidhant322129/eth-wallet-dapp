const {
    JsonRpcProvider,
    Interface,
    formatEther,
    isAddress
} = require("ethers");
const env = require("../config/env");

const rpcUrl = env.SEPOLIA_RPC_URL;
const contractAddress = env.CONTRACT_ADDRESS;

if (!rpcUrl || !isAddress(contractAddress || "")) {
    throw new Error("Invalid blockchain configuration");
}

const provider = new JsonRpcProvider(rpcUrl);

// Smart contract ABI
const abi = [
    "function deposit() payable",
    "function withdraw(uint256 amount)",
    "function withdrawToAddress(address to, uint256 amount)",

    "event Deposited(address indexed user, uint256 amount)",
    "event Withdrawn(address indexed user, address indexed to, uint256 amount)"
];

const contractInterface = new Interface(abi);

function createVerificationError(message, statusCode, code) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRpcError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return (
        error?.code === "NETWORK_ERROR" ||
        error?.code === "TIMEOUT" ||
        error?.code === "SERVER_ERROR" ||
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("timeout") ||
        msg.includes("network") ||
        msg.includes("econnreset")
    );
}

/**
 * Fetch transaction and receipt with bounded exponential backoff
 * to handle temporary RPC indexing lag right after tx.wait().
 */
async function fetchTxAndReceiptWithRetry(
    txHash,
    { maxAttempts = 4, initialDelayMs = 600, maxTotalMs = 5000 } = {}
) {
    const startedAt = Date.now();
    let waitMs = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const [tx, receipt] = await Promise.all([
                provider.getTransaction(txHash),
                provider.getTransactionReceipt(txHash)
            ]);

            if (tx && receipt) {
                return { tx, receipt };
            }
        } catch (err) {
            if (!isTransientRpcError(err)) {
                throw err;
            }
            if (attempt === maxAttempts || Date.now() - startedAt >= maxTotalMs) {
                throw createVerificationError(
                    "Blockchain RPC temporarily unavailable",
                    503,
                    "RPC_TEMPORARY_ERROR"
                );
            }
        }

        if (attempt < maxAttempts && Date.now() - startedAt + waitMs <= maxTotalMs) {
            await delay(waitMs);
            waitMs *= 2;
        } else {
            break;
        }
    }

    throw createVerificationError(
        "Transaction not yet indexed or pending",
        409,
        "TX_PENDING_OR_NOT_INDEXED"
    );
}

// Verify and decode blockchain transaction
async function verifyTransaction(txHash, retryOptions = {}) {

    // Validate transaction hash
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        throw createVerificationError("Invalid transaction hash", 422, "TX_VERIFICATION_FAILED");
    }

    // Verify Sepolia network
    const network = await provider.getNetwork();

    if (network.chainId !== 11155111n) {
        throw createVerificationError("Incorrect blockchain network", 422, "TX_VERIFICATION_FAILED");
    }

    // Fetch transaction and receipt with bounded retry for RPC indexing lag
    const { tx, receipt } = await fetchTxAndReceiptWithRetry(txHash, retryOptions);

    if (receipt.status !== 1) {
        throw createVerificationError("Transaction failed", 422, "TX_VERIFICATION_FAILED");
    }

    // Verify contract address
    if (tx.to?.toLowerCase() !== contractAddress.toLowerCase()) {
        throw createVerificationError("Invalid contract address", 422, "TX_VERIFICATION_FAILED");
    }

    // Decode called function
    const decodedTx = contractInterface.parseTransaction({
        data: tx.data,
        value: tx.value
    });

    if (!decodedTx) {
        throw createVerificationError("Unknown contract function", 422, "TX_VERIFICATION_FAILED");
    }

    const types = {
        deposit: "deposit",
        withdraw: "withdraw",
        withdrawToAddress: "send"
    };

    const type = types[decodedTx.name];

    if (!type) {
        throw new Error("Unsupported transaction type");
    }

    // Decode smart contract events
    const events = [];

    for (const log of receipt.logs) {

        if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
            continue;
        }

        const event = contractInterface.parseLog(log);

        if (!event) continue;

        const expectedEvent =
            type === "deposit" ? "Deposited" : "Withdrawn";

        if (event.name === expectedEvent) {
            events.push(event);
        }
    }

    if (events.length !== 1) {
        throw new Error("Expected exactly one transaction event");
    }

    const event = events[0];

    const wallet = event.args.user.toLowerCase();
    const amount = event.args.amount;

    if (wallet !== tx.from.toLowerCase()) {
        throw new Error("Wallet address mismatch");
    }

    if (amount <= 0n) {
        throw new Error("Invalid transaction amount");
    }

    let recipient = null;

    if (type !== "deposit") {
        recipient = event.args.to.toLowerCase();
    }

    // Validate amount and recipient
    const expectedAmount =
        type === "deposit" ? tx.value : decodedTx.args.amount;

    if (amount !== expectedAmount) {
        throw new Error("Transaction amount mismatch");
    }

    if (type === "withdraw" && recipient !== wallet) {
        throw new Error("Recipient mismatch");
    }

    if (
        type === "send" &&
        recipient !== decodedTx.args.to.toLowerCase()
    ) {
        throw new Error("Recipient mismatch");
    }

    // Return verified transaction data
    return {
        wallet,
        type,
        amount_eth: formatEther(amount),
        tx_hash: tx.hash.toLowerCase(),
        recipient,
        block_number: receipt.blockNumber
    };
}

module.exports = {
    provider,
    verifyTransaction
};