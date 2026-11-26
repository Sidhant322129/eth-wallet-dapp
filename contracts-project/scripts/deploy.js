const { ethers } = require("hardhat");

async function main() {

    const [deployer] = await ethers.getSigners();

    console.log("Deploying with account:", deployer.address);

    const Wallet = await ethers.getContractFactory("SendWithdrawMoney");

    const wallet = await Wallet.deploy();

    await wallet.waitForDeployment();

    console.log("Contract deployed at:", await wallet.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});