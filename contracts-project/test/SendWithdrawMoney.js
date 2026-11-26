const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SendWithdrawMoney", function () {
    let contract, owner, other, recipient;

    beforeEach(async function () {
        [owner, other, recipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("SendWithdrawMoney");
        contract = await Factory.deploy();
    });

    it("stores a deposit in my balance and emits Deposited", async function () {
        const amount = ethers.parseEther("1");
        await expect(contract.deposit({ value: amount }))
            .to.emit(contract, "Deposited")
            .withArgs(owner.address, amount);
        expect(await contract.balances(owner.address)).to.equal(amount);
        expect(await contract.getContractBalance()).to.equal(amount);
    });

    it("rejects a deposit of 0", async function () {
        await expect(contract.deposit({ value: 0 })).to.be.revertedWith("Send some ETH");
    });

    it("lets me withdraw part of my balance and emits Withdrawn", async function () {
        await contract.deposit({ value: ethers.parseEther("1") });
        const withdrawAmt = ethers.parseEther("0.4");
        await expect(contract.withdraw(withdrawAmt))
            .to.emit(contract, "Withdrawn")
            .withArgs(owner.address, owner.address, withdrawAmt);
        expect(await contract.balances(owner.address)).to.equal(ethers.parseEther("0.6"));
        expect(await contract.getContractBalance()).to.equal(ethers.parseEther("0.6"));
    });

    it("isolates balances and rejects withdrawals or transfers exceeding balance", async function () {
        await contract.deposit({ value: ethers.parseEther("1") });
        await contract.connect(other).deposit({ value: ethers.parseEther("0.5") });

        await expect(contract.connect(other).withdraw(ethers.parseEther("1")))
            .to.be.revertedWith("Insufficient balance");
        await expect(contract.connect(other).withdrawToAddress(recipient.address, ethers.parseEther("1")))
            .to.be.revertedWith("Insufficient balance");

        expect(await contract.balances(owner.address)).to.equal(ethers.parseEther("1"));
        expect(await contract.balances(other.address)).to.equal(ethers.parseEther("0.5"));
        expect(await contract.getContractBalance()).to.equal(ethers.parseEther("1.5"));
    });

    it("transfers ETH to another address and emits Withdrawn", async function () {
        await contract.deposit({ value: ethers.parseEther("1") });
        const sendAmt = ethers.parseEther("0.25");
        const beforeBal = await ethers.provider.getBalance(recipient.address);

        await expect(contract.withdrawToAddress(recipient.address, sendAmt))
            .to.emit(contract, "Withdrawn")
            .withArgs(owner.address, recipient.address, sendAmt);

        const afterBal = await ethers.provider.getBalance(recipient.address);
        expect(afterBal - beforeBal).to.equal(sendAmt);
        expect(await contract.balances(owner.address)).to.equal(ethers.parseEther("0.75"));
    });

    it("rolls back balance when recipient rejects ETH transfer", async function () {
        const RejectFactory = await ethers.getContractFactory("RejectEtherRecipient");
        const rejecter = await RejectFactory.deploy();

        await contract.deposit({ value: ethers.parseEther("1") });
        await expect(
            contract.withdrawToAddress(await rejecter.getAddress(), ethers.parseEther("0.5"))
        ).to.be.revertedWith("Transfer failed");

        expect(await contract.balances(owner.address)).to.equal(ethers.parseEther("1"));
        expect(await contract.getContractBalance()).to.equal(ethers.parseEther("1"));
    });

    it("blocks reentrancy attacks via Checks-Effects-Interactions", async function () {
        await contract.deposit({ value: ethers.parseEther("2") });

        const AttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
        const attacker = await AttackerFactory.deploy(await contract.getAddress());

        // Reentrant withdraw fails ("Insufficient balance"), causing outer .call to revert ("Transfer failed")
        await expect(
            attacker.attack({ value: ethers.parseEther("0.5") })
        ).to.be.revertedWith("Transfer failed");

        expect(await contract.getContractBalance()).to.equal(ethers.parseEther("2"));
        expect(await contract.balances(owner.address)).to.equal(ethers.parseEther("2"));
    });

    it("documents actual behavior for zero-value withdrawals and zero-address recipients", async function () {
        await contract.deposit({ value: ethers.parseEther("1") });

        // Current contract does not reject 0-amount withdrawals (no amount > 0 check)
        await expect(contract.withdraw(0))
            .to.emit(contract, "Withdrawn")
            .withArgs(owner.address, owner.address, 0);

        // Current contract does not reject address(0) in withdrawToAddress (burns ETH if called)
        await expect(contract.withdrawToAddress(ethers.ZeroAddress, ethers.parseEther("0.1")))
            .to.emit(contract, "Withdrawn")
            .withArgs(owner.address, ethers.ZeroAddress, ethers.parseEther("0.1"));

        expect(await contract.balances(owner.address)).to.equal(ethers.parseEther("0.9"));
    });
});
