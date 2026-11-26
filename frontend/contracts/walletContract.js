import { BrowserProvider, Contract } from "ethers";
import WalletArtifact from "../src/contracts/SendWithdrawMoney.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

const ABI = WalletArtifact.abi;

export async function getWalletContract() {

    if (!window.ethereum) {
        throw new Error("Please install MetaMask");
    }

    const provider = new BrowserProvider(window.ethereum);

    const network = await provider.getNetwork();

    if (network.chainId !== 11155111n) {
        throw new Error("Please switch to Sepolia network");
    }

    const signer = await provider.getSigner();

    const contract = new Contract(
        CONTRACT_ADDRESS,
        ABI,
        signer
    );

    return contract;
}