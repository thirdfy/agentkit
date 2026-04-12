import {
  Chain,
  mainnet,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  base,
  arbitrum,
  optimism,
  polygonMumbai,
  polygon,
} from "viem/chains";
import { defineChain } from "viem";
import * as chains from "viem/chains";

/**
 * Maps EVM chain IDs to Coinbase network IDs
 */
export const CHAIN_ID_TO_NETWORK_ID: Record<number, string> = {
  1: "ethereum-mainnet",
  11155111: "ethereum-sepolia",
  137: "polygon-mainnet",
  80001: "polygon-mumbai",
  8453: "base-mainnet",
  84532: "base-sepolia",
  42161: "arbitrum-mainnet",
  421614: "arbitrum-sepolia",
  10: "optimism-mainnet",
  11155420: "optimism-sepolia",
  6281971: "dogeos-testnet",
};

const dogeosTestnet = defineChain({
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: {
    name: "Doge",
    symbol: "DOGE",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.dogeos.com"],
    },
    public: {
      http: ["https://rpc.testnet.dogeos.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "DogeOS Explorer",
      url: "https://blockscout.testnet.dogeos.com",
    },
  },
});

/**
 * Maps Coinbase network IDs to EVM chain IDs
 */
export const NETWORK_ID_TO_CHAIN_ID: Record<string, string> = Object.entries(
  CHAIN_ID_TO_NETWORK_ID,
).reduce(
  (acc, [chainId, networkId]) => {
    acc[networkId] = String(chainId);
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Maps Coinbase network IDs to Viem chain objects
 */
export const NETWORK_ID_TO_VIEM_CHAIN: Record<string, Chain> = {
  "ethereum-mainnet": mainnet,
  "ethereum-sepolia": sepolia,
  "polygon-mainnet": polygon,
  "polygon-mumbai": polygonMumbai,
  "base-mainnet": base,
  "base-sepolia": baseSepolia,
  "arbitrum-mainnet": arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  "optimism-mainnet": optimism,
  "optimism-sepolia": optimismSepolia,
  "dogeos-testnet": dogeosTestnet,
};

/**
 * Get a chain from the viem chains object
 *
 * @param id - The chain ID
 * @returns The chain
 */
export const getChain = (id: string): Chain => {
  const chainList = Object.values(chains);
  return chainList.find(chain => chain.id === parseInt(id)) as Chain;
};
