const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Treasury = await ethers.getContractFactory(
    "EmbeddedMiniappTreasury"
  );
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();

  const address = await treasury.getAddress();
  console.log("EmbeddedMiniappTreasury deployed to:", address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});