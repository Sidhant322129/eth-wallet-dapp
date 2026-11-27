import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import cp from "node:child_process";
import { chromium } from "playwright";

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const MOCK_ADDR = "0x1111111111111111111111111111111111111111";

function findLocalBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function installMockEthereumScript() {
  const listeners = new Map();
  const state = {
    address: "0x1111111111111111111111111111111111111111",
    chainId: "0xaa36a7",
    rejectConnect: false,
    rejectSign: false,
  };
  window.__MOCK_WALLET__ = {
    state,
    emit(event, payload) {
      for (const fn of listeners.get(event) || []) {
        fn(payload);
      }
    },
  };
  window.ethereum = {
    isMetaMask: true,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    removeListener(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    async request({ method }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        if (state.rejectConnect) {
          const err = new Error("User rejected the request.");
          err.code = 4001;
          throw err;
        }
        return [state.address];
      }
      if (method === "eth_chainId") return state.chainId;
      if (method === "net_version") return String(parseInt(state.chainId, 16));
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      if (method === "eth_call") return "0x" + "0".repeat(64);
      if (method === "personal_sign") {
        if (state.rejectSign) {
          const err = new Error("User denied message signature.");
          err.code = 4001;
          throw err;
        }
        return "0x" + "ab".repeat(65);
      }
      return null;
    },
  };
}

test.describe("Phase 5.6 — Playwright Mocked EIP-1193 Browser Verification", () => {
  let previewProc;
  let browser;

  test.before(async () => {
    previewProc = cp.spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "preview", "--port", String(PREVIEW_PORT), "--host", "127.0.0.1", "--strictPort"],
      { stdio: "ignore" }
    );

    // Wait for Vite preview server
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(PREVIEW_URL);
        if (res.status === 200) break;
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const executablePath = findLocalBrowserExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
  });

  test.after(async () => {
    if (browser) await browser.close();
    if (previewProc) previewProc.kill();
  });

  async function setupPage(apiBehavior = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(installMockEthereumScript);

    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/auth/nonce")) {
        if (apiBehavior.nonceDelayMs) {
          await new Promise((r) => setTimeout(r, apiBehavior.nonceDelayMs));
        }
        if (apiBehavior.failNonce) {
          return route.abort("timedout");
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, message: "Mock SIWE Challenge" }),
        });
      }
      if (url.endsWith("/auth/verify")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, token: "mock.jwt.token" }),
        });
      }
      if (url.endsWith("/auth/me")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, wallet: MOCK_ADDR }),
        });
      }
      if (url.includes("/transactions/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, transactions: [] }),
        });
      }
      if (url.endsWith("/auth/logout")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
      return route.fulfill({ status: 404, body: "{}" });
    });

    await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });
    return { context, page };
  }

  test("Connects, shows Authenticating... loading state, authenticates, and logs out", async () => {
    const { context, page } = await setupPage({ nonceDelayMs: 250 });
    try {
      const connectBtn = page.locator("nav button").first();
      await assert.doesNotReject(() => connectBtn.waitFor({ state: "visible" }));
      assert.equal(await connectBtn.innerText(), "Connect Wallet");

      await connectBtn.click();
      // Should transition through Authenticating...
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Authenticating...");
      // Should complete to Wallet Authenticated
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Wallet Authenticated");

      const logoutBtn = page.getByRole("button", { name: "Logout" });
      await logoutBtn.click();
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Connect Wallet");
      const statusText = await page.locator(".status").innerText();
      assert.match(statusText, /Logged out successfully/i);
    } finally {
      await context.close();
    }
  });

  test("Account switching and network switching reset authenticated state cleanly", async () => {
    const { context, page } = await setupPage();
    try {
      await page.locator("nav button").first().click();
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Wallet Authenticated");

      await page.evaluate(() => {
        window.__MOCK_WALLET__.emit("accountsChanged", ["0x2222222222222222222222222222222222222222"]);
      });
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Connect Wallet");
      assert.match(await page.locator(".status").innerText(), /Wallet account changed/i);

      // Re-authenticate, then test network switch
      await page.locator("nav button").first().click();
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Wallet Authenticated");

      await page.evaluate(() => {
        window.__MOCK_WALLET__.emit("chainChanged", "0x1");
      });
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Connect Wallet");
      assert.match(await page.locator(".status").innerText(), /Network changed/i);
    } finally {
      await context.close();
    }
  });

  test("Signature rejection and API failure recover from Authenticating... back to Connect Wallet", async () => {
    const { context, page } = await setupPage();
    try {
      await page.evaluate(() => {
        window.__MOCK_WALLET__.state.rejectSign = true;
      });
      await page.locator("nav button").first().click();
      await page.waitForFunction(() => document.querySelector("nav button")?.innerText === "Connect Wallet");
      assert.match(await page.locator(".status").innerText(), /user rejected action|User denied message signature/i);
    } finally {
      await context.close();
    }

    const { context: ctx2, page: page2 } = await setupPage({ failNonce: true });
    try {
      await page2.locator("nav button").first().click();
      await page2.waitForFunction(() => document.querySelector("nav button")?.innerText === "Connect Wallet");
      assert.ok((await page2.locator(".status").innerText()).length > 0);
    } finally {
      await ctx2.close();
    }
  });
});
