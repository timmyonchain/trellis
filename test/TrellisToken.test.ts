import { expect } from "chai";
import { ethers } from "hardhat";

describe("TrellisToken", function () {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("TrellisToken");
    const token = await factory.deploy(owner.address);
    await token.waitForDeployment();
    return { token, owner, alice };
  }

  it("deploys with 1,000,000 supply minted to owner", async function () {
    const { token, owner } = await deploy();
    const decimals = await token.decimals();
    const expected = 1_000_000n * 10n ** decimals;
    expect(await token.totalSupply()).to.equal(expected);
    expect(await token.balanceOf(owner.address)).to.equal(expected);
  });

  it("owner can mint additional tokens", async function () {
    const { token, alice } = await deploy();
    const decimals = await token.decimals();
    const amount = 500n * 10n ** decimals;
    await token.mint(alice.address, amount);
    expect(await token.balanceOf(alice.address)).to.equal(amount);
  });

  it("non-owner cannot mint", async function () {
    const { token, alice } = await deploy();
    await expect(
      token.connect(alice).mint(alice.address, 1n)
    ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });
});
