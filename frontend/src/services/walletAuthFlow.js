/**
 * Execute the MetaMask + SIWE authentication flow with generation guards
 * to prevent stale updates and indefinite loading states.
 */
export async function runWalletAuthFlow({
    ethereum,
    createBrowserProvider,
    requestNonce,
    verifySignature,
    getAuthenticatedWallet,
    isStale,
    onWrongNetwork,
    onAuthenticated,
    onError,
    onFinally,
}) {
    try {
        await ethereum.request({ method: "eth_requestAccounts" });
        if (isStale()) return false;

        const provider = createBrowserProvider(ethereum);
        const network = await provider.getNetwork();
        if (isStale()) return false;

        if (network.chainId !== 11155111n) {
            onWrongNetwork();
            return false;
        }

        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        if (isStale()) return false;

        const challenge = await requestNonce(address);
        if (isStale()) return false;

        const signature = await signer.signMessage(challenge.message);
        if (isStale()) return false;

        const auth = await verifySignature(address, signature);
        if (isStale()) return false;

        const authenticated = await getAuthenticatedWallet(auth.token);
        if (isStale()) return false;

        if (authenticated.wallet.toLowerCase() !== address.toLowerCase()) {
            throw new Error("Authenticated wallet mismatch");
        }

        await onAuthenticated({ address, token: auth.token });
        return true;
    } catch (error) {
        if (!isStale()) {
            onError(error);
        }
        return false;
    } finally {
        if (!isStale()) {
            onFinally();
        }
    }
}
