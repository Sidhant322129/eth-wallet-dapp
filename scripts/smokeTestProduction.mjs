import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Wallet, JsonRpcProvider, Contract, formatEther } = require("../backend/node_modules/ethers");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://eth-wallet-dapp-eta.vercel.app").replace(/\/+$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "https://eth-wallet-dapp-backend.onrender.com").replace(/\/+$/, "");
const EXPECTED_CONTRACT = process.env.CONTRACT_ADDRESS || "0xD3F26853AF8cC8f3e41a50305692b754a3dd3d67";
const SEPOLIA_READONLY_RPC = process.env.SEPOLIA_READONLY_RPC || "https://ethereum-sepolia-rpc.publicnode.com";

const results = [];
function record(section, name, pass, detail) {
  results.push({ section, name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] (${section}) ${name}: ${detail}`);
}

async function fetchWithRetry(url, opts = {}, retries = 4, timeoutMs = 45000) {
  for (let i = 1; i <= retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (res.status >= 502 && res.status <= 504 && i < retries) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// 1. Frontend availability & bundle checks
const feRes = await fetchWithRetry(FRONTEND_URL);
const feHtml = await feRes.text();
record("Infra", "Frontend HTTPS & HTTP 200", feRes.status === 200 && feRes.url.startsWith("https://"), `status=${feRes.status}`);

const scriptMatches = [...feHtml.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
let bundleText = "";
for (const s of scriptMatches) {
  const bRes = await fetchWithRetry(FRONTEND_URL + s);
  bundleText += await bRes.text();
}

const backendHost = new URL(BACKEND_URL).host;
record("Infra", "Frontend bundle contains backend API URL", bundleText.includes(backendHost), `scripts=${scriptMatches.join(",")}`);
record("Infra", "Frontend bundle contains Sepolia contract", bundleText.toLowerCase().includes(EXPECTED_CONTRACT.toLowerCase()), `contract=${EXPECTED_CONTRACT}`);

const secretPatterns = [
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /alchemy\.com\/v2\/[A-Za-z0-9_-]{10,}/,
  /JWT_SECRET/,
  /SUPABASE_SECRET_KEY/,
];
const secretLeaks = secretPatterns.filter((re) => re.test(bundleText));
record("Security", "No backend secrets in frontend bundle", secretLeaks.length === 0, `leakPatternsMatched=${secretLeaks.length}`);

// 2. Backend health & dependency readiness (handles Render free-tier cold start)
const rootRes = await fetchWithRetry(`${BACKEND_URL}/`);
const rootBody = await rootRes.json();
record("Infra", "Backend GET /", rootRes.status === 200 && Boolean(rootBody.message), `status=${rootRes.status}`);

const healthRes = await fetchWithRetry(`${BACKEND_URL}/health`, { headers: { Origin: FRONTEND_URL } });
const healthBody = await healthRes.json();
record("Infra", "Backend GET /health", healthRes.status === 200 && healthBody.status === "ok", `status=${healthRes.status}`);

const readyRes = await fetchWithRetry(`${BACKEND_URL}/health/ready`);
const readyBody = await readyRes.json();
record(
  "Infra",
  "Backend GET /health/ready (Supabase + Sepolia RPC)",
  readyRes.status === 200 &&
    readyBody.status === "ready" &&
    readyBody.dependencies?.database === "up" &&
    readyBody.dependencies?.blockchainRpc === "up",
  `status=${readyRes.status} deps=${JSON.stringify(readyBody.dependencies)}`
);

// 3. CORS, Helmet, and unauthorized/JWT rejection
record("Security", "CORS allows production frontend origin", healthRes.headers.get("access-control-allow-origin") === FRONTEND_URL, `acao=${healthRes.headers.get("access-control-allow-origin")}`);

const badCorsRes = await fetchWithRetry(`${BACKEND_URL}/health`, { headers: { Origin: "https://evil.example.com" } });
record("Security", "CORS rejects disallowed origin", badCorsRes.headers.get("access-control-allow-origin") === null, `acao=${badCorsRes.headers.get("access-control-allow-origin")}`);

const hasHelmet =
  Boolean(healthRes.headers.get("strict-transport-security")) &&
  healthRes.headers.get("x-content-type-options") === "nosniff" &&
  healthRes.headers.get("x-powered-by") === null;
record("Security", "Helmet & security headers", hasHelmet, `hsts=${Boolean(healthRes.headers.get("strict-transport-security"))}, nosniff=${healthRes.headers.get("x-content-type-options")}`);

const testDbRes = await fetchWithRetry(`${BACKEND_URL}/api/test-db`);
record("Security", "GET /api/test-db disabled (404)", testDbRes.status === 404, `status=${testDbRes.status}`);

const unauthMe = await fetchWithRetry(`${BACKEND_URL}/api/auth/me`);
const unauthSync = await fetchWithRetry(`${BACKEND_URL}/api/sync`, { method: "POST" });
record("Security", "Protected endpoints reject unauthenticated (401)", unauthMe.status === 401 && unauthSync.status === 401, `me=${unauthMe.status}, sync=${unauthSync.status}`);

const badJwt1 = await fetchWithRetry(`${BACKEND_URL}/api/auth/me`, { headers: { Authorization: "Bearer malformed" } });
const badJwt2 = await fetchWithRetry(`${BACKEND_URL}/api/auth/me`, {
  headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.invalid" },
});
record("Security", "Malformed & invalid JWTs rejected (401)", badJwt1.status === 401 && badJwt2.status === 401, `malformed=${badJwt1.status}, invalid=${badJwt2.status}`);

// 4. Isolated ephemeral wallet SIWE auth, ownership, history, and revocation
const testWallet = Wallet.createRandom();
const testAddr = testWallet.address.toLowerCase();

const nonceRes = await fetchWithRetry(`${BACKEND_URL}/api/auth/nonce`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: FRONTEND_URL },
  body: JSON.stringify({ wallet: testWallet.address }),
});
const nonceData = await nonceRes.json();
record("Auth", "SIWE nonce generation", nonceRes.status === 200 && Boolean(nonceData.message), `status=${nonceRes.status}`);

const signature = await testWallet.signMessage(nonceData.message);
const verifyRes = await fetchWithRetry(`${BACKEND_URL}/api/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: FRONTEND_URL },
  body: JSON.stringify({ wallet: testWallet.address, signature }),
});
const verifyData = await verifyRes.json();
const jwtToken = verifyData.token;
record("Auth", "SIWE verification & JWT issuance", verifyRes.status === 200 && Boolean(jwtToken), `status=${verifyRes.status}`);

