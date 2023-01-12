import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true 
    }
  },
  solidity: {
    compilers: [
      { version: "0.8.9" }
    ],
  },
  mocha: {
    timeout: 300 * 1e3,
  }
};

export default config;
