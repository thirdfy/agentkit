import { z } from "zod";

export const AaveSupplySchema = z.object({
  asset: z.string().describe("Underlying ERC-20 address to supply"),
  amount: z.string().describe("Amount in whole token units"),
  poolAddress: z
    .string()
    .optional()
    .describe(
      "Aave V3 Pool address for this market instance. Required when the chain has multiple Aave instances (e.g. Ethereum Core vs Lido).",
    ),
  onBehalfOf: z.string().optional().describe("Recipient of aTokens; defaults to wallet address"),
  referralCode: z.number().int().min(0).max(65535).optional().describe("Referral code; use 0"),
});

export const AaveWithdrawSchema = z.object({
  asset: z.string().describe("Underlying ERC-20 address to withdraw"),
  amount: z.string().describe("Amount in whole token units, or 'max' for full withdraw"),
  poolAddress: z
    .string()
    .optional()
    .describe(
      "Aave V3 Pool address for this market instance. Required when the chain has multiple Aave instances.",
    ),
  to: z.string().optional().describe("Recipient of underlying; defaults to wallet address"),
});
