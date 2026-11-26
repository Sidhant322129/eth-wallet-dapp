const API_URL = import.meta.env.VITE_API_URL;

function buildApiError(response, data, fallbackMessage) {
    const err = new Error((data && data.message) || fallbackMessage);
    err.status = response.status;
    if (data && data.code) {
        err.code = data.code;
    }
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
        err.retryAfter = retryAfter;
    }
    return err;
}

// Save verified transaction (requires JWT)
export async function saveTransaction(txHash, token) {

    const response = await fetch(`${API_URL}/transactions`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },

        body: JSON.stringify({ txHash })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw buildApiError(response, data, "Failed to save transaction");
    }

    return data.transaction;
}


// Fetch transaction history (requires JWT)
export async function getTransactions(wallet, token) {

    const response = await fetch(
        `${API_URL}/transactions/${wallet}`,
        {
            cache: "no-store",
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw buildApiError(response, data, "Failed to fetch transactions");
    }

    return data.transactions;
}


// Synchronize one bounded historical batch (requires JWT)
export async function syncHistory(token) {
    let response;

    try {
        response = await fetch(`${API_URL}/sync`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
    } catch {
        const networkError = new Error("Network error while contacting synchronization server");
        networkError.status = 0;
        throw networkError;
    }

    let data;
    try {
        data = await response.json();
    } catch {
        const parseError = new Error("Received malformed response from synchronization server");
        parseError.status = response.status;
        throw parseError;
    }

    if (!data || typeof data !== "object") {
        const invalidError = new Error("Invalid synchronization response format");
        invalidError.status = response.status;
        throw invalidError;
    }

    // Preserve HTTP status codes on error responses; allow HTTP 200 partial-failure payloads through
    if (!response.ok) {
        throw buildApiError(response, data, "Synchronization failed");
    }

    return data;
}
