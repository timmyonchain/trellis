// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";

contract KYTOracle is Ownable {
    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    struct PendingFlag {
        address submitter;
        uint8 riskScore;
        string exploitSource;
        uint8 hopCount;
        uint256 timestamp;
        bool confirmed;
    }

    mapping(address => bool) public authorizedFeeders;
    mapping(address => PendingFlag) public pendingFlags;
    mapping(address => bool) public confirmedFlags;
    mapping(address => uint8) public riskScores;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event FlagSubmitted(address indexed target, address indexed submitter, uint8 riskScore);
    event FlagConfirmed(address indexed target, uint8 riskScore, string exploitSource);
    event FlagRevoked(address indexed target);
    event FeederAdded(address indexed feeder);
    event FeederRemoved(address indexed feeder);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyFeeder() {
        require(authorizedFeeders[msg.sender], "KYTOracle: not an authorized feeder");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address initialOwner) Ownable(initialOwner) {}

    // -------------------------------------------------------------------------
    // Feeder management
    // -------------------------------------------------------------------------

    function addFeeder(address feeder) external onlyOwner {
        require(feeder != address(0), "KYTOracle: zero address");
        require(!authorizedFeeders[feeder], "KYTOracle: already a feeder");
        authorizedFeeders[feeder] = true;
        emit FeederAdded(feeder);
    }

    function removeFeeder(address feeder) external onlyOwner {
        require(authorizedFeeders[feeder], "KYTOracle: not a feeder");
        authorizedFeeders[feeder] = false;
        emit FeederRemoved(feeder);
    }

    // -------------------------------------------------------------------------
    // Two-step flag lifecycle
    // -------------------------------------------------------------------------

    function submitFlag(
        address target,
        uint8 riskScore,
        string calldata exploitSource,
        uint8 hopCount
    ) external onlyFeeder {
        require(target != address(0), "KYTOracle: zero address");
        require(!confirmedFlags[target], "KYTOracle: already confirmed");
        require(
            pendingFlags[target].submitter == address(0),
            "KYTOracle: flag already pending"
        );

        pendingFlags[target] = PendingFlag({
            submitter: msg.sender,
            riskScore: riskScore,
            exploitSource: exploitSource,
            hopCount: hopCount,
            timestamp: block.timestamp,
            confirmed: false
        });

        emit FlagSubmitted(target, msg.sender, riskScore);
    }

    function confirmFlag(address target) external onlyFeeder {
        PendingFlag storage flag = pendingFlags[target];
        require(flag.submitter != address(0), "KYTOracle: no pending flag");
        require(!flag.confirmed, "KYTOracle: already confirmed");
        require(flag.submitter != msg.sender, "KYTOracle: submitter cannot confirm");

        flag.confirmed = true;
        confirmedFlags[target] = true;
        riskScores[target] = flag.riskScore;

        emit FlagConfirmed(target, flag.riskScore, flag.exploitSource);
    }

    // -------------------------------------------------------------------------
    // Revocation
    // -------------------------------------------------------------------------

    function revokeFlag(address target) external onlyOwner {
        require(confirmedFlags[target], "KYTOracle: not confirmed");

        confirmedFlags[target] = false;
        riskScores[target] = 0;
        delete pendingFlags[target];

        emit FlagRevoked(target);
    }
}
