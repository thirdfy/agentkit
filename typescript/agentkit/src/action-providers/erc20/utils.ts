import { Hex, erc20Abi, formatUnits } from "viem";
import { EvmWalletProvider } from "../../wallet-providers";

/**
 * Interface for token details
 */
export interface TokenDetails {
  name: string;
  decimals: number;
  balance: bigint;
  formattedBalance: string;
}

/**
 * Gets the details of an ERC20 token including name, decimals, and balance.
 *
 * @param walletProvider - The wallet provider to use for the multicall.
 * @param contractAddress - The contract address of the ERC20 token.
 * @param address - The address to check the balance for. If not provided, uses the wallet's address.
 * @returns A promise that resolves to TokenDetails or null if there's an error.
 */
export async function getTokenDetails(
  walletProvider: EvmWalletProvider,
  contractAddress: string,
  address?: string,
): Promise<TokenDetails | null> {
  try {
    let name: string | undefined;
    let decimals: number | undefined;
    let balance: bigint | undefined;

    try {
      const results = await walletProvider.getPublicClient().multicall({
        contracts: [
          {
            address: contractAddress as Hex,
            abi: erc20Abi,
            functionName: "name",
            args: [],
          },
          {
            address: contractAddress as Hex,
            abi: erc20Abi,
            functionName: "decimals",
            args: [],
          },
          {
            address: contractAddress as Hex,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [(address || walletProvider.getAddress()) as Hex],
          },
        ],
      });
      name = results[0].result as string | undefined;
      decimals = results[1]?.result as number | undefined;
      balance = results[2]?.result as bigint | undefined;
      if (name === undefined || decimals === undefined || balance === undefined) {
        throw new Error("MULTICALL_INCOMPLETE");
      }
    } catch {
      // Some EVM networks (e.g. DogeOS testnet) do not expose a viem-compatible multicall3.
      // Fall back to direct contract reads to keep ERC20 tools functional.
      const client = walletProvider.getPublicClient();
      const result = (await Promise.all([
        client.readContract({
          address: contractAddress as Hex,
          abi: erc20Abi,
          functionName: "name",
          args: [],
        }),
        client.readContract({
          address: contractAddress as Hex,
          abi: erc20Abi,
          functionName: "decimals",
          args: [],
        }),
        client.readContract({
          address: contractAddress as Hex,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [(address || walletProvider.getAddress()) as Hex],
        }),
      ])) as [string, number, bigint];

      name = result[0];
      decimals = result[1];
      balance = result[2];
    }

    if (balance === undefined || decimals === undefined || name === undefined) {
      return null;
    }

    const formattedBalance = formatUnits(BigInt(balance), decimals);

    return {
      name,
      decimals,
      balance: BigInt(balance),
      formattedBalance,
    };
  } catch {
    return null;
  }
}
