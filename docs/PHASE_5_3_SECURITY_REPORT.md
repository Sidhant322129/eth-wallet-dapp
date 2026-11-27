# Phase 5.3 — Automated Security Scanning Report

## 1. Security Pipeline Architecture
Phase 5.3 introduces an automated DevSecOps security layer around `Sidhant322129/eth-wallet-dapp` alongside the existing Node.js 22 CI pipeline:

1. **Core CI (`.github/workflows/ci.yml`)**: Upgraded to Node.js 24 action runtimes (`actions/checkout@v6`, `actions/setup-node@v6`) while keeping the application runtime at Node.js `22`.
2. **SAST — CodeQL (`.github/workflows/codeql.yml`)**: Advanced CodeQL analysis (`github/codeql-action/init@v4`, `github/codeql-action/analyze@v4`) for `javascript-typescript` across `frontend/src` and `backend`.
3. **Secret Scanning & SCA (`.github/workflows/security.yml`)**:
   - `gitleaks`: Full-history secret scanning using pinned Gitleaks CLI `v8.30.0` with SHA-256 verification and `--redact`.
   - `dependency-audit-frontend`, `dependency-audit-backend`, `dependency-audit-contracts`: Independent `npm audit` gates for production and full dependency trees.
4. **Dependency Updates (`.github/dependabot.yml`)**: Weekly grouped Dependabot PRs for `/frontend`, `/backend`, `/contracts-project` (`npm`), and `/` (`github-actions`) without auto-merge.

## 2. SAST, SCA, and Secret-Scanning Overview
- **SAST (Static Application Security Testing — CodeQL)**: Analyzes JavaScript/TypeScript control and data flow in `frontend/src` and `backend` to detect injection flaws, unsafe regexes, broken access patterns, and insecure API usage. **Scope limitation**: CodeQL `javascript-typescript` does **not** audit Solidity smart contracts (`contracts-project/contracts/*.sol`).
- **SCA (Software Composition Analysis — npm audit + Dependabot)**: Evaluates production and development npm dependency trees against the GitHub/npm advisory database and schedules weekly dependency update PRs.
- **Secret Scanning (Gitleaks)**: Scans both the working tree and full Git commit history (`fetch-depth: 0`) for leaked private keys, Alchemy RPC keys, Supabase keys, JWT secrets, and tokens with redacted output (`--redact`).

## 3. CodeQL Configuration (`.github/workflows/codeql.yml`)
- **Triggers**: `push` to `main`, `pull_request` to `main`, weekly `schedule` (`23 4 * * 1` UTC), and `workflow_dispatch`.
- **Permissions**: `actions: read`, `contents: read`, `security-events: write`.
- **Scope**: `languages: [javascript-typescript]`, explicitly targeting `frontend/src` and `backend` while ignoring `**/node_modules`, `frontend/dist`, `contracts-project/artifacts`, `contracts-project/cache`, and `contracts-project/typechain-types`.
- **Actions**: `actions/checkout@v6`, `github/codeql-action/init@v4`, `github/codeql-action/analyze@v4`.

## 4. Gitleaks Configuration (`.github/workflows/security.yml` → `gitleaks`)
- **Checkout**: `actions/checkout@v6` with `fetch-depth: 0` for full commit history scanning.
- **Binary Integrity**: Downloads pinned `gitleaks_8.30.0_linux_x64.tar.gz` and verifies its SHA-256 digest (`79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e`) with `sha256sum --check` prior to execution. No paid license is required for a public personal repository.
- **Execution**: `gitleaks git --redact --verbose --no-banner --exit-code 1`. Redacts any matched secret values and fails the job if genuine leaks are detected.

## 5. Dependabot Configuration (`.github/dependabot.yml`)
- **Ecosystems**:
  - `npm` in `/frontend` (weekly Monday `05:00` UTC, `open-pull-requests-limit: 5`, grouped minor/patch)
  - `npm` in `/backend` (weekly Monday `05:00` UTC, `open-pull-requests-limit: 5`, grouped minor/patch)
  - `npm` in `/contracts-project` (weekly Monday `05:00` UTC, `open-pull-requests-limit: 5`, grouped minor/patch)
  - `github-actions` in `/` (weekly Monday `05:00` UTC, `open-pull-requests-limit: 5`)
- **Auto-merge**: Disabled; all updates require human review and passing CI/security checks.

## 6. Dependency Audit Results & 7. Vulnerability Severity Breakdown

| Component | Production Audit (`--omit=dev`) | Full Audit (`npm audit`) | Policy Gate |
|---|---|---|---|
| `frontend` | **0 vulnerabilities** (PASS) | **2 total** (`1 moderate`, `1 high`, `0 critical`) | Fail on `high`/`critical` in production (`--omit=dev --audit-level=high`) |
| `backend` | **0 vulnerabilities** (PASS) | **2 total** (`2 moderate`, `0 high`, `0 critical`) | Fail on `high`/`critical` in production (`--omit=dev --audit-level=high`) |
| `contracts-project` | **0 vulnerabilities** (PASS) | **36 total** (`20 low`, `9 moderate`, `7 high`, `0 critical`) | Fail on `high`/`critical` in production, `critical > 0`, or `high > 7` Hardhat 2 baseline |

