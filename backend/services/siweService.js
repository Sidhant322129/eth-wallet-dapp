const { SiweMessage } = require("siwe");
const { getAddress } = require("ethers");
const env = require("../config/env");

const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

/**
 * Create a standardized EIP-4361 Sign-In with Ethereum message.
 * Note: Supports externally owned accounts (EOAs); EIP-1271 smart contract wallets are not enabled.
 */
function createSiweChallenge({ wallet, nonce, issuedAt, expirationTime }) {
    const checksumAddress = getAddress(wallet);

    const siweMessage = new SiweMessage({
        domain: env.SIWE_DOMAIN,
        address: checksumAddress,
        statement: "Sign in to Ethereum Wallet DApp",
        uri: env.SIWE_URI,
        version: "1",
        chainId: env.SIWE_CHAIN_ID,
        nonce,
        issuedAt,
        expirationTime
    });

    return {
        address: checksumAddress,
        message: siweMessage.prepareMessage()
    };
}

/**
 * Verify a stored SIWE message and MetaMask signature against trusted backend configuration.
 */
async function verifySiweChallenge({
    storedMessage,
    expectedWallet,
    expectedNonce,
    signature
}) {
    let parsed;
    try {
        parsed = new SiweMessage(storedMessage);
    } catch {
        throw new Error("Stored SIWE message is invalid");
    }

    // Enforce trusted server-side bindings before cryptographic verification
    if (parsed.domain !== env.SIWE_DOMAIN) {
        throw new Error("SIWE domain mismatch");
    }

    if (parsed.uri !== env.SIWE_URI) {
        throw new Error("SIWE URI mismatch");
    }

    if (Number(parsed.chainId) !== env.SIWE_CHAIN_ID) {
        throw new Error("SIWE chain ID mismatch");
    }

    if (parsed.nonce !== expectedNonce) {
        throw new Error("SIWE nonce mismatch");
    }

    if (parsed.address.toLowerCase() !== expectedWallet.toLowerCase()) {
        throw new Error("SIWE wallet mismatch");
    }

    const nowMs = Date.now();
    if (parsed.issuedAt) {
        const issuedAtMs = new Date(parsed.issuedAt).getTime();
        if (!Number.isFinite(issuedAtMs) || issuedAtMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
            throw new Error("SIWE issuedAt timestamp is invalid");
        }
    }

    if (!parsed.expirationTime) {
        throw new Error("SIWE expirationTime is required");
    }

    const expiresMs = new Date(parsed.expirationTime).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
        throw new Error("SIWE message expired");
    }

    const verification = await parsed.verify({
        signature,
        domain: env.SIWE_DOMAIN,
        nonce: expectedNonce,
        time: new Date(nowMs).toISOString()
    });

    if (!verification.success || !verification.data) {
        throw new Error("SIWE signature verification failed");
    }

    return verification.data;
}

module.exports = {
    createSiweChallenge,
    verifySiweChallenge
};
