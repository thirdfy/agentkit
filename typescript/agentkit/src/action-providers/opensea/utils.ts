import { Chain } from "opensea-js";

/**
 * Supported Opensea chains
 */
export const supportedChains: Record<string, Chain> = {
  "1": Chain.Mainnet,
  "137": Chain.Polygon,
  "42161": Chain.Arbitrum,
  "43114": Chain.Avalanche,
  "238": Chain.Blast,
  "8453": Chain.Base,
  "10": Chain.Optimism,
  "7777777": Chain.Zora,
  "1329": Chain.Sei,
  "8333": Chain.B3,
  "80094": Chain.BeraChain,
};

/**
 * Maps EVM chain IDs to Opensea chain
 *
 * @param chainId - The EVM chain ID to map
 * @returns The corresponding OpenSea Chain enum value
 */
export const chainIdToOpenseaChain = (chainId: string): Chain => {
  const chain = supportedChains[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID on Opensea: ${chainId}`);
  }
  return chain;
};