const meRes = await fetchWithRetry(`${BACKEND_URL}/api/auth/me`, {
  headers: { Authorization: `Bearer ${jwtToken}` },
});
const meData = await meRes.json();
record("Auth", "Authenticated GET /api/auth/me", meRes.status === 200 && meData.wallet === testAddr, `status=${meRes.status}, walletMatch=${meData.wallet === testAddr}`);

const replayRes = await fetchWithRetry(`${BACKEND_URL}/api/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: FRONTEND_URL },
  body: JSON.stringify({ wallet: testWallet.address, signature }),
});
record("Auth", "Nonce replay rejected", replayRes.status === 401 || replayRes.status === 400, `status=${replayRes.status}`);

const otherWalletRes = await fetchWithRetry(`${BACKEND_URL}/api/transactions/0x0000000000000000000000000000000000000001`, {
  headers: { Authorization: `Bearer ${jwtToken}` },
});
record("Auth", "Cross-wallet access prevented (403)", otherWalletRes.status === 403, `status=${otherWalletRes.status}`);

const txHistRes = await fetchWithRetry(`${BACKEND_URL}/api/transactions/${testWallet.address}`, {
  headers: { Authorization: `Bearer ${jwtToken}` },
});
const txHistData = await txHistRes.json();
record("Auth", "Authenticated transaction history", txHistRes.status === 200 && Array.isArray(txHistData.transactions), `status=${txHistRes.status}, count=${txHistData.transactions?.length}`);

const logoutRes = await fetchWithRetry(`${BACKEND_URL}/api/auth/logout`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwtToken}` },
});
record("Auth", "Logout succeeds (200)", logoutRes.status === 200, `status=${logoutRes.status}`);

const postLogoutMe = await fetchWithRetry(`${BACKEND_URL}/api/auth/me`, {
  headers: { Authorization: `Bearer ${jwtToken}` },
});
record("Auth", "Immediate JWT revocation after logout (401)", postLogoutMe.status === 401, `status=${postLogoutMe.status}`);

// 5. Read-only Sepolia contract & balance check
const provider = new JsonRpcProvider(SEPOLIA_READONLY_RPC);
const [network, code, ethBalance] = await Promise.all([
  provider.getNetwork(),
  provider.getCode(EXPECTED_CONTRACT),
  provider.getBalance(EXPECTED_CONTRACT),
]);
const bytecodeBytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
const contract = new Contract(EXPECTED_CONTRACT, ["function getContractBalance() view returns (uint256)"], provider);
const reportedBal = await contract.getContractBalance();
record(
  "Blockchain",
  "Sepolia chainId, bytecode & read-only contract balance",
  network.chainId === 11155111n && bytecodeBytes === 2549 && reportedBal === ethBalance,
  `chainId=${network.chainId}, bytecode=${bytecodeBytes}B, balance=${formatEther(ethBalance)} ETH`
);

const failed = results.filter((r) => !r.pass);
console.log(`\nSMOKE_SUMMARY: total=${results.length}, passed=${results.length - failed.length}, failed=${failed.length}`);
if (failed.length > 0) process.exit(1);
