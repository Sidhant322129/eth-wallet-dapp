const API_URL = import.meta.env?.VITE_API_URL;
const AUTH_TIMEOUT_MS = 60000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = AUTH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(
                "Authentication request timed out. The backend may be waking up — please retry.",
                { cause: error }
            );
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function buildAuthError(response, data, fallbackMessage) {
    const err = new Error((data && data.message) || fallbackMessage);
    err.status = response.status;
    return err;
}

// Request SIWE authentication challenge
export async function requestNonce(wallet) {

    const response = await fetchWithTimeout(`${API_URL}/auth/nonce`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({ wallet })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw buildAuthError(response, data, "Failed to generate nonce");
    }

    return data;
}


// Verify SIWE signature and receive session-bound JWT
export async function verifySignature(wallet, signature) {

    const response = await fetchWithTimeout(`${API_URL}/auth/verify`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            wallet,
            signature
        })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw buildAuthError(response, data, "Authentication failed");
    }

    return data;
}


// Verify JWT token and active server-side session
export async function getAuthenticatedWallet(token) {

    const response = await fetchWithTimeout(`${API_URL}/auth/me`, {
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw buildAuthError(response, data, "Invalid authentication token");
    }

    return data;
}


// Revoke current server-side session
export async function logoutWallet(token) {
    if (!token) return;

    const response = await fetchWithTimeout(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || (data && !data.success)) {
        throw buildAuthError(response, data, "Logout failed");
    }

    return data;
}
