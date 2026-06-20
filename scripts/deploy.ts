import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  // ---------------------------------------------------------------------------
  // 1. TrellisToken
  // ---------------------------------------------------------------------------
  const TrellisToken = await ethers.getContractFactory("TrellisToken");
  const trellisToken = await TrellisToken.deploy(deployer.address);
  await trellisToken.waitForDeployment();
  const trellisTokenAddress = await trellisToken.getAddress();
  console.log(`[1/5] TrellisToken deployed: ${trellisTokenAddress}`);

  // ---------------------------------------------------------------------------
  // 2. KYTOracle
  // ---------------------------------------------------------------------------
  const KYTOracle = await ethers.getContractFactory("KYTOracle");
  const kytOracle = await KYTOracle.deploy(deployer.address);
  await kytOracle.waitForDeployment();
  const kytOracleAddress = await kytOracle.getAddress();
  console.log(`[2/5] KYTOracle deployed: ${kytOracleAddress}`);

  // ---------------------------------------------------------------------------
  // 3. ComplianceRegistry
  // ---------------------------------------------------------------------------
  const ComplianceRegistry = await ethers.getContractFactory("ComplianceRegistry");
  const complianceRegistry = await ComplianceRegistry.deploy(deployer.address);
  await complianceRegistry.waitForDeployment();
  const complianceRegistryAddress = await complianceRegistry.getAddress();
  console.log(`[3/5] ComplianceRegistry deployed: ${complianceRegistryAddress}`);

  // ---------------------------------------------------------------------------
  // 4. TrellisVault
  // ---------------------------------------------------------------------------
  const TrellisVault = await ethers.getContractFactory("TrellisVault");
  const trellisVault = await TrellisVault.deploy(
    SEPOLIA_USDC,
    complianceRegistryAddress,
    deployer.address
  );
  await trellisVault.waitForDeployment();
  const trellisVaultAddress = await trellisVault.getAddress();
  console.log(`[4/5] TrellisVault deployed: ${trellisVaultAddress}`);

  // ---------------------------------------------------------------------------
  // 5. DisputeResolver
  // Note: constructor order is (initialOwner, trellisToken_, complianceRegistry_)
  // ---------------------------------------------------------------------------
  const DisputeResolver = await ethers.getContractFactory("DisputeResolver");
  const disputeResolver = await DisputeResolver.deploy(
    deployer.address,
    trellisTokenAddress,
    complianceRegistryAddress
  );
  await disputeResolver.waitForDeployment();
  const disputeResolverAddress = await disputeResolver.getAddress();
  console.log(`[5/5] DisputeResolver deployed: ${disputeResolverAddress}`);

  // ---------------------------------------------------------------------------
  // Wiring [1/4]: TrellisVault authorized on ComplianceRegistry
  // Allows TrellisVault to call quarantine() on flagged deposits.
  // ---------------------------------------------------------------------------
  let tx = await complianceRegistry.addCaller(trellisVaultAddress);
  await tx.wait();
  console.log("Wiring [1/4] TrellisVault authorized on ComplianceRegistry");

  // ---------------------------------------------------------------------------
  // Wiring [2/4]: KYTOracle authorized on ComplianceRegistry
  // Wired now for future direct integration; KYTOracle does not call
  // ComplianceRegistry in the current implementation.
  // ---------------------------------------------------------------------------
  tx = await complianceRegistry.addCaller(kytOracleAddress);
  await tx.wait();
  console.log("Wiring [2/4] KYTOracle authorized on ComplianceRegistry");

  // ---------------------------------------------------------------------------
  // Wiring [3/4]: Transfer ComplianceRegistry ownership to DisputeResolver
  // Required so DisputeResolver.executeDispute() can call removeFromBlacklist().
  // After this tx the deployer can no longer call owner-only functions on
  // ComplianceRegistry directly.
  // ---------------------------------------------------------------------------
  tx = await complianceRegistry.transferOwnership(disputeResolverAddress);
  await tx.wait();
  console.log("Wiring [3/4] ComplianceRegistry ownership transferred to DisputeResolver");

  // ---------------------------------------------------------------------------
  // Wiring [4/4]: Add deployer as KYTOracle feeder
  // Lets us submit and confirm flags manually during testing and demo.
  // ---------------------------------------------------------------------------
  tx = await kytOracle.addFeeder(deployer.address);
  await tx.wait();
  console.log("Wiring [4/4] Deployer added as KYTOracle feeder");

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const addresses = {
    TrellisToken: trellisTokenAddress,
    KYTOracle: kytOracleAddress,
    ComplianceRegistry: complianceRegistryAddress,
    TrellisVault: trellisVaultAddress,
    DisputeResolver: disputeResolverAddress,
  };

  console.log("\nDeployment complete:");
  console.log(addresses);

  // ---------------------------------------------------------------------------
  // Persist to deployments/sepolia.json
  // ---------------------------------------------------------------------------
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const record = {
    network: "sepolia",
    deployedAt: new Date().toISOString(),
    contracts: {
      ...addresses,
      USDC: SEPOLIA_USDC,
    },
  };

  fs.writeFileSync(
    path.join(deploymentsDir, "sepolia.json"),
    JSON.stringify(record, null, 2)
  );
  console.log("Addresses saved to deployments/sepolia.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
