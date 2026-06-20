import { expect } from "chai";
import { ethers } from "hardhat";
import { decryptUint64, encryptUint64 } from "./helpers";

const DEPOSIT = 1_000n; // 0.001 USDC (6 decimals)

describe("TrellisVault", function () {
  async function deploy() {
    const [owner, cleanUser, flaggedUser] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const ComplianceRegistry = await ethers.getContractFactory("ComplianceRegistry");
    const registry = await ComplianceRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    const TrellisVault = await ethers.getContractFactory("TrellisVault");
    const vault = await TrellisVault.deploy(
      await usdc.getAddress(),
      await registry.getAddress(),
      owner.address
    );
    await vault.waitForDeployment();

    const vaultAddr = await vault.getAddress();

    // Authorize vault to call quarantine()
    await registry.addCaller(vaultAddr);
    // Authorize owner to call addToBlacklist() for test setup
    await registry.addCaller(owner.address);
    // Blacklist flaggedUser so their deposit gets quarantined
    await registry.addToBlacklist(flaggedUser.address);

    // Fund both users with USDC and approve vault
    await usdc.mint(cleanUser.address, DEPOSIT * 10n);
    await usdc.mint(flaggedUser.address, DEPOSIT * 10n);
    await usdc.connect(cleanUser).approve(vaultAddr, DEPOSIT * 10n);
    await usdc.connect(flaggedUser).approve(vaultAddr, DEPOSIT * 10n);

    return { vault, usdc, registry, owner, cleanUser, flaggedUser, vaultAddr };
  }

  it("clean user can deposit and encrypted balance is correct", async function () {
    const { vault, cleanUser, vaultAddr } = await deploy();
    await vault.connect(cleanUser).deposit(DEPOSIT);
    const handle = await vault.getBalance(cleanUser.address);
    const balance = await decryptUint64(handle, vaultAddr, cleanUser);
    expect(balance).to.equal(DEPOSIT);
  });

  it("flagged user deposit gets quarantined", async function () {
    const { vault, registry, flaggedUser, vaultAddr } = await deploy();
    await vault.connect(flaggedUser).deposit(DEPOSIT);

    // Verify quarantine totals
    expect(await registry.totalQuarantined()).to.equal(DEPOSIT);

    // Decrypt the depositor's own quarantine balance
    const registryAddr = await registry.getAddress();
    const handle = await registry.getQuarantineBalance(flaggedUser.address);
    const quarantined = await decryptUint64(handle, registryAddr, flaggedUser);
    expect(quarantined).to.equal(DEPOSIT);
  });

  it("clean user can withdrawPlaintext successfully", async function () {
    const { vault, usdc, cleanUser, vaultAddr } = await deploy();
    await vault.connect(cleanUser).deposit(DEPOSIT);

    const usdcBefore = await usdc.balanceOf(cleanUser.address);
    const withdrawAmt = DEPOSIT / 2n;
    await vault.connect(cleanUser).withdrawPlaintext(withdrawAmt);
    const usdcAfter = await usdc.balanceOf(cleanUser.address);

    expect(usdcAfter - usdcBefore).to.equal(withdrawAmt);

    // Encrypted balance should reflect the remainder
    const handle = await vault.getBalance(cleanUser.address);
    const balance = await decryptUint64(handle, vaultAddr, cleanUser);
    expect(balance).to.equal(DEPOSIT - withdrawAmt);
  });

  it("withdraw with insufficient balance is a silent no-op (balance unchanged)", async function () {
    const { vault, cleanUser, vaultAddr } = await deploy();
    await vault.connect(cleanUser).deposit(DEPOSIT);

    // Attempt to withdraw twice the deposited amount — should not revert
    const { handle: encHandle, proof } = await encryptUint64(vaultAddr, cleanUser, DEPOSIT * 2n);
    await expect(vault.connect(cleanUser).withdraw(encHandle, proof)).to.not.be.reverted;

    // FHE guard: actualAmount resolves to 0, balance is unchanged
    const handle = await vault.getBalance(cleanUser.address);
    const balance = await decryptUint64(handle, vaultAddr, cleanUser);
    expect(balance).to.equal(DEPOSIT);
  });

  it("paused vault rejects deposits", async function () {
    const { vault, cleanUser } = await deploy();
    await vault.pause();
    await expect(vault.connect(cleanUser).deposit(DEPOSIT))
      .to.be.revertedWith("Vault is paused");
  });
});
