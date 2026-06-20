import { expect } from "chai";
import { ethers } from "hardhat";
import { decryptUint64 } from "./helpers";

describe("ComplianceRegistry", function () {
  async function deploy() {
    const [owner, caller, alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ComplianceRegistry");
    const registry = await factory.deploy(owner.address);
    await registry.waitForDeployment();
    return { registry, owner, caller, alice, bob };
  }

  it("owner can add and remove authorized callers", async function () {
    const { registry, caller } = await deploy();
    await registry.addCaller(caller.address);
    expect(await registry.authorizedCallers(caller.address)).to.be.true;
    await registry.removeCaller(caller.address);
    expect(await registry.authorizedCallers(caller.address)).to.be.false;
  });

  it("authorized caller can addToBlacklist", async function () {
    const { registry, caller, alice } = await deploy();
    await registry.addCaller(caller.address);
    await expect(registry.connect(caller).addToBlacklist(alice.address))
      .to.emit(registry, "AddedToBlacklist")
      .withArgs(alice.address);
    expect(await registry.isBlacklisted(alice.address)).to.be.true;
    expect(await registry.blacklistSize()).to.equal(1n);
  });

  it("screenDeposit returns true for blacklisted address", async function () {
    const { registry, caller, alice } = await deploy();
    await registry.addCaller(caller.address);
    await registry.connect(caller).addToBlacklist(alice.address);
    expect(await registry.screenDeposit(alice.address)).to.be.true;
  });

  it("screenDeposit returns false for clean address", async function () {
    const { registry, alice } = await deploy();
    expect(await registry.screenDeposit(alice.address)).to.be.false;
  });

  it("quarantine correctly updates encrypted balance", async function () {
    const { registry, caller, alice } = await deploy();
    const registryAddr = await registry.getAddress();

    await registry.addCaller(caller.address);
    await registry.connect(caller).addToBlacklist(alice.address);

    const amount = 1000n;
    await registry.connect(caller).quarantine(alice.address, amount);

    expect(await registry.totalQuarantined()).to.equal(amount);

    const handle = await registry.getQuarantineBalance(alice.address);
    const decrypted = await decryptUint64(handle, registryAddr, alice);
    expect(decrypted).to.equal(amount);
  });

  it("owner can removeFromBlacklist", async function () {
    const { registry, caller, alice } = await deploy();
    await registry.addCaller(caller.address);
    await registry.connect(caller).addToBlacklist(alice.address);
    await expect(registry.removeFromBlacklist(alice.address))
      .to.emit(registry, "RemovedFromBlacklist")
      .withArgs(alice.address);
    expect(await registry.isBlacklisted(alice.address)).to.be.false;
    expect(await registry.blacklistSize()).to.equal(0n);
  });
});
