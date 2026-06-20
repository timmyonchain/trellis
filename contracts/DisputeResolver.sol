// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./TrellisToken.sol";
import "./ComplianceRegistry.sol";

contract DisputeResolver is Ownable {
    // -------------------------------------------------------------------------
    // Enums & Structs
    // -------------------------------------------------------------------------

    enum DisputeStatus { PENDING, PASSED, FAILED, CANCELLED }

    struct Dispute {
        uint256 disputeId;
        address claimant;
        string evidenceHash;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 deadline;
        DisputeStatus status;
    }

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------

    uint256 public votingPeriod = 3 days;
    uint256 public quorumBps = 1000;  // 10% of total supply
    uint256 public passingBps = 6000; // 60% YES threshold

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    TrellisToken public trellisToken;
    ComplianceRegistry public complianceRegistry;

    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => uint256) public activeDisputeByClaimant;
    uint256 public disputeCount;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event DisputeSubmitted(uint256 indexed disputeId, address indexed claimant, string evidenceHash);
    event Voted(uint256 indexed disputeId, address indexed voter, bool support, uint256 weight);
    event DisputePassed(uint256 indexed disputeId, address indexed claimant);
    event DisputeFailed(uint256 indexed disputeId, address indexed claimant);
    event DisputeCancelled(uint256 indexed disputeId);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address initialOwner,
        address trellisToken_,
        address complianceRegistry_
    ) Ownable(initialOwner) {
        trellisToken = TrellisToken(trellisToken_);
        complianceRegistry = ComplianceRegistry(complianceRegistry_);
    }

    // -------------------------------------------------------------------------
    // Dispute lifecycle
    // -------------------------------------------------------------------------

    function submitDispute(string calldata evidenceHash) external {
        require(activeDisputeByClaimant[msg.sender] == 0, "DisputeResolver: active dispute exists");
        require(bytes(evidenceHash).length > 0, "DisputeResolver: empty evidence hash");

        // IDs start at 1 so that the zero-value of activeDisputeByClaimant
        // unambiguously means "no active dispute".
        uint256 disputeId = ++disputeCount;

        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            claimant: msg.sender,
            evidenceHash: evidenceHash,
            yesVotes: 0,
            noVotes: 0,
            deadline: block.timestamp + votingPeriod,
            status: DisputeStatus.PENDING
        });

        activeDisputeByClaimant[msg.sender] = disputeId;

        emit DisputeSubmitted(disputeId, msg.sender, evidenceHash);
    }

    function vote(uint256 disputeId, bool support) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.PENDING, "DisputeResolver: not pending");
        require(block.timestamp < dispute.deadline, "DisputeResolver: voting ended");
        require(!hasVoted[disputeId][msg.sender], "DisputeResolver: already voted");

        uint256 weight = trellisToken.balanceOf(msg.sender);
        require(weight > 0, "DisputeResolver: no voting power");

        if (support) {
            dispute.yesVotes += weight;
        } else {
            dispute.noVotes += weight;
        }

        hasVoted[disputeId][msg.sender] = true;

        emit Voted(disputeId, msg.sender, support, weight);
    }

    function executeDispute(uint256 disputeId) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.PENDING, "DisputeResolver: not pending");
        require(block.timestamp >= dispute.deadline, "DisputeResolver: voting ongoing");

        uint256 totalVotes = dispute.yesVotes + dispute.noVotes;
        uint256 totalSupply = trellisToken.totalSupply();

        // Both checks short-circuit to avoid division by zero:
        // if totalSupply == 0, quorumMet = false without dividing.
        // if totalVotes == 0, passingMet = false without dividing.
        bool quorumMet = totalSupply > 0 && (totalVotes * 10000 / totalSupply >= quorumBps);
        bool passingMet = totalVotes > 0 && (dispute.yesVotes * 10000 / totalVotes >= passingBps);

        address claimant = dispute.claimant;

        if (quorumMet && passingMet) {
            dispute.status = DisputeStatus.PASSED;
            complianceRegistry.removeFromBlacklist(claimant);
            emit DisputePassed(disputeId, claimant);
        } else {
            dispute.status = DisputeStatus.FAILED;
            emit DisputeFailed(disputeId, claimant);
        }

        delete activeDisputeByClaimant[claimant];
    }

    function cancelDispute(uint256 disputeId) external onlyOwner {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.status == DisputeStatus.PENDING, "DisputeResolver: not pending");

        address claimant = dispute.claimant;
        dispute.status = DisputeStatus.CANCELLED;
        delete activeDisputeByClaimant[claimant];

        emit DisputeCancelled(disputeId);
    }
}
