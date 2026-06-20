// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ComplianceRegistry.sol";

contract TrellisVault is ZamaEthereumConfig, Ownable {
    // -------------------------------------------------------------------------
    // State variables
    // -------------------------------------------------------------------------

    IERC20 public usdc;
    ComplianceRegistry public complianceRegistry;

    mapping(address => euint64) private _balances;
    // Tracks first deposit so FHE.add is never called on an uninitialized handle.
    mapping(address => bool) private _hasBalance;

    uint256 public totalDeposits;
    uint256 public totalQuarantinedDeposits;
    bool public paused;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Deposited(address indexed user);
    event DepositQuarantined(address indexed user, uint64 amount);
    event Withdrawn(address indexed user);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier notPaused() {
        require(!paused, "Vault is paused");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address usdcAddress,
        address complianceRegistryAddress,
        address initialOwner
    ) Ownable(initialOwner) {
        usdc = IERC20(usdcAddress);
        complianceRegistry = ComplianceRegistry(complianceRegistryAddress);
    }

    // -------------------------------------------------------------------------
    // Core: deposit
    // -------------------------------------------------------------------------

    function deposit(uint64 amount) external notPaused {
        require(amount > 0, "TrellisVault: zero amount");
        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "TrellisVault: transfer failed"
        );

        bool flagged = complianceRegistry.screenDeposit(msg.sender);

        if (flagged) {
            complianceRegistry.quarantine(msg.sender, amount);
            totalQuarantinedDeposits += amount;
            emit DepositQuarantined(msg.sender, amount);
        } else {
            euint64 encAmount = FHE.asEuint64(amount);
            if (_hasBalance[msg.sender]) {
                _balances[msg.sender] = FHE.add(_balances[msg.sender], encAmount);
            } else {
                _balances[msg.sender] = encAmount;
                _hasBalance[msg.sender] = true;
            }
            FHE.allowThis(_balances[msg.sender]);
            FHE.allow(_balances[msg.sender], msg.sender);
            totalDeposits += amount;
            emit Deposited(msg.sender);
        }
    }

    // -------------------------------------------------------------------------
    // Core: withdraw (encrypted path)
    //
    // Accepts a client-encrypted withdrawal amount and proof. Updates encrypted
    // balance state via FHE select — no USDC transfer is possible here because
    // the actual amount cannot be read on-chain from an encrypted value.
    // Use withdrawPlaintext for the demo transfer path.
    // -------------------------------------------------------------------------

    function withdraw(
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external notPaused {
        require(_hasBalance[msg.sender], "TrellisVault: no balance");

        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        ebool canWithdraw = FHE.ge(_balances[msg.sender], amount);
        euint64 actualAmount = FHE.select(canWithdraw, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], actualAmount);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        emit Withdrawn(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Core: withdrawPlaintext (demo path)
    //
    // User decrypts their balance client-side via the Relayer SDK, then submits
    // a plaintext amount they know they hold. The FHE comparison guards the
    // encrypted state — if the user lies about their balance the subtracted
    // actualAmount resolves to 0, leaving their encrypted balance unchanged,
    // but the USDC transfer still fires for the amount they passed.
    // This is an accepted limitation of the demo: trust that the claimant
    // decrypted honestly. Production would use async decryption callbacks.
    // -------------------------------------------------------------------------

    function withdrawPlaintext(uint64 amount) external notPaused {
        require(_hasBalance[msg.sender], "TrellisVault: no balance");

        euint64 encAmount = FHE.asEuint64(amount);
        ebool canWithdraw = FHE.ge(_balances[msg.sender], encAmount);
        euint64 actualAmount = FHE.select(canWithdraw, encAmount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], actualAmount);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        require(usdc.transfer(msg.sender, amount), "TrellisVault: transfer failed");
        emit Withdrawn(msg.sender);
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    function getBalance(address user) external view returns (euint64) {
        return _balances[user];
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }
}
