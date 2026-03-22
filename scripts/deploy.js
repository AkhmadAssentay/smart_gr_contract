const { ethers } = require("hardhat");

async function main() {
  const [deployer, exec2, exec3] = await ethers.getSigners();

  console.log("Deploying MultiSigTreasury...");
  console.log("Deployer (Exec 1):", deployer.address);
  console.log("Executive 2:      ", exec2.address);
  console.log("Executive 3:      ", exec3.address);

  const MultiSigTreasury = await ethers.getContractFactory("MultiSigTreasury");
  const treasury = await MultiSigTreasury.deploy([
    deployer.address,
    exec2.address,
    exec3.address,
  ]);

  await treasury.waitForDeployment();
  const address = await treasury.getAddress();

  console.log("\n✅ MultiSigTreasury deployed to:", address);
  console.log("\nNext steps:");
  console.log("  1. Fund the treasury:  send ETH to", address);
  console.log("  2. Open frontend/index.html and paste the contract address");
  console.log("  3. Connect MetaMask (Sepolia network) and start proposing!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
