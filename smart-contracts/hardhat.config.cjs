require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");

const {
  PRIVATE_KEY,
  BASE_RPC_URL,
  BASE_SEPOLIA_RPC_URL,
  ETHERSCAN_API_KEY,
} = process.env;

function pkArray() {
  if (!PRIVATE_KEY) return [];
  const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  return [pk];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    base: {
      url: BASE_RPC_URL || "https://mainnet.base.org",
      accounts: pkArray(),
      chainId: 8453,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: pkArray(),
      chainId: 84532,
    },
  },
  etherscan: {
    apiKey: {
      base: ETHERSCAN_API_KEY || "",
      baseSepolia: ETHERSCAN_API_KEY || "",
    },
  },
};