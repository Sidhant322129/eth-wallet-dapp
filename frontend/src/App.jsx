
import { useEffect, useRef, useState } from 'react';
import { BrowserProvider, formatEther, parseEther } from 'ethers';
import { getWalletContract } from '../contracts/walletContract';
import {
    saveTransaction,
    getTransactions,
    syncHistory
} from './services/TransactionApi';
import {
    requestNonce,
    verifySignature,
    getAuthenticatedWallet,
    logoutWallet
} from './services/authApi';
import './App.css';

function App() {

  const [walletAddress, setWalletAddress]       = useState('');
  const [balance, setBalance]                   = useState('0.00');
  const [loading, setLoading]                   = useState(false);
  const [depositedBalance, setDepositedBalance] = useState('0.00');
  const [contractBalance, setContractBalance]   = useState('0.00');
  const [depositAmount, setDepositAmount]       = useState('');
  const [sendAmount, setSendAmount]             = useState('');
  const [recipient, setRecipient]               = useState('');
  const [withdrawAmount, setWithdrawAmount]     = useState('');
  const [status, setStatus]                     = useState('');
  const [txHash, setTxHash]                     = useState('');
  const [txHistory, setTxHistory]               = useState([]);
  const [historyFilter, setHistoryFilter]       = useState('all');
  const [historyLoading, setHistoryLoading]     = useState(false);
  const [txLoading, setTxLoading]               = useState(false);
  const [authToken, setAuthToken]               = useState('');
  const [isAuthenticated, setIsAuthenticated]   = useState(false);
  const [syncLoading, setSyncLoading]           = useState(false);
  const [syncStatus, setSyncStatus]             = useState('');
  const [syncSummary, setSyncSummary]           = useState(null);
  const [pendingRecordTx, setPendingRecordTx]   = useState(null);
  const [retryLoading, setRetryLoading]         = useState(false);

  // Tracks active wallet/auth generation to ignore stale async responses
  const sessionRef = useRef({ wallet: '', generation: 0 });
  // Keeps latest token accessible to MetaMask event listeners for best-effort revocation
  const authTokenRef = useRef('');
  // Synchronous guard against rapid double-clicks before state updates
  const syncInFlightRef = useRef(false);

  const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

  function clearLocalSession(reasonMessage) {
    sessionRef.current = {
      wallet: '',
      generation: sessionRef.current.generation + 1
    };
    authTokenRef.current = '';
    syncInFlightRef.current = false;
    setAuthToken('');
    setIsAuthenticated(false);
    setWalletAddress('');
    setBalance('0.00');
    setDepositedBalance('0.00');
    setContractBalance('0.00');
    setTxHistory([]);
    setSyncLoading(false);
    setSyncStatus('');
    setSyncSummary(null);
    setPendingRecordTx(null);
    setRetryLoading(false);
    if (reasonMessage) setStatus(reasonMessage);
  }

  // Reset auth and sync state if MetaMask account or network changes
  useEffect(() => {
    if (!window.ethereum?.on) return;

    function handleAccountsChanged() {
      const previousToken = authTokenRef.current;
      clearLocalSession('Wallet account changed. Please reconnect and authenticate.');
      if (previousToken) {
        logoutWallet(previousToken).catch(() => {});
      }
    }

    function handleChainChanged() {
      const previousToken = authTokenRef.current;
      clearLocalSession('Network changed. Please ensure Sepolia is selected and reconnect.');
      if (previousToken) {
        logoutWallet(previousToken).catch(() => {});
      }
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  async function recordTransaction(entry, expectedGen) {
      const token = authTokenRef.current || authToken;

      // Update local transaction history
      setTxHistory(prev => {
          const withoutDup = prev.filter(
              item => item.hash !== entry.hash
          );

          return [entry, ...withoutDup];
      });

      setStatus('⏳ Confirmed on-chain — verifying and recording in database...');

      try {

          // Send only the transaction hash and JWT to backend
          const verified = await saveTransaction(entry.hash, token);

          if (
              expectedGen !== undefined &&
              sessionRef.current.generation !== expectedGen
          ) {
              return false;
          }

          setPendingRecordTx(null);
          console.log("Verified transaction saved:", verified);
          return true;

      } catch (error) {
          if (
              expectedGen !== undefined &&
              sessionRef.current.generation !== expectedGen
          ) {
              return false;
          }

          console.error("Backend save failed:", error.message);

          if (error.status === 401) {
              clearLocalSession('⚠️ Session expired or revoked. Please reconnect and authenticate your wallet.');
          } else if (error.status === 429) {
              setPendingRecordTx(entry);
              const waitMsg = error.retryAfter
                  ? ` Please wait ${error.retryAfter}s and click Retry Recording.`
                  : ' Please wait and click Retry Recording.';
              setStatus(`⏳ Rate limit exceeded while recording.${waitMsg}`);
          } else if (error.status === 409 || error.status === 503) {
              setPendingRecordTx(entry);
              setStatus('⏳ Confirmed on-chain, backend verification pending. Click Retry Recording (no new blockchain tx will be sent).');
          } else {
              setPendingRecordTx(entry);
              setStatus('⚠️ Confirmed on-chain, but database recording failed. Click Retry Recording or Sync History.');
          }
          return false;
      }
  }

  // Safely retry backend recording using the same txHash (no new blockchain tx)
  async function handleRetryRecord() {
      if (!pendingRecordTx || retryLoading) return;
      if (!isAuthenticated || !authToken) {
          setStatus('⚠️ Please authenticate your wallet before retrying.');
          return;
      }

      const requestGen = sessionRef.current.generation;
      setRetryLoading(true);
      try {
          const ok = await recordTransaction(pendingRecordTx, requestGen);
          if (ok) {
              setStatus(`✅ ${pendingRecordTx.type} (${pendingRecordTx.amount} ETH) recorded in database!`);
              await loadHistory(walletAddress, authToken, requestGen);
          }
      } finally {
          if (sessionRef.current.generation === requestGen) {
              setRetryLoading(false);
          }
      }
  }

  async function loadHistory(addr, tokenOverride, expectedGen) {

      const address = addr || walletAddress;
      const token = tokenOverride || authToken;

      if (!address || !token) return;

      setHistoryLoading(true);

      try {

          // Fetch verified transactions from backend
          const data = await getTransactions(address, token);

          // Ignore stale response if wallet or session changed mid-request
          if (
              expectedGen !== undefined &&
              sessionRef.current.generation !== expectedGen
          ) {
              return;
          }

          const history = data.map(row => ({

              type:
                  row.type === "deposit" ? "Deposit" :
                  row.type === "send" ? "Send" :
                  "Withdraw",

              amount: String(row.amount_eth),

              hash: row.tx_hash,

              wallet: row.wallet,

              to: row.type === "send"
                  ? row.recipient
                  : undefined,

              blockNumber: row.block_number,

              time: new Date(row.created_at).toLocaleString()

          }));

          setTxHistory(history);

      } catch (error) {
          if (
              expectedGen !== undefined &&
              sessionRef.current.generation !== expectedGen
          ) {
              return;
          }

          console.error("History fetch failed:", error.message);

          if (error.status === 401) {
              clearLocalSession('⚠️ Session expired or revoked. Please reconnect and authenticate your wallet.');
          } else if (error.status === 429) {
              const waitMsg = error.retryAfter
                  ? ` Retry after ${error.retryAfter}s.`
                  : ' Please wait before refreshing.';
              setSyncStatus(`⏳ Too many history requests.${waitMsg}`);
          } else {
              alert("Failed to load transaction history.");
          }

      } finally {
          if (
              expectedGen === undefined ||
              sessionRef.current.generation === expectedGen
          ) {
              setHistoryLoading(false);
          }
      }
  }

  // Synchronize one bounded historical batch from the backend
  async function handleSyncHistory() {
      if (syncInFlightRef.current || syncLoading || txLoading) return;

      if (!isAuthenticated || !authToken || !walletAddress) {
          setSyncStatus('⚠️ Please connect and authenticate your wallet first.');
          return;
      }

      const requestGen = sessionRef.current.generation;
      const requestWallet = walletAddress.toLowerCase();
      const requestToken = authToken;

      syncInFlightRef.current = true;
      setSyncLoading(true);
      setSyncStatus('⏳ Synchronizing historical transactions (max 200 blocks)...');

      try {
          const result = await syncHistory(requestToken);

          // Prevent stale response from updating another wallet's UI
          if (
              sessionRef.current.generation !== requestGen ||
              sessionRef.current.wallet !== requestWallet
          ) {
              return;
          }

          setSyncSummary(result);

          if (result.failed > 0) {
              setSyncStatus(
                  '⚠️ Synchronization partially completed. Some transactions failed — click again to retry.'
              );
          } else if (result.hasMore) {
              setSyncStatus(
                  '✅ Batch synchronized. More historical blocks remain — click Continue Sync.'
              );
          } else if (result.scannedFrom === null) {
              setSyncStatus('✅ Wallet history is already synchronized.');
          } else {
              setSyncStatus('✅ Blockchain history synchronized successfully.');
          }

          await loadHistory(requestWallet, requestToken, requestGen);
      } catch (error) {
          if (
              sessionRef.current.generation !== requestGen ||
              sessionRef.current.wallet !== requestWallet
          ) {
              return;
          }

          if (error.status === 401) {
              // Expired or revoked session: clear auth state and prompt re-authentication
              clearLocalSession('⚠️ Session expired or revoked. Please reconnect and authenticate your wallet.');
              setSyncStatus('⚠️ Session expired or revoked. Please reconnect and authenticate your wallet.');
          } else if (error.status === 409) {
              setSyncStatus('⏳ Synchronization is already in progress for this wallet. Please wait.');
          } else if (error.status === 429) {
              // Keep valid JWT authentication intact; inform user of wait time for manual retry
              const waitMsg = error.retryAfter
                  ? ` Please wait ${error.retryAfter}s before retrying.`
                  : ' Please wait a moment before retrying.';
              setSyncStatus(`⏳ Rate limit reached.${waitMsg}`);
          } else {
              setSyncStatus(`❌ ${error.message || 'Synchronization failed.'}`);
          }
      } finally {
          // Only release the lock and loading state if this request still belongs to the active session
          if (sessionRef.current.generation === requestGen) {
              syncInFlightRef.current = false;
              setSyncLoading(false);
          }
      }
  }

  // Helper — deposited balance as a number for comparisons
  const deposited = parseFloat(depositedBalance) || 0;
  const hasDeposit = deposited > 0;

  async function fetchBalances(addr, expectedGen) {
    const provider = new BrowserProvider(window.ethereum);
    const address  = addr || walletAddress;
    const walletBalance = await provider.getBalance(address);
    const contract = await getWalletContract();
    const dep   = await contract.balances(address);
    const total = await contract.getContractBalance();

    // Ignore stale balance responses if wallet/session changed mid-request
    if (
      expectedGen !== undefined &&
      sessionRef.current.generation !== expectedGen
    ) {
      return;
    }

    setBalance(formatEther(walletBalance));
    setDepositedBalance(formatEther(dep));
    setContractBalance(formatEther(total));
  }

  async function connectWallet() {
    const attemptGen = sessionRef.current.generation + 1;
    sessionRef.current = {
      wallet: '',
      generation: attemptGen
    };

    try {

        if (!window.ethereum) {
            alert("Please install MetaMask first!");
            return;
        }

        setLoading(true);

        // Clear previous authentication and sync state
        syncInFlightRef.current = false;
        setAuthToken('');
        setIsAuthenticated(false);
        setWalletAddress('');
        setTxHistory([]);
        setSyncLoading(false);
        setSyncStatus('');
        setSyncSummary(null);

        // Request MetaMask connection
        await window.ethereum.request({
            method: "eth_requestAccounts"
        });

        if (sessionRef.current.generation !== attemptGen) return;

        const provider = new BrowserProvider(window.ethereum);

        const network = await provider.getNetwork();

        // Verify Sepolia network
        if (network.chainId !== 11155111n) {
            alert("Please switch to Sepolia network.");
            return;
        }

        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        if (sessionRef.current.generation !== attemptGen) return;

        // Request nonce from backend
        const challenge = await requestNonce(address);
        if (sessionRef.current.generation !== attemptGen) return;

        // Sign authentication message
        const signature = await signer.signMessage(
            challenge.message
        );
        if (sessionRef.current.generation !== attemptGen) return;

        // Verify signature on backend
        const auth = await verifySignature(
            address,
            signature
        );
        if (sessionRef.current.generation !== attemptGen) return;

        // Test JWT authentication
        const authenticated = await getAuthenticatedWallet(
            auth.token
        );
        if (sessionRef.current.generation !== attemptGen) return;

        if (
            authenticated.wallet.toLowerCase() !==
            address.toLowerCase()
        ) {
            throw new Error("Authenticated wallet mismatch");
        }

        // Store JWT in React state and update active session ref
        sessionRef.current = {
            wallet: address.toLowerCase(),
            generation: attemptGen
        };
        authTokenRef.current = auth.token;
        setAuthToken(auth.token);
        setIsAuthenticated(true);
        setWalletAddress(address);

        setStatus("Wallet authenticated successfully!");

        // Load balances and transaction history
        await fetchBalances(address, attemptGen);
        await loadHistory(address, auth.token, attemptGen);

    } catch (error) {
        if (sessionRef.current.generation !== attemptGen) return;

        console.error("Authentication error:", error);

        setStatus(
            error.shortMessage ||
            error.message ||
            "Wallet connection failed"
        );

    } finally {
        if (sessionRef.current.generation === attemptGen) {
            setLoading(false);
        }
    }
  }

  async function deposit() {
    if (!depositAmount || Number(depositAmount) <= 0)
      return setStatus('⚠️ Enter an amount to deposit.');
    if (Number(depositAmount) > parseFloat(balance))
      return setStatus('⚠️ Amount exceeds your wallet balance.');
    const requestGen = sessionRef.current.generation;
    try {
      setTxLoading(true);
      setTxHash('');
      setPendingRecordTx(null);
      setStatus('⏳ Awaiting MetaMask confirmation...');
      const contract = await getWalletContract();
      const tx = await contract.deposit({ value: parseEther(depositAmount) });
      setTxHash(tx.hash);
      setStatus('⏳ Transaction submitted — waiting for on-chain confirmation...');
      await tx.wait();
      const saved = await recordTransaction({
        type: 'Deposit',
        dbType: 'deposit',
        amount: depositAmount,
        hash: tx.hash,
        time: new Date().toLocaleTimeString(),
        wallet: walletAddress,
      }, requestGen);
      setDepositAmount('');
      if (saved) {
        setStatus(`✅ Deposited ${depositAmount} ETH and recorded in database!`);
      }
      await fetchBalances(walletAddress, requestGen);
    } catch (e) {
      setStatus(`❌ Blockchain transaction failed: ${e.shortMessage || e.message}`);
    } finally {
      setTxLoading(false);
    }
  }

  async function sendETH() {
    if (!hasDeposit)
      return setStatus('⚠️ You have 0 ETH in the contract. Deposit first!');
    if (!recipient)
      return setStatus('⚠️ Enter a recipient wallet address.');
    if (!sendAmount || Number(sendAmount) <= 0)
      return setStatus('⚠️ Enter an amount to send.');
    if (Number(sendAmount) > deposited)
      return setStatus(`⚠️ You can only send up to ${deposited.toFixed(4)} ETH (your contract balance).`);
    const requestGen = sessionRef.current.generation;
    try {
      setTxLoading(true);
      setTxHash('');
      setPendingRecordTx(null);
      setStatus('⏳ Awaiting MetaMask confirmation...');
      const contract = await getWalletContract();
      const tx = await contract.withdrawToAddress(recipient, parseEther(sendAmount));
      setTxHash(tx.hash);
      setStatus('⏳ Transaction submitted — waiting for on-chain confirmation...');
      await tx.wait();
      const saved = await recordTransaction({
        type: 'Send',
        dbType: 'send',
        amount: sendAmount,
        to: recipient,
        hash: tx.hash,
        time: new Date().toLocaleTimeString(),
        wallet: walletAddress,
      }, requestGen);
      setRecipient('');
      setSendAmount('');
      if (saved) {
        setStatus(`✅ Sent ${sendAmount} ETH to ${recipient.slice(0, 10)}... and recorded in database!`);
      }
      await fetchBalances(walletAddress, requestGen);
    } catch (e) {
      setStatus(`❌ Blockchain transaction failed: ${e.shortMessage || e.message}`);
    } finally {
      setTxLoading(false);
    }
  }

  async function withdraw() {
    if (!hasDeposit)
      return setStatus('⚠️ You have 0 ETH in the contract. Deposit first!');
    if (!withdrawAmount || Number(withdrawAmount) <= 0)
      return setStatus('⚠️ Enter an amount to withdraw.');
    if (Number(withdrawAmount) > deposited)
      return setStatus(`⚠️ You can only withdraw up to ${deposited.toFixed(4)} ETH (your contract balance).`);
    const requestGen = sessionRef.current.generation;
    try {
      setTxLoading(true);
      setTxHash('');
      setPendingRecordTx(null);
      setStatus('⏳ Awaiting MetaMask confirmation...');
      const contract = await getWalletContract();
      const tx = await contract.withdraw(parseEther(withdrawAmount));
      setTxHash(tx.hash);
      setStatus('⏳ Transaction submitted — waiting for on-chain confirmation...');
      await tx.wait();
      const saved = await recordTransaction({
        type: 'Withdraw',
        dbType: 'withdraw',
        amount: withdrawAmount,
        hash: tx.hash,
        time: new Date().toLocaleTimeString(),
        wallet: walletAddress,
      }, requestGen);
      setWithdrawAmount('');
      if (saved) {
        setStatus(`✅ Withdrew ${withdrawAmount} ETH and recorded in database!`);
      }
      await fetchBalances(walletAddress, requestGen);
    } catch (e) {
      setStatus(`❌ Blockchain transaction failed: ${e.shortMessage || e.message}`);
    } finally {
      setTxLoading(false);
    }
  }

  // Revoke server session and clear all wallet-specific state
  async function handleLogout() {
      const tokenToRevoke = authTokenRef.current || authToken;
      clearLocalSession('Logged out successfully. Connect wallet to sign in again.');
      if (tokenToRevoke) {
          try {
              await logoutWallet(tokenToRevoke);
          } catch (error) {
              console.warn('Server logout notice:', error.message);
          }
      }
  }

  return (
    <div className="app">

      <nav className="navbar">
        <h2>SendWithdrawMoney</h2>
        <div className="nav-actions">
          <button
              onClick={connectWallet}
              disabled={loading}
          >
              {
                  loading
                      ? 'Authenticating...'
                      : isAuthenticated
                          ? 'Wallet Authenticated'
                          : 'Connect Wallet'
              }
          </button>
          {isAuthenticated && (
            <button
              className="secondary-btn"
              onClick={handleLogout}
              disabled={loading}
            >
              Logout
            </button>
          )}
        </div>
      </nav>

      <main className="dashboard">

        <h1>Ethereum Vault</h1>
        <p>Deposit ETH into the smart contract, then send or withdraw.</p>

        {/* Status / error message */}
        {status && (
          <div className="status">
            <span>{status}</span>
            <div className="history-actions">
              {pendingRecordTx && (
                <button
                  className="secondary-btn"
                  onClick={handleRetryRecord}
                  disabled={retryLoading || !isAuthenticated}
                >
                  {retryLoading ? 'Retrying...' : 'Retry Recording'}
                </button>
              )}
              {txHash && (
                <a
                  className="etherscan-link"
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Etherscan ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Deposit-first hint when wallet is connected but nothing deposited */}
        {walletAddress && !hasDeposit && (
          <p className="hint">
            👇 Your contract balance is <strong>0 ETH</strong>.
            Use the <strong>Deposit</strong> card below to add ETH first —
            then Send and Withdraw will unlock.
          </p>
        )}

        {/* Balances */}
        <div className="balance-card">
          <h3>Wallet Balance</h3>
          <h1>{Number(balance).toFixed(4)} ETH</h1>
          <p>{walletAddress || 'No wallet connected'}</p>
        </div>

        <div className="balance-card">
          <h3>My Deposited Balance</h3>
          <h1 style={{ color: hasDeposit ? '#818cf8' : '#ef4444' }}>
            {Number(depositedBalance).toFixed(4)} ETH
          </h1>
          <p>Your share inside the smart contract</p>
        </div>

        <div className="balance-card">
          <h3>Total Contract Balance</h3>
          <h1>{Number(contractBalance).toFixed(4)} ETH</h1>
          <p>All users combined</p>
        </div>

        {/* Actions */}
        <div className="actions">

          {/* Deposit */}
          <div className="action-card">
            <h3>① Deposit ETH</h3>
            <p className="card-hint">Move ETH from your wallet into the contract.</p>
            <input
              type="number"
              placeholder={`Max: ${Number(balance).toFixed(4)} ETH`}
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
            />
            <button onClick={deposit} disabled={!walletAddress || txLoading}>
              {txLoading ? 'Processing...' : 'Deposit'}
            </button>
          </div>

          {/* Send */}
          <div className="action-card">
            <h3>② Send ETH</h3>
            <p className="card-hint">
              Send from your contract balance ({deposited.toFixed(4)} ETH) to any address.
            </p>
            <input
              type="text"
              placeholder="Recipient address (0x...)"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
            />
            <input
              type="number"
              placeholder={`Max: ${deposited.toFixed(4)} ETH`}
              value={sendAmount}
              onChange={e => setSendAmount(e.target.value)}
            />
            <button onClick={sendETH} disabled={!walletAddress || !hasDeposit || txLoading}>
              {!hasDeposit ? 'Deposit First' : txLoading ? 'Processing...' : 'Send ETH'}
            </button>
          </div>

          {/* Withdraw */}
          <div className="action-card">
            <h3>③ Withdraw ETH</h3>
            <p className="card-hint">
              Pull your contract balance ({deposited.toFixed(4)} ETH) back to your wallet.
            </p>
            <input
              type="number"
              placeholder={`Max: ${deposited.toFixed(4)} ETH`}
              value={withdrawAmount}
              onChange={e => setWithdrawAmount(e.target.value)}
            />
            <button onClick={withdraw} disabled={!walletAddress || !hasDeposit || txLoading}>
              {!hasDeposit ? 'Deposit First' : txLoading ? 'Processing...' : 'Withdraw'}
            </button>
          </div>

        </div>

        {/* Transaction History + Contract Etherscan Link */}
        <div className="balance-card">
          <div className="history-header">
            <h3>Transaction History</h3>
            <div className="history-actions">
              {walletAddress && (
                <>
                  <button
                    className="secondary-btn"
                    onClick={handleSyncHistory}
                    disabled={!isAuthenticated || syncLoading || txLoading}
                  >
                    {syncLoading
                      ? 'Syncing...'
                      : syncSummary?.hasMore
                        ? 'Continue Sync'
                        : 'Sync Blockchain History'}
                  </button>
                  <button
                    className="secondary-btn"
                    onClick={() => loadHistory()}
                    disabled={historyLoading || syncLoading}
                  >
                    {historyLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </>
              )}
              {CONTRACT_ADDRESS && (
                <a
                  className="etherscan-link"
                  href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Contract on Etherscan ↗
                </a>
              )}
            </div>
          </div>

          {syncStatus && (
            <p className="sync-status">{syncStatus}</p>
          )}

          {syncSummary && (
            <div className="sync-summary">
              <span>Found: <strong>{syncSummary.totalFound}</strong></span>
              <span>Inserted: <strong>{syncSummary.inserted}</strong></span>
              <span>Skipped: <strong>{syncSummary.skipped}</strong></span>
              <span>Failed: <strong>{syncSummary.failed}</strong></span>
              <span>
                Scanned Blocks:{' '}
                <strong>
                  {syncSummary.scannedFrom !== null && syncSummary.scannedTo !== null
                    ? `${syncSummary.scannedFrom} → ${syncSummary.scannedTo}`
                    : 'Up to date'}
                </strong>
              </span>
              <span>
                Last Synced Block:{' '}
                <strong>{syncSummary.lastSyncedBlock ?? 'None'}</strong>
              </span>
              <span>
                More History Remains:{' '}
                <strong>{syncSummary.hasMore ? 'Yes' : 'No'}</strong>
              </span>
            </div>
          )}

          <div className="history-filters">
            {['all', 'Deposit', 'Send', 'Withdraw'].map(tab => (
              <button
                key={tab}
                className={`filter-btn ${historyFilter === tab ? 'active' : ''}`}
                onClick={() => setHistoryFilter(tab)}
              >
                {tab === 'all' ? 'All' : tab}
              </button>
            ))}
          </div>

          {txHistory.filter(item => historyFilter === 'all' || item.type === historyFilter).length === 0 ? (
            <p style={{ marginTop: '12px' }}>
              {walletAddress
                ? 'No transactions found for this filter.'
                : 'Connect your wallet to load transaction history.'}
            </p>
          ) : (
            <ul className="tx-list">
              {txHistory
                .filter(item => historyFilter === 'all' || item.type === historyFilter)
                .map((item) => (
                  <li key={item.hash} className="tx-item">
                    <span className="tx-info">
                      <span className={`tx-badge tx-${item.type.toLowerCase()}`}>
                        {item.type}
                      </span>
                      <strong>{item.amount} ETH</strong>
                      {item.to ? ` → ${item.to.slice(0, 8)}...${item.to.slice(-4)}` : ''}
                      <span className="tx-time">{item.time}</span>
                    </span>
                    <a
                      className="etherscan-link"
                      href={`https://sepolia.etherscan.io/tx/${item.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.hash.slice(0, 10)}... ↗
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </div>

      </main>
    </div>
  );
}

export default App;
