// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISendWithdrawMoney {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Local test-only contract that attempts reentrancy on withdraw().
contract ReentrancyAttacker {
    ISendWithdrawMoney public target;
    uint256 public attackAmount;
    uint256 public reenterCount;

    constructor(address _target) {
        target = ISendWithdrawMoney(_target);
    }

    function attack() external payable {
        require(msg.value > 0, "Need ETH");
        attackAmount = msg.value;
        target.deposit{value: msg.value}();
        target.withdraw(msg.value);
    }

    receive() external payable {
        if (reenterCount < 1 && address(target).balance >= attackAmount) {
            reenterCount += 1;
            target.withdraw(attackAmount);
        }
    }
}

/// @notice Local test-only contract that rejects incoming ETH transfers.
contract RejectEtherRecipient {
    receive() external payable {
        revert("Refusing ETH");
    }
}
