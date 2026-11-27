import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout } from "../src/services/authApi.js";
import { runWalletAuthFlow } from "../src/services/walletAuthFlow.js";

function createHarness() {
  const state = {
    loading: false,
    isAuthenticated: false,
    authToken: "",
    walletAddress: "",
    status: "",
    generation: 0,
    wrongNetworkCalls: 0,
  };

  function clearLocalSession(reason) {
    state.generation += 1;
    state.authToken = "";
    state.isAuthenticated = false;
    state.loading = false;
    state.walletAddress = "";
    if (reason) state.status = reason;
  }

  return { state, clearLocalSession };
}

function createMockEthereum({ chainId = 11155111n, address = "0x1111111111111111111111111111111111111111", onRequest, onSign } = {}) {
  const listeners = new Map();
  return {
    on(evt, fn) {
      listeners.set(evt, fn);
    },
    emit(evt, ...args) {
      listeners.get(evt)?.(...args);
    },
    async request(req) {
      if (onRequest) return onRequest(req);
      return [address];
    },
    createBrowserProvider() {
      return {
        async getNetwork() {
          return { chainId };
        },
        async getSigner() {
          return {
            async getAddress() {
              return address;
            },
            async signMessage(msg) {
              if (onSign) return onSign(msg);
              return "0x" + "ab".repeat(65);
            },
          };
        },
      };
    },
  };
}

test("Account switching during authentication clears loading and ignores stale auth response", async () => {
  const { state, clearLocalSession } = createHarness();
  const eth = createMockEthereum();
  eth.on("accountsChanged", () => clearLocalSession("Wallet account changed."));

  const attemptGen = ++state.generation;
  state.loading = true;

  const ok = await runWalletAuthFlow({
    ethereum: eth,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => {
      // Simulate MetaMask accountsChanged firing mid-authentication
      eth.emit("accountsChanged", ["0x2222222222222222222222222222222222222222"]);
      return { message: "Sign in" };
    },
    verifySignature: async () => ({ token: "stale-jwt" }),
    getAuthenticatedWallet: async () => ({ wallet: "0x1111111111111111111111111111111111111111" }),
    isStale: () => state.generation !== attemptGen,
    onWrongNetwork: () => { state.wrongNetworkCalls += 1; },
    onAuthenticated: async ({ address, token }) => {
      state.isAuthenticated = true;
      state.authToken = token;
      state.walletAddress = address;
    },
    onError: (err) => { state.status = err.message; },
    onFinally: () => { state.loading = false; },
  });

  assert.equal(ok, false);
  assert.equal(state.loading, false);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.authToken, "");
  assert.equal(state.status, "Wallet account changed.");
});

test("Network switching during authentication clears loading and prevents stale session", async () => {
  const { state, clearLocalSession } = createHarness();
  const eth = createMockEthereum();
  eth.on("chainChanged", () => clearLocalSession("Network changed."));

  const attemptGen = ++state.generation;
  state.loading = true;

  const ok = await runWalletAuthFlow({
    ethereum: eth,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => ({ message: "Sign in" }),
    verifySignature: async () => {
      eth.emit("chainChanged", "0x1");
      return { token: "stale-jwt" };
    },
    getAuthenticatedWallet: async () => ({ wallet: "0x1111111111111111111111111111111111111111" }),
    isStale: () => state.generation !== attemptGen,
    onWrongNetwork: () => { state.wrongNetworkCalls += 1; },
    onAuthenticated: async ({ address, token }) => {
      state.isAuthenticated = true;
      state.authToken = token;
      state.walletAddress = address;
    },
    onError: (err) => { state.status = err.message; },
    onFinally: () => { state.loading = false; },
  });

  assert.equal(ok, false);
  assert.equal(state.loading, false);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.status, "Network changed.");
});

test("Wrong initial network recovers loading state without authenticating", async () => {
  const { state } = createHarness();
  const eth = createMockEthereum({ chainId: 1n });
  const attemptGen = ++state.generation;
  state.loading = true;

  const ok = await runWalletAuthFlow({
    ethereum: eth,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => { throw new Error("Should not request nonce"); },
    verifySignature: async () => ({ token: "x" }),
    getAuthenticatedWallet: async () => ({ wallet: "0x1" }),
    isStale: () => state.generation !== attemptGen,
    onWrongNetwork: () => { state.wrongNetworkCalls += 1; },
    onAuthenticated: async () => { state.isAuthenticated = true; },
    onError: () => {},
    onFinally: () => { state.loading = false; },
  });

  assert.equal(ok, false);
  assert.equal(state.wrongNetworkCalls, 1);
  assert.equal(state.loading, false);
  assert.equal(state.isAuthenticated, false);
});

