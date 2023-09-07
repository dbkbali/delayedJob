import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-prettier";
import "solidity-coverage";

const config: HardhatUserConfig = {
  solidity: "0.8.19",
};

export default config;
