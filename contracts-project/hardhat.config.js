require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const sepoliaUrl = process.env.SEPOLIA_RPC_URL;
const privateKey = process.env.PRIVATE_KEY;

module.exports = {
  solidity: "0.8.20",

  networks: {
    ...(sepoliaUrl
      ? {
          sepolia: {
            url: sepoliaUrl,
            accounts: privateKey ? [privateKey] : [],
          },
        }
      : {}),
  },
};
