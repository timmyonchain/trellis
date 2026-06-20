import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";

const THREE_DAYS = 3 * 24 * 60 * 60;

describe("DisputeResolver", function () {
  async function deploy() {
    const [owner, alice, bob, charlie] = await ethers.getSigners();

    const TrellisToken = await ethers.getContractFactory("TrellisToken");
    const token = await TrellisToken.deploy(owner.address);
    await token.waitForDeployment();

    const ComplianceRegistry = await ethers.getContractFactory("ComplianceRegistry");
    const registry = await ComplianceRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    const DisputeResolver = await ethers.getContractFactory("DisputeResolver");
    const resolver = await DisputeResolver.deploy(
      owner.address,
      await token.getAddress(),
      await registry.getAddress()
    );
    await resolver.waitForDeployment();

    // Give alice and bob 200k tokens each so they can reach quorum independently
    const dec = await token.decimals();
    const VOTE_TOKENS = 200_000n * 10n ** dec;
    await token.mint(alice.address, VOTE_TOKENS);
    await token.mint(bob.address, VOTE_TOKENS);

    return { resolver, token, registry, owner, alice, bob, charlie };
  }

  it("user can submitDispute", async function () {
    const { resolver, alice } = await deploy();
    await expect(resolver.connect(alice).submitDispute("ipfs://evidence"))
      .to.emit(resolver, "DisputeSubmitted")
      .withArgs(1n, alice.address, "ipfs://evidence");
    expect(await resolver.activeDisputeByClaimant(alice.address)).to.equal(1n);
    expect(await resolver.disputeCount()).to.equal(1n);
  });

  it("cannot submit second dispute while one is active", async function () {
    const { resolver, alice } = await deploy();
    await resolver.connect(alice).submitDispute("ipfs://evidence");
    await expect(resolver.connect(alice).submitDispute("ipfs://other"))
      .to.be.revertedWith("DisputeResolver: active dispute exists");
  });

  it("token holders can vote", async function () {
    const { resolver, alice, bob } = await deploy();
    await resolver.connect(alice).submitDispute("ipfs://evidence");
    await expect(resolver.connect(bob).vote(1n, true))
      .to.emit(resolver, "Voted");
    expect(await resolver.hasVoted(1n, bob.address)).to.be.true;
  });

  it("cannot vote twice on the same dispute", async function () {
    const { resolver, alice, bob } = await deploy();
    await resolver.connect(alice).submitDispute("ipfs://evidence");
    await resolver.connect(bob).vote(1n, true);
    await expect(resolver.connect(bob).vote(1n, false))
      .to.be.revertedWith("DisputeResolver: already voted");
  });

  it("cannot vote without holding tokens", async function () {
    const { resolver, alice, charlie } = await deploy();
    await resolver.connect(alice).submitDispute("ipfs://evidence");
    // charlie has no tokens
    await expect(resolver.connect(charlie).vote(1n, true))
      .to.be.revertedWith("DisputeResolver: no voting power");
  });

  it("dispute passes when quorum + 60% threshold met → removeFromBlacklist called", async function () {
    const { resolver, registry, owner, alice } = await deploy();

    // Blacklist alice before transferring registry ownership to resolver
    await registry.addCaller(owner.address);
    await registry.addToBlacklist(alice.address);
    await registry.transferOwnership(await resolver.getAddress());

    await resolver.connect(alice).submitDispute("ipfs://evidence");

    // Owner votes YES — 1 000 000 tokens (~71% of 1.4 M total supply → quorum + threshold)
    await resolver.connect(owner).vote(1n, true);

    await hre.network.provider.send("evm_increaseTime", [THREE_DAYS + 1]);
    await hre.network.provider.send("evm_mine");

    await expect(resolver.executeDispute(1n))
      .to.emit(resolver, "DisputePassed")
      .withArgs(1n, alice.address);

    expect(await registry.isBlacklisted(alice.address)).to.be.false;
    expect(await resolver.activeDisputeByClaimant(alice.address)).to.equal(0n);
  });

  it("dispute fails when 60% YES threshold is not met", async function () {
    const { resolver, alice, bob } = await deploy();

    await resolver.connect(alice).submitDispute("ipfs://evidence");
    // Bob votes NO — quorum met but 0% YES → fails
    await resolver.connect(bob).vote(1n, false);

    await hre.network.provider.send("evm_increaseTime", [THREE_DAYS + 1]);
    await hre.network.provider.send("evm_mine");

    await expect(resolver.executeDispute(1n))
      .to.emit(resolver, "DisputeFailed")
      .withArgs(1n, alice.address);

    expect(await resolver.activeDisputeByClaimant(alice.address)).to.equal(0n);
  });

  it("owner can cancelDispute", async function () {
    const { resolver, owner, alice } = await deploy();
    await resolver.connect(alice).submitDispute("ipfs://evidence");
    await expect(resolver.cancelDispute(1n))
      .to.emit(resolver, "DisputeCancelled")
      .withArgs(1n);
    expect(await resolver.activeDisputeByClaimant(alice.address)).to.equal(0n);
  });
});
