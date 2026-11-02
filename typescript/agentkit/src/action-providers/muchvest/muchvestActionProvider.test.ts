import { decodeFunctionData, erc20Abi, getAddress, maxUint256 } from "viem";
import { EvmWalletProvider } from "../../wallet-providers/evmWalletProvider";
import { MuchvestActionProvider } from "./muchvestActionProvider";
import {
  FACTORY_ABI,
  MUCHVEST_CHAIN_ID,
  MUCHVEST_FACTORY,
  NATIVE_DOGE,
  VESTING_ABI,
} from "./constants";
import { MuchvestExecutionPolicy } from "./execution";
import { ConfirmCreateSchema, ListPlansSchema } from "./schemas";

jest.mock("../../wallet-providers", () =>
  jest.requireActual("../../wallet-providers/walletProvider"),
);

jest.mock("../../analytics", () => ({
  sendAnalyticsEvent: jest.fn().mockResolvedValue(undefined),
}));

const CALLER = "0x1111111111111111111111111111111111111111";
const BENEFICIARY = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const PLAN = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"ab".repeat(32)}`;
const INPUT = {
  token: TOKEN,
  beneficiary: BENEFICIARY,
  amount: "100.25",
  start: 1100,
  duration: 1000,
  cliffDuration: 100,
};

describe("Much Vest provider", () => {
  let provider: MuchvestActionProvider;
  let wallet: jest.Mocked<EvmWalletProvider>;
  let client: {
    getChainId: jest.Mock;
    getBlock: jest.Mock;
    getCode: jest.Mock;
    readContract: jest.Mock;
    simulateContract: jest.Mock;
    call: jest.Mock;
    getTransaction: jest.Mock;
    getTransactionCount: jest.Mock;
    getGasPrice: jest.Mock;
    estimateGas: jest.Mock;
    getBalance: jest.Mock;
    request: jest.Mock;
    getBlockNumber: jest.Mock;
  };
  let allowance: bigint;
  let decimals: number;
  let registered: boolean;
  let claimable: bigint;
  let balance: bigint;
  let lastTransaction: Record<string, unknown>;
  let policy: jest.Mocked<MuchvestExecutionPolicy>;

  beforeEach(() => {
    policy = {
      reserve: jest.fn().mockResolvedValue(true),
      submitted: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    provider = new MuchvestActionProvider(policy);
    allowance = 0n;
    decimals = 6;
    registered = true;
    claimable = 500n;
    balance = 10n ** 30n;
    client = {
      getChainId: jest.fn().mockResolvedValue(MUCHVEST_CHAIN_ID),
      getBlock: jest.fn().mockResolvedValue({ number: 123n, timestamp: 1000n, hash: HASH }),
      getCode: jest.fn().mockResolvedValue("0x6000"),
      simulateContract: jest.fn().mockResolvedValue({ result: PLAN }),
      call: jest.fn().mockResolvedValue({ data: "0x" }),
      getTransaction: jest
        .fn()
        .mockImplementation(async () => ({ ...lastTransaction, input: lastTransaction.data })),
      getTransactionCount: jest.fn().mockResolvedValue(0),
      getGasPrice: jest.fn().mockResolvedValue(5n),
      estimateGas: jest.fn().mockResolvedValue(100000n),
      getBalance: jest.fn().mockResolvedValue(10n ** 18n),
      getBlockNumber: jest.fn().mockResolvedValue(125n),
      request: jest.fn().mockResolvedValue({
        transactionHash: HASH,
        blockHash: HASH,
        blockNumber: "0x7b",
        status: "0x1",
        gasUsed: "0x186a0",
        effectiveGasPrice: "0xa",
        l1Fee: "0x38d7ea4c68000",
      }),
      readContract: jest.fn().mockImplementation(({ functionName }) => {
        const values: Record<string, unknown> = {
          getL1Fee: 1000000000000000n,
          decimals,
          allowance,
          balanceOf: balance,
          isVesting: registered,
          token: TOKEN,
          beneficiary: BENEFICIARY,
          creator: CALLER,
          totalAllocation: 100250000n,
          start: 100n,
          duration: 1000n,
          cliff: 200n,
          end: 1100n,
          released: 0n,
          claimable,
          beneficiaryVestingCount: 75n,
          creatorVestingCount: 75n,
          beneficiaryVestingAt: PLAN,
          creatorVestingAt: PLAN,
        };
        if (!(functionName in values)) throw new Error(`Unexpected read ${functionName}`);
        return Promise.resolve(values[functionName]);
      }),
    };
    wallet = {
      getName: jest.fn().mockReturnValue("mock"),
      getAddress: jest.fn().mockReturnValue(CALLER),
      getNetwork: jest.fn().mockReturnValue({
        protocolFamily: "evm",
        chainId: String(MUCHVEST_CHAIN_ID),
        networkId: "dogeos-testnet",
      }),
      getPublicClient: jest.fn().mockReturnValue(client),
      sendTransaction: jest.fn().mockImplementation(async transaction => {
        lastTransaction = transaction;
        if (transaction.to === TOKEN) {
          const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
          if (decoded.functionName === "approve") allowance = decoded.args[1];
        }
        return HASH;
      }),
      waitForTransactionReceipt: jest.fn().mockResolvedValue({
        status: "success",
        transactionHash: HASH,
        blockHash: HASH,
        blockNumber: 123n,
        gasUsed: 100000n,
        effectiveGasPrice: 10n,
      }),
    } as unknown as jest.Mocked<EvmWalletProvider>;
  });

  it("discovers all seven native actions with wallet injection metadata", () => {
    const actions = provider.getActions(wallet);
    expect(actions).toHaveLength(7);
    expect(actions.map(action => action.name)).toContain(
      "MuchvestActionProvider_muchvest_create_vesting",
    );
  });

  it("rejects mainnet and wrong RPC chain before reading or sending", async () => {
    expect(provider.supportsNetwork({ protocolFamily: "evm", chainId: "1" })).toBe(false);
    client.getChainId.mockResolvedValue(1);
    await expect(provider.prepareCreate(wallet, INPUT)).rejects.toThrow("RPC chain");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when factory code is missing", async () => {
    client.getCode.mockResolvedValue("0x");
    await expect(provider.getPlan(wallet, { wallet: PLAN })).rejects.toThrow("not deployed");
  });

  it("bounds pagination and pins registry reads to one block", async () => {
    expect(ListPlansSchema.safeParse({ limit: 51 }).success).toBe(false);
    const result = JSON.parse(await provider.listPlans(wallet, { offset: 70, limit: 10 }));
    expect(result.wallets).toHaveLength(5);
    expect(result.total).toBe("75");
    expect(result.nextOffset).toBeNull();
    for (const [params] of client.readContract.mock.calls) expect(params.blockNumber).toBe(123n);
  });

  it("uses onchain decimals and exact raw integers without signing or rounding", async () => {
    const result = JSON.parse(await provider.prepareCreate(wallet, INPUT));
    expect(result.amountRaw).toBe("100250000");
    expect(result.transactions).toHaveLength(2);
    const approval = decodeFunctionData({ abi: erc20Abi, data: result.transactions[0].data });
    expect(approval.args).toEqual([getAddress(MUCHVEST_FACTORY), 100250000n]);
    const create = decodeFunctionData({ abi: FACTORY_ABI, data: result.transactions[1].data });
    expect(create.args).toEqual([TOKEN, BENEFICIARY, 100250000n, 1100n, 1000n, 100n]);
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(["1.0000001", "1e6", "-1", "0", "NaN"])("rejects unsafe amount %s", async amount => {
    await expect(provider.prepareCreate(wallet, { ...INPUT, amount })).rejects.toThrow();
  });

  it("supports zero-decimal tokens and rejects overflowing amounts", async () => {
    decimals = 0;
    expect(
      JSON.parse(await provider.prepareCreate(wallet, { ...INPUT, amount: "123" })).amountRaw,
    ).toBe("123");
    await expect(
      provider.prepareCreate(wallet, { ...INPUT, amount: (maxUint256 + 1n).toString() }),
    ).rejects.toThrow("uint256");
  });

  it("rejects native DOGE, insufficient balances and invalid schedule", async () => {
    await expect(provider.prepareCreate(wallet, { ...INPUT, token: NATIVE_DOGE })).rejects.toThrow(
      "Native DOGE",
    );
    await expect(provider.prepareCreate(wallet, { ...INPUT, start: 999 })).rejects.toThrow(
      "Invalid future",
    );
    await expect(provider.prepareCreate(wallet, { ...INPUT, cliffDuration: 1001 })).rejects.toThrow(
      "Invalid future",
    );
    balance = 1n;
    await expect(provider.prepareCreate(wallet, INPUT)).rejects.toThrow("balance");
  });

  it("resets an oversized allowance then approves exactly, without creating a grant", async () => {
    allowance = maxUint256;
    const result = JSON.parse(
      await provider.approveFunding(wallet, {
        ...INPUT,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("approved");
    expect(result.grantCreated).toBe(false);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(2);
    expect(
      wallet.sendTransaction.mock.calls.every(([transaction]) => transaction.to === TOKEN),
    ).toBe(true);
    expect(allowance).toBe(100250000n);
  });

  it("rejects a false-returning approval before spending gas", async () => {
    client.call.mockResolvedValue({ data: `0x${"00".repeat(32)}` });
    await expect(
      provider.approveFunding(wallet, {
        ...INPUT,
        confirm: true,
        requestId: "test-request-000001",
      }),
    ).rejects.toThrow("approval simulation returned false");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation and exact allowance for execution", async () => {
    expect(ConfirmCreateSchema.safeParse({ ...INPUT, confirm: false }).success).toBe(false);
    allowance = maxUint256;
    await expect(
      provider.createVesting(wallet, { ...INPUT, confirm: true, requestId: "test-request-000001" }),
    ).rejects.toThrow("Exact allowance");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("simulates then sends a single create with pinned caller and chain", async () => {
    allowance = 100250000n;
    const result = JSON.parse(
      await provider.createVesting(wallet, {
        ...INPUT,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("confirmed");
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MUCHVEST_FACTORY,
        account: CALLER,
        functionName: "createVesting",
      }),
    );
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: MUCHVEST_CHAIN_ID,
        from: CALLER,
        to: MUCHVEST_FACTORY,
        value: 0n,
      }),
    );
  });

  it("does not send when a simulation reverts", async () => {
    allowance = 100250000n;
    client.simulateContract.mockRejectedValue(new Error("FundingAmountMismatch"));
    await expect(
      provider.createVesting(wallet, { ...INPUT, confirm: true, requestId: "test-request-000001" }),
    ).rejects.toThrow("FundingAmountMismatch");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("does not sign if the account changes across async preparation", async () => {
    allowance = 100250000n;
    client.simulateContract.mockImplementation(async () => {
      wallet.getAddress.mockReturnValue(BENEFICIARY);
      return {};
    });
    await expect(
      provider.createVesting(wallet, { ...INPUT, confirm: true, requestId: "test-request-000001" }),
    ).rejects.toThrow("account or chain changed");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("does not sign if the chain changes across async preparation", async () => {
    allowance = 100250000n;
    client.simulateContract.mockImplementation(async () => {
      client.getChainId.mockResolvedValue(1);
      return {};
    });
    await expect(
      provider.createVesting(wallet, { ...INPUT, confirm: true, requestId: "test-request-000001" }),
    ).rejects.toThrow("account or chain changed");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("stops on an unknown approval receipt and preserves its hash", async () => {
    allowance = maxUint256;
    wallet.waitForTransactionReceipt.mockRejectedValue(new Error("timeout"));
    const result = JSON.parse(
      await provider.approveFunding(wallet, {
        ...INPUT,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("submitted");
    expect(result.receipts[0].txHash).toBe(HASH);
    expect(result.receipts[0].retryAutomatically).toBe(false);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a cancellation receipt for the requested call", async () => {
    allowance = 100250000n;
    const replacementHash = `0x${"cd".repeat(32)}`;
    wallet.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: replacementHash,
    });
    client.getTransaction.mockResolvedValue({ from: CALLER, to: CALLER, input: "0x", value: 0n });
    const result = JSON.parse(
      await provider.createVesting(wallet, {
        ...INPUT,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("replaced");
    expect(result.replacementHash).toBe(replacementHash);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not report a reverted receipt as success", async () => {
    allowance = 100250000n;
    wallet.waitForTransactionReceipt.mockResolvedValue({
      status: "reverted",
      transactionHash: HASH,
      blockHash: HASH,
      blockNumber: 123n,
      gasUsed: 100000n,
      effectiveGasPrice: 10n,
    });
    client.request.mockResolvedValue({
      transactionHash: HASH,
      blockHash: HASH,
      blockNumber: "0x7b",
      status: "0x0",
      gasUsed: "0x186a0",
      effectiveGasPrice: "0xa",
      l1Fee: "0x38d7ea4c68000",
    });
    const result = JSON.parse(
      await provider.createVesting(wallet, {
        ...INPUT,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("reverted");
  });

  it("rejects unrelated contracts and zero-claim plans", async () => {
    registered = false;
    await expect(provider.prepareClaim(wallet, { wallet: PLAN })).rejects.toThrow("not registered");
    registered = true;
    claimable = 0n;
    await expect(
      provider.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    ).rejects.toThrow("No tokens");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("claim always goes to immutable beneficiary, even when another account pays gas", async () => {
    const result = JSON.parse(
      await provider.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.beneficiary).toBe(BENEFICIARY);
    const transaction = wallet.sendTransaction.mock.calls[0][0];
    expect(transaction.to).toBe(PLAN);
    expect(decodeFunctionData({ abi: VESTING_ABI, data: transaction.data! }).functionName).toBe(
      "claim",
    );
    expect(transaction.from).toBe(CALLER);
  });
  it("keeps all seven actions but defaults writes to unavailable without host policy", async () => {
    const readOnly = new MuchvestActionProvider();
    expect(readOnly.getActions(wallet)).toHaveLength(7);
    await expect(
      readOnly.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    ).rejects.toThrow("durable execution policy");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects a reused or occupied durable reservation before dispatch", async () => {
    policy.reserve.mockResolvedValue(false);
    await expect(
      provider.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    ).rejects.toThrow("already reserved");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it("freezes nonce/gas/fee envelope and includes data fees in durable reservation", async () => {
    const result = JSON.parse(
      await provider.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("confirmed");
    const intent = policy.reserve.mock.calls[0][0];
    expect(intent.maximumTotalFeeWei).toBeGreaterThan(intent.maximumExecutionFeeWei);
    expect(wallet.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 0, gas: 120000n, gasPrice: 10n }),
    );
    expect(policy.complete).toHaveBeenCalledWith(
      intent.id,
      expect.objectContaining({ actualTotalFeeWei: 1000000001000000n }),
    );
  });
  it("preserves durable account ownership after accepted-but-timeout with no returned hash", async () => {
    let occupied = false;
    policy.reserve.mockImplementation(async () => {
      if (occupied) return false;
      occupied = true;
      return true;
    });
    wallet.sendTransaction.mockRejectedValue(new Error("accepted then disconnected"));
    const args = { wallet: PLAN, confirm: true as const, requestId: "test-request-000001" };
    expect(JSON.parse(await provider.claimVesting(wallet, args)).status).toBe(
      "submission_uncertain",
    );
    await expect(
      provider.claimVesting(wallet, { ...args, requestId: "another-request-0002" }),
    ).rejects.toThrow("already reserved");
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(policy.complete).not.toHaveBeenCalled();
  });
  it("does not release a reservation if persisting the returned hash fails", async () => {
    policy.submitted.mockRejectedValue(new Error("database unavailable"));
    expect(
      JSON.parse(
        await provider.claimVesting(wallet, {
          wallet: PLAN,
          confirm: true,
          requestId: "test-request-000001",
        }),
      ).status,
    ).toBe("submission_uncertain");
    expect(policy.complete).not.toHaveBeenCalled();
  });
  it("blocks excessive execution fees before reserving or sending", async () => {
    client.getGasPrice.mockResolvedValue(10n ** 12n);
    await expect(
      provider.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    ).rejects.toThrow("fee or gas");
    expect(policy.reserve).not.toHaveBeenCalled();
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it("retains lock when raw L1 receipt accounting is absent", async () => {
    client.request.mockResolvedValue({ transactionHash: HASH });
    expect(
      JSON.parse(
        await provider.claimVesting(wallet, {
          wallet: PLAN,
          confirm: true,
          requestId: "test-request-000001",
        }),
      ).status,
    ).toBe("submitted");
    expect(policy.complete).not.toHaveBeenCalled();
  });
  it("retains lock on a different mined fee/nonce/target envelope", async () => {
    client.getTransaction.mockImplementation(async () => ({
      ...lastTransaction,
      input: lastTransaction.data,
      nonce: 9,
    }));
    expect(
      JSON.parse(
        await provider.claimVesting(wallet, {
          wallet: PLAN,
          confirm: true,
          requestId: "test-request-000001",
        }),
      ).status,
    ).toBe("submitted");
    expect(policy.complete).not.toHaveBeenCalled();
  });
  it("durably records actual fee overruns while retaining the account lock", async () => {
    client.request.mockResolvedValue({
      transactionHash: HASH,
      blockHash: HASH,
      blockNumber: "0x7b",
      status: "0x1",
      gasUsed: "0x186a0",
      effectiveGasPrice: "0xa",
      l1Fee: "0x16345785d8a0000",
    });
    const result = JSON.parse(
      await provider.claimVesting(wallet, {
        wallet: PLAN,
        confirm: true,
        requestId: "test-request-000001",
      }),
    );
    expect(result.status).toBe("fee_overrun_halted");
    expect(policy.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actualTotalFeeWei: 100000000001000000n, retainLock: true }),
    );
  });
});
