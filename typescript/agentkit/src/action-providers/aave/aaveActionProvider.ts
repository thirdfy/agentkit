import { z } from "zod";
import { Decimal } from "decimal.js";
import { encodeFunctionData, erc20Abi, Hex, maxUint256, parseAbi, parseUnits } from "viem";
import { ActionProvider } from "../actionProvider";
import { EvmWalletProvider } from "../../wallet-providers";
import { CreateAction } from "../actionDecorator";
import { Network } from "../../network";
import { approve } from "../../utils";
import { listAaveV3MainnetPools, resolveAavePool } from "./constants";
import { AaveSupplySchema, AaveWithdrawSchema } from "./schemas";

const POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

/**
 * AaveActionProvider supplies and withdraws underlying assets on Aave V3 pools.
 * Pool addresses come from `@bgd-labs/aave-address-book` (all mainnet instances).
 */
export class AaveActionProvider extends ActionProvider<EvmWalletProvider> {
  /**
   * Constructor for the AaveActionProvider class.
   */
  constructor() {
    super("aave", []);
  }

  /**
   * Supplies an ERC-20 asset into an Aave V3 Pool.
   *
   * @param wallet - The wallet instance to execute the transaction
   * @param args - The input arguments for the action
   * @returns A success message with transaction details or an error message
   */
  @CreateAction({
    name: "aave_supply",
    description: `
This tool supplies an ERC-20 asset into an Aave V3 Pool on a supported mainnet.

It takes:
- asset: Underlying ERC-20 address to supply
- amount: Amount in whole token units (e.g. "1.5")
- poolAddress: Aave V3 Pool address for this market instance (required when a chain has multiple Aave instances)
- onBehalfOf: Optional recipient of aTokens; defaults to the wallet address
- referralCode: Optional referral code; use 0

Important notes:
- Use the exact amount provided. Do not convert units for this action.
- Referral code should be 0 unless you have an active Aave referral.
`,
    schema: AaveSupplySchema,
  })
  async aaveSupply(
    wallet: EvmWalletProvider,
    args: z.infer<typeof AaveSupplySchema>,
  ): Promise<string> {
    const amount = new Decimal(args.amount);
    if (amount.comparedTo(new Decimal(0)) <= 0) {
      return "Error: amount must be greater than 0";
    }

    try {
      const network = await wallet.getNetwork();
      const chainId = Number((network as { chainId?: number | string }).chainId || 0);
      const market = resolveAavePool(chainId, args.poolAddress);
      if (!market) {
        return `Error: no Aave V3 pool configured for chain ${chainId}`;
      }

      const decimals = await wallet.readContract({
        address: args.asset as Hex,
        abi: erc20Abi,
        functionName: "decimals",
      });
      const atomicAmount = parseUnits(args.amount, Number(decimals));

      const approval = await approve(wallet, args.asset, market.pool, atomicAmount);
      if (approval.startsWith("Error")) {
        return `Error approving Aave Pool as spender: ${approval}`;
      }

      const onBehalfOf = (args.onBehalfOf || (await wallet.getAddress())) as Hex;
      const data = encodeFunctionData({
        abi: POOL_ABI,
        functionName: "supply",
        args: [args.asset as Hex, atomicAmount, onBehalfOf, args.referralCode ?? 0],
      });

      const txHash = await wallet.sendTransaction({ to: market.pool, data });
      await wallet.waitForTransactionReceipt(txHash);

      return `Supplied ${args.amount} to Aave pool ${market.pool}. Transaction hash: ${txHash}`;
    } catch (error) {
      return `Error supplying to Aave: ${error}`;
    }
  }

  /**
   * Withdraws an underlying asset from an Aave V3 Pool.
   *
   * @param wallet - The wallet instance to execute the transaction
   * @param args - The input arguments for the action
   * @returns A success message with transaction details or an error message
   */
  @CreateAction({
    name: "aave_withdraw",
    description: `
This tool withdraws an underlying asset from an Aave V3 Pool.

It takes:
- asset: Underlying ERC-20 address to withdraw
- amount: Amount in whole token units, or "max" for a full withdraw
- poolAddress: Aave V3 Pool address for this market instance
- to: Optional recipient of the underlying; defaults to the wallet address
`,
    schema: AaveWithdrawSchema,
  })
  async aaveWithdraw(
    wallet: EvmWalletProvider,
    args: z.infer<typeof AaveWithdrawSchema>,
  ): Promise<string> {
    try {
      const network = await wallet.getNetwork();
      const chainId = Number((network as { chainId?: number | string }).chainId || 0);
      const market = resolveAavePool(chainId, args.poolAddress);
      if (!market) {
        return `Error: no Aave V3 pool configured for chain ${chainId}`;
      }

      const to = (args.to || (await wallet.getAddress())) as Hex;
      let atomicAmount: bigint;
      if (args.amount.trim().toLowerCase() === "max") {
        atomicAmount = maxUint256;
      } else {
        const amount = new Decimal(args.amount);
        if (amount.comparedTo(new Decimal(0)) <= 0) {
          return "Error: amount must be greater than 0";
        }
        const decimals = await wallet.readContract({
          address: args.asset as Hex,
          abi: erc20Abi,
          functionName: "decimals",
        });
        atomicAmount = parseUnits(args.amount, Number(decimals));
      }

      const data = encodeFunctionData({
        abi: POOL_ABI,
        functionName: "withdraw",
        args: [args.asset as Hex, atomicAmount, to],
      });

      const txHash = await wallet.sendTransaction({ to: market.pool, data });
      await wallet.waitForTransactionReceipt(txHash);

      return `Withdrew from Aave pool ${market.pool}. Transaction hash: ${txHash}`;
    } catch (error) {
      return `Error withdrawing from Aave: ${error}`;
    }
  }

  /**
   * Checks if the Aave action provider supports the given network.
   *
   * @param network - The network to check.
   * @returns True when the network is EVM and has an Aave V3 mainnet pool in the address book.
   */
  supportsNetwork = (network: Network): boolean => {
    if (network.protocolFamily !== "evm") return false;
    const chainId = Number(network.chainId || 0);
    if (Number.isFinite(chainId) && chainId > 0) {
      return listAaveV3MainnetPools().some(row => row.chainId === chainId);
    }
    // Without chainId, allow EVM and resolve the pool at invocation time.
    return true;
  };
}

export const aaveActionProvider = () => new AaveActionProvider();
