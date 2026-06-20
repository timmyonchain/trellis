import { expect } from "chai";
import { ethers } from "hardhat";

describe("KYTOracle", function () {
  async function deploy() {
    const [owner, feeder1, feeder2, feeder3, target] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("KYTOracle");
    const oracle = await factory.deploy(owner.address);
    await oracle.waitForDeployment();
    return { oracle, owner, feeder1, feeder2, feeder3, target };
  }

  it("owner can add and remove feeders", async function () {
    const { oracle, feeder1 } = await deploy();
    await oracle.addFeeder(feeder1.address);
    expect(await oracle.authorizedFeeders(feeder1.address)).to.be.true;
    await oracle.removeFeeder(feeder1.address);
    expect(await oracle.authorizedFeeders(feeder1.address)).to.be.false;
  });

  it("authorized feeder can submitFlag", async function () {
    const { oracle, feeder1, target } = await deploy();
    await oracle.addFeeder(feeder1.address);
    await expect(oracle.connect(feeder1).submitFlag(target.address, 80, "exploit-src", 2))
      .to.emit(oracle, "FlagSubmitted")
      .withArgs(target.address, feeder1.address, 80);
  });

  it("non-authorized cannot submitFlag", async function () {
    const { oracle, feeder1, target } = await deploy();
    await expect(
      oracle.connect(feeder1).submitFlag(target.address, 80, "exploit-src", 2)
    ).to.be.revertedWith("KYTOracle: not an authorized feeder");
  });

  it("different feeder can confirmFlag (2-of-2 enforcement)", async function () {
    const { oracle, feeder1, feeder2, target } = await deploy();
    await oracle.addFeeder(feeder1.address);
    await oracle.addFeeder(feeder2.address);
    await oracle.connect(feeder1).submitFlag(target.address, 80, "exploit-src", 2);
    await expect(oracle.connect(feeder2).confirmFlag(target.address))
      .to.emit(oracle, "FlagConfirmed")
      .withArgs(target.address, 80, "exploit-src");
    expect(await oracle.confirmedFlags(target.address)).to.be.true;
    expect(await oracle.riskScores(target.address)).to.equal(80);
  });

  it("same feeder cannot self-confirm", async function () {
    const { oracle, feeder1, target } = await deploy();
    await oracle.addFeeder(feeder1.address);
    await oracle.connect(feeder1).submitFlag(target.address, 80, "exploit-src", 2);
    await expect(oracle.connect(feeder1).confirmFlag(target.address))
      .to.be.revertedWith("KYTOracle: submitter cannot confirm");
  });

  it("owner can revokeFlag after confirmation", async function () {
    const { oracle, feeder1, feeder2, target } = await deploy();
    await oracle.addFeeder(feeder1.address);
    await oracle.addFeeder(feeder2.address);
    await oracle.connect(feeder1).submitFlag(target.address, 80, "exploit-src", 2);
    await oracle.connect(feeder2).confirmFlag(target.address);
    await expect(oracle.revokeFlag(target.address))
      .to.emit(oracle, "FlagRevoked")
      .withArgs(target.address);
    expect(await oracle.confirmedFlags(target.address)).to.be.false;
    expect(await oracle.riskScores(target.address)).to.equal(0);
  });

  it("cannot revoke an unconfirmed flag", async function () {
    const { oracle, feeder1, target } = await deploy();
    await oracle.addFeeder(feeder1.address);
    await oracle.connect(feeder1).submitFlag(target.address, 80, "exploit-src", 2);
    await expect(oracle.revokeFlag(target.address))
      .to.be.revertedWith("KYTOracle: not confirmed");
  });
});