### Detailed Findings
1. **Frontend (devDependencies only)**:
   - `esbuild` (`<=0.24.2`, **moderate**, transitive via `vite`, `GHSA-67mh-4wv8-2f99`): Dev server request exposure.
   - `vite` (`<=6.4.3`, **high**, direct devDependency `vite ^5.4.21`): Inherits `esbuild` advisory; only fix suggested by npm is breaking upgrade to `vite@8.4.0`.
   - *Impact*: Dev-only (`npm run dev`); not included in the production `dist/` static bundle.
2. **Backend (devDependencies only)**:
   - `minimatch` (`7.0.0 - 11.0.0`, **moderate**, transitive via `nodemon`, `GHSA-g3hv-75wg-m249`): Globparts amplification DoS.
   - `nodemon` (`>=3.1.12`, **moderate**, direct devDependency `nodemon ^3.1.14`): Depends on `minimatch`; npm suggests `nodemon@3.1.11` (`isSemVerMajor` flag).
   - *Impact*: Dev-only (`npm run dev`); production `npm start` does not use `nodemon`.
3. **Contracts-project (devDependencies only — Hardhat `2.30.0` + `@nomicfoundation/hardhat-toolbox@6.1.2`)**:
   - **High (7)**: `lodash` (`4.0.0 - 4.17.23`, transitive via `@nomicfoundation/ignition-core`), `serialize-javascript` (`<=7.1.2`, transitive via `mocha`), `tmp` (`<=0.2.5`, transitive via `solc`), and dependent `@nomicfoundation/ignition-core`, `@nomicfoundation/hardhat-ignition`, `@nomicfoundation/hardhat-ignition-ethers`, `@nomicfoundation/hardhat-toolbox`.
   - **Moderate / Low (29)**: Transitive packages including `bn.js`, `cookie`, `diff`, `elliptic`, `glob`, `minimatch`, and `hardhat` (`2.30.0`).
   - *Impact*: Local/CI Hardhat development & test tooling only; zero runtime dependencies are affected (`dotenv` has 0 vulnerabilities). Fixes require breaking major upgrades to `hardhat@3.23.0` and `@nomicfoundation/hardhat-toolbox@7.0.0`, which are intentionally deferred pending explicit approval.

## 8. Remediation Performed
- Upgraded `.github/workflows/ci.yml` from `actions/checkout@v4` and `actions/setup-node@v4` to `actions/checkout@v6` and `actions/setup-node@v6` to eliminate all three Node.js 20 action-runtime deprecation warnings.
- No `npm audit fix --force` or breaking major framework upgrades (`vite@8`, `hardhat@3`) were executed.
- All `npm audit` steps in `.github/workflows/security.yml` inspect `report.error` so npm registry/network failures fail the job instead of passing silently.

## 9. Remaining Vulnerabilities and Risks
- Dev-only advisories in `vite@5` (`frontend`), `nodemon` (`backend`), and `hardhat@2.30.0` / `hardhat-toolbox@6.1.2` (`contracts-project`) remain until an approved major-version upgrade.
- CodeQL does not scan Solidity smart contracts; Solidity security relies on Hardhat unit/security tests and manual audit.
- Gitleaks was not installed locally on the Windows host, so full-history Gitleaks execution is pending remote GitHub Actions run.
- Any previously used development credentials (if ever exposed outside Git) should follow standard rotation hygiene before production deployment.

## 10. Local Verification Results
- **YAML syntax validation (`js-yaml`)**: Passed for `.github/workflows/ci.yml` (117 lines), `.github/workflows/codeql.yml` (54 lines), `.github/workflows/security.yml` (193 lines), and `.github/dependabot.yml` (53 lines).
- **Frontend**: `npm run lint` (exit `0`), `npm run build` (exit `0`, `186` modules transformed in `2.65s`).
- **Backend**: `npm test` with isolated CI dummy env (`12` passed, `0` failed, `0` skipped in `10.52s`).
- **Contracts**: `npx hardhat compile` (`Nothing to compile`, exit `0`) and `npx hardhat test` (`8 passing (1s)`, exit `0`) with empty `SEPOLIA_RPC_URL` and `PRIVATE_KEY`.
- **Production npm audits**: `frontend`, `backend`, and `contracts-project` all reported `0` production vulnerabilities.
- **Git hygiene**: `git ls-files "*.env*"` shows only `.env.example` files; no `.env` files are tracked or staged.

## 11. GitHub Settings Required
1. **Repository → Settings → Code security**:
   - Ensure **CodeQL Default Setup** is **disabled** so it does not duplicate or conflict with `.github/workflows/codeql.yml` (Advanced Setup).
   - Enable **Dependabot alerts** and **Dependabot security updates** (if desired) to complement `.github/dependabot.yml`.
   - Enable **Secret scanning** and **Push protection** in GitHub Code Security for defense-in-depth alongside Gitleaks.

## 12. Remote Verification Instructions
After approving and pushing the commits to `origin/main`:
1. Open `https://github.com/Sidhant322129/eth-wallet-dapp/actions`.
2. Verify **CI** runs cleanly with zero Node.js 20 deprecation warnings.
3. Verify **CodeQL** (`Analyze (javascript-typescript)`) completes and populates **Security → Code scanning**.
4. Verify **Security Scanning** (`Secret Scan (Gitleaks)`, `Dependency Audit (Frontend)`, `Dependency Audit (Backend)`, `Dependency Audit (Contracts)`) passes cleanly.
5. Check **Insights → Dependency graph → Dependabot** to confirm `.github/dependabot.yml` is active.