test("MetaMask connection rejection resets loading state and reports error", async () => {
  const { state } = createHarness();
  const eth = createMockEthereum({
    onRequest: async () => {
      const err = new Error("User rejected the request.");
      err.code = 4001;
      throw err;
    },
  });
  const attemptGen = ++state.generation;
  state.loading = true;

  const ok = await runWalletAuthFlow({
    ethereum: eth,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => ({ message: "Sign in" }),
    verifySignature: async () => ({ token: "x" }),
    getAuthenticatedWallet: async () => ({ wallet: "0x1" }),
    isStale: () => state.generation !== attemptGen,
    onWrongNetwork: () => {},
    onAuthenticated: async () => { state.isAuthenticated = true; },
    onError: (err) => { state.status = err.message; },
    onFinally: () => { state.loading = false; },
  });

  assert.equal(ok, false);
  assert.equal(state.loading, false);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.status, "User rejected the request.");
});

test("Signature rejection resets loading state and reports error", async () => {
  const { state } = createHarness();
  const eth = createMockEthereum({
    onSign: async () => {
      const err = new Error("User denied message signature.");
      err.shortMessage = "User rejected action";
      throw err;
    },
  });
  const attemptGen = ++state.generation;
  state.loading = true;

  const ok = await runWalletAuthFlow({
    ethereum: eth,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => ({ message: "Sign in" }),
    verifySignature: async () => ({ token: "x" }),
    getAuthenticatedWallet: async () => ({ wallet: "0x1" }),
    isStale: () => state.generation !== attemptGen,
    onWrongNetwork: () => {},
    onAuthenticated: async () => { state.isAuthenticated = true; },
    onError: (err) => { state.status = err.shortMessage || err.message; },
    onFinally: () => { state.loading = false; },
  });

  assert.equal(ok, false);
  assert.equal(state.loading, false);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.status, "User rejected action");
});

test("API request timeout aborts stalled fetch and throws descriptive error with cause", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (_url, opts) =>
    new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  try {
    await assert.rejects(
      () => fetchWithTimeout("https://example.invalid/auth/nonce", { method: "POST" }, 25),
      (err) => {
        assert.match(err.message, /Authentication request timed out/);
        assert.equal(err.cause?.name, "AbortError");
        return true;
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("Stale authentication response is discarded when newer attempt starts", async () => {
  const { state } = createHarness();
  const eth1 = createMockEthereum({ address: "0x1111111111111111111111111111111111111111" });
  const eth2 = createMockEthereum({ address: "0x3333333333333333333333333333333333333333" });

  let resolveAttempt1;
  const attempt1Promise = new Promise((res) => { resolveAttempt1 = res; });

  const gen1 = ++state.generation;
  state.loading = true;
  const p1 = runWalletAuthFlow({
    ethereum: eth1,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => {
      await attempt1Promise;
      return { message: "Sign in 1" };
    },
    verifySignature: async () => ({ token: "token-1" }),
    getAuthenticatedWallet: async () => ({ wallet: "0x1111111111111111111111111111111111111111" }),
    isStale: () => state.generation !== gen1,
    onWrongNetwork: () => {},
    onAuthenticated: async ({ address, token }) => {
      state.isAuthenticated = true;
      state.authToken = token;
      state.walletAddress = address;
    },
    onError: () => {},
    onFinally: () => { state.loading = false; },
  });

  // Start newer attempt 2
  const gen2 = ++state.generation;
  const p2 = runWalletAuthFlow({
    ethereum: eth2,
    createBrowserProvider: (e) => e.createBrowserProvider(),
    requestNonce: async () => ({ message: "Sign in 2" }),
    verifySignature: async () => ({ token: "token-2" }),
    getAuthenticatedWallet: async () => ({ wallet: "0x3333333333333333333333333333333333333333" }),
    isStale: () => state.generation !== gen2,
    onWrongNetwork: () => {},
    onAuthenticated: async ({ address, token }) => {
      state.isAuthenticated = true;
      state.authToken = token;
      state.walletAddress = address;
    },
    onError: () => {},
    onFinally: () => { state.loading = false; },
  });

  await p2;
  resolveAttempt1();
  await p1;

  assert.equal(state.isAuthenticated, true);
  assert.equal(state.authToken, "token-2");
  assert.equal(state.walletAddress, "0x3333333333333333333333333333333333333333");
  assert.equal(state.loading, false);
});
