import { encodeFunctionData, maxUint256, parseAbi, parseUnits } from "viem";
import { EvmWalletProvider } from "../../wallet-providers";
import { approve } from "../../utils";
import { AaveActionProvider } from "./aaveActionProvider";
import { listAaveV3MainnetPools } from "./constants";

const MOCK_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MOCK_RECEIVER = "0x9876543210987654321098765432109876543210";
const MOCK_TX_HASH = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
const MOCK_RECEIPT = { status: 1, blockNumber: 1234567 };
const MOCK_DECIMALS = 6;
const MOCK_AMOUNT = "1.5";

const POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

jest.mock("../../utils");
const mockApprove = approve as jest.MockedFunction<typeof approve>;

describe("Aave Action Provider", () => {
  const actionProvider = new AaveActionProvider();
  let mockWallet: jest.Mocked<EvmWalletProvider>;
  const basePool = listAaveV3MainnetPools().find(row => row.instanceKey === "base")?.pool;

  beforeEach(() => {
    expect(basePool).toBeDefined();
    mockWallet = {
      getAddress: jest.fn().mockResolvedValue(MOCK_RECEIVER),
      getNetwork: jest.fn().mockResolvedValue({ protocolFamily: "evm", chainId: 8453 }),
      sendTransaction: jest.fn().mockResolvedValue(MOCK_TX_HASH as `0x${string}`),
      waitForTransactionReceipt: jest.fn().mockResolvedValue(MOCK_RECEIPT),
      readContract: jest.fn().mockResolvedValue(MOCK_DECIMALS),
    } as unknown as jest.Mocked<EvmWalletProvider>;

    mockApprove.mockResolvedValue("Approval successful");
  });

  describe("aaveSupply", () => {
    it("approves and supplies to the Base Aave V3 pool", async () => {
      const atomicAmount = parseUnits(MOCK_AMOUNT, MOCK_DECIMALS);
      const response = await actionProvider.aaveSupply(mockWallet, {
        asset: MOCK_ASSET,
        amount: MOCK_AMOUNT,
        poolAddress: basePool!,
        referralCode: 0,
      });

      expect(mockApprove).toHaveBeenCalledWith(mockWallet, MOCK_ASSET, basePool, atomicAmount);
      expect(mockWallet.sendTransaction).toHaveBeenCalledWith({
        to: basePool,
        data: encodeFunctionData({
          abi: POOL_ABI,
          functionName: "supply",
          args: [MOCK_ASSET as `0x${string}`, atomicAmount, MOCK_RECEIVER as `0x${string}`, 0],
        }),
      });
      expect(mockWallet.waitForTransactionReceipt).toHaveBeenCalledWith(MOCK_TX_HASH);
      expect(response).toContain(`Supplied ${MOCK_AMOUNT}`);
      expect(response).toContain(MOCK_TX_HASH);
    });

    it("rejects non-positive amounts", async () => {
      const response = await actionProvider.aaveSupply(mockWallet, {
        asset: MOCK_ASSET,
        amount: "0",
        poolAddress: basePool!,
      });
      expect(response).toContain("amount must be greater than 0");
    });

    it("returns an error when no pool matches the chain", async () => {
      (mockWallet.getNetwork as jest.Mock).mockResolvedValue({
        protocolFamily: "evm",
        chainId: 999999,
      });
      const response = await actionProvider.aaveSupply(mockWallet, {
        asset: MOCK_ASSET,
        amount: MOCK_AMOUNT,
      });
      expect(response).toContain("no Aave V3 pool configured");
    });
  });

  describe("aaveWithdraw", () => {
    it("withdraws a fixed amount", async () => {
      const atomicAmount = parseUnits(MOCK_AMOUNT, MOCK_DECIMALS);
      const response = await actionProvider.aaveWithdraw(mockWallet, {
        asset: MOCK_ASSET,
        amount: MOCK_AMOUNT,
        poolAddress: basePool!,
      });

      expect(mockWallet.sendTransaction).toHaveBeenCalledWith({
        to: basePool,
        data: encodeFunctionData({
          abi: POOL_ABI,
          functionName: "withdraw",
          args: [MOCK_ASSET as `0x${string}`, atomicAmount, MOCK_RECEIVER as `0x${string}`],
        }),
      });
      expect(response).toContain("Withdrew from Aave pool");
      expect(response).toContain(MOCK_TX_HASH);
    });

    it("uses maxUint256 for amount=max", async () => {
      await actionProvider.aaveWithdraw(mockWallet, {
        asset: MOCK_ASSET,
        amount: "max",
        poolAddress: basePool!,
      });

      expect(mockWallet.sendTransaction).toHaveBeenCalledWith({
        to: basePool,
        data: encodeFunctionData({
          abi: POOL_ABI,
          functionName: "withdraw",
          args: [MOCK_ASSET as `0x${string}`, maxUint256, MOCK_RECEIVER as `0x${string}`],
        }),
      });
    });
  });

  describe("supportsNetwork", () => {
    it("returns true for Base mainnet chainId", () => {
      expect(
        actionProvider.supportsNetwork({
          protocolFamily: "evm",
          chainId: "8453",
        }),
      ).toBe(true);
    });

    it("returns false for unsupported EVM chainId", () => {
      expect(
        actionProvider.supportsNetwork({
          protocolFamily: "evm",
          chainId: "999999",
        }),
      ).toBe(false);
    });

    it("returns false for non-EVM networks", () => {
      expect(
        actionProvider.supportsNetwork({
          protocolFamily: "bitcoin",
          networkId: "base-mainnet",
        }),
      ).toBe(false);
    });
  });

  describe("address-book constants", () => {
    it("loads multiple mainnet Aave V3 pools including Base", () => {
      const pools = listAaveV3MainnetPools();
      expect(pools.length).toBeGreaterThan(5);
      expect(pools.some(row => row.instanceKey === "base" && row.chainId === 8453)).toBe(true);
      expect(pools.every(row => !/sepolia|testnet|fuji|amoy/i.test(row.exportName))).toBe(true);
    });
  });
});
