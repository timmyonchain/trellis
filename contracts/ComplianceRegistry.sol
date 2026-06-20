// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { FHE, euint64, eaddress, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ComplianceRegistry is ZamaEthereumConfig, Ownable {
    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    mapping(address => bool) public authorizedCallers;

    eaddress[] private _blacklist;
    mapping(address => bool) public isBlacklisted;
    uint256 public blacklistSize;

    mapping(address => euint64) private _quarantineBalances;
    // Tracks whether a depositor has ever been quarantined, so FHE.add is
    // only called on an initialized handle (adding to handle(0) is undefined).
    mapping(address => bool) private _hasQuarantineBalance;
    uint256 public totalQuarantined;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event AddedToBlacklist(address indexed target);
    event RemovedFromBlacklist(address indexed target);
    event Quarantined(address indexed depositor, uint64 amount);
    event CallerAdded(address indexed caller);
    event CallerRemoved(address indexed caller);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "ComplianceRegistry: not authorized");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address initialOwner) Ownable(initialOwner) {}

    // -------------------------------------------------------------------------
    // Caller management
    // -------------------------------------------------------------------------

    function addCaller(address caller) external onlyOwner {
        require(caller != address(0), "ComplianceRegistry: zero address");
        require(!authorizedCallers[caller], "ComplianceRegistry: already authorized");
        authorizedCallers[caller] = true;
        emit CallerAdded(caller);
    }

    function removeCaller(address caller) external onlyOwner {
        require(authorizedCallers[caller], "ComplianceRegistry: not authorized");
        authorizedCallers[caller] = false;
        emit CallerRemoved(caller);
    }

    // -------------------------------------------------------------------------
    // Blacklist
    // -------------------------------------------------------------------------

    function addToBlacklist(address target) external onlyAuthorized {
        require(!isBlacklisted[target], "ComplianceRegistry: already blacklisted");

        isBlacklisted[target] = true;
        eaddress encryptedAddr = FHE.asEaddress(target);
        FHE.allowThis(encryptedAddr);
        _blacklist.push(encryptedAddr);
        blacklistSize++;

        emit AddedToBlacklist(target);
    }

    // Cheap plaintext pre-check — avoids FHE gas for the vast majority of
    // deposits that are not blacklisted.
    function screenDeposit(address depositor) external view returns (bool) {
        if (isBlacklisted[depositor]) return true;
        return false;
    }

    function removeFromBlacklist(address target) external onlyOwner {
        require(isBlacklisted[target], "ComplianceRegistry: not blacklisted");

        isBlacklisted[target] = false;
        blacklistSize--;

        // _blacklist array is NOT pruned — isBlacklisted is the source of truth.
        emit RemovedFromBlacklist(target);
    }

    // -------------------------------------------------------------------------
    // Quarantine
    // -------------------------------------------------------------------------

    function quarantine(address depositor, uint64 amount) external onlyAuthorized {
        require(isBlacklisted[depositor], "ComplianceRegistry: not blacklisted");

        euint64 encryptedAmount = FHE.asEuint64(amount);

        if (_hasQuarantineBalance[depositor]) {
            _quarantineBalances[depositor] = FHE.add(_quarantineBalances[depositor], encryptedAmount);
        } else {
            _quarantineBalances[depositor] = encryptedAmount;
            _hasQuarantineBalance[depositor] = true;
        }

        FHE.allowThis(_quarantineBalances[depositor]);
        FHE.allow(_quarantineBalances[depositor], depositor);

        totalQuarantined += amount;

        emit Quarantined(depositor, amount);
    }

    function getQuarantineBalance(address depositor) external view returns (euint64) {
        return _quarantineBalances[depositor];
    }
}
