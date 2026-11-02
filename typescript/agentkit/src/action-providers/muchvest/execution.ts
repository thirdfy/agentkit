import { Transaction } from "ethers";
import { Address, Hex, PublicClient, keccak256, toHex, decodeFunctionResult, erc20Abi } from "viem";
import { EvmWalletProvider } from "../../wallet-providers/evmWalletProvider";
import { MUCHVEST_CHAIN_ID } from "./constants";
const ORACLE = "0x5300000000000000000000000000000000000002";
const ORACLE_ABI = [
  {
    type: "function",
    name: "getL1Fee",
    stateMutability: "view",
    inputs: [{ type: "bytes", name: "data" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const TOTAL_CAP = 50_000_000_000_000_000n,
  EXECUTION_CAP = 5_000_000_000_000_000n;
export type MuchvestIntent = {
  id: string;
  requestId: string;
  chainId: number;
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
  nonce: number;
  gas: bigint;
  gasPrice: bigint;
  maximumExecutionFeeWei: bigint;
  estimatedL1FeeWei: bigint;
  maximumTotalFeeWei: bigint;
};
/** Host-owned durable authorization/budget/nonce ledger, never an LLM action input. */
export interface MuchvestExecutionPolicy {
  /**
   * Atomically authorize full intent, reserve total budget and exclusively lease account+nonce.
   * Persist envelope before returning true. Existing IDs/unresolved accounts return false.
   * Must survive crashes/concurrency; an in-memory implementation is not production-safe.
   */
  reserve(intent: MuchvestIntent): Promise<boolean>;
  /** Persist hash before returning; failure retains the unresolved reservation. */
  submitted(id: string, hash: Hex): Promise<void>;
  /**
   * Persist canonical outcome and actual fees. Release account slot only when retainLock is false.
   * Keep permanent request-ID history/budget, including reverted transactions.
   */
  complete(
    id: string,
    outcome: {
      hash: Hex;
      status: "confirmed" | "reverted";
      actualTotalFeeWei: bigint;
      retainLock: boolean;
    },
  ): Promise<void>;
}
export type MuchvestCall = { to: Address; data: Hex; purpose: string };
/**
 * Execute once through the caller wallet. Unknown dispatches are never retried.
 *
 * @param wallet - Caller-controlled signer bound to the exact chain/account.
 * @param client - Validated read RPC.
 * @param account - Expected sender.
 * @param transaction - Internally prepared ABI call.
 * @param requestId - Host-issued durable authorization identifier.
 * @param policy - Durable host authorization, budget and recovery implementation.
 * @returns Confirmed status or an unresolved hash/intent requiring reconciliation.
 */
export async function executeMuchvest(
  wallet: EvmWalletProvider,
  client: PublicClient,
  account: Address,
  transaction: MuchvestCall,
  requestId: string,
  policy?: MuchvestExecutionPolicy,
) {
  if (!policy)
    throw new Error(
      "Writes require a host durable execution policy; read/prepare remain available",
    );
  const assertWallet = async () => {
    if (
      (await client.getChainId()) !== MUCHVEST_CHAIN_ID ||
      wallet.getNetwork().chainId !== String(MUCHVEST_CHAIN_ID) ||
      wallet.getAddress().toLowerCase() !== account.toLowerCase()
    )
      throw new Error("Wallet account or chain changed; prepare the action again");
  };
  await assertWallet();
  const nonce = await client.getTransactionCount({ address: account, blockTag: "pending" });
  if (nonce !== (await client.getTransactionCount({ address: account, blockTag: "latest" })))
    throw new Error("Account has an unresolved pending nonce");
  const gasPrice = (await client.getGasPrice()) * 2n;
  const gas =
    ((await client.estimateGas({
      account,
      to: transaction.to,
      data: transaction.data,
      value: 0n,
    })) *
      120n +
      99n) /
    100n;
  const execution = gas * gasPrice;
  if (gas <= 0n || gas > 3_000_000n || gasPrice <= 0n || execution > EXECUTION_CAP)
    throw new Error("Execution fee or gas exceeds Much Vest policy");
  const envelope = Transaction.from({
    type: 0,
    chainId: MUCHVEST_CHAIN_ID,
    nonce,
    to: transaction.to,
    data: transaction.data,
    value: 0n,
    gasLimit: gas,
    gasPrice,
  });
  envelope.signature = { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, yParity: 1 };
  const l1 = await client.readContract({
    address: ORACLE,
    abi: ORACLE_ABI,
    functionName: "getL1Fee",
    args: [envelope.serialized as Hex],
  });
  const maximumTotal = execution + (l1 * 125n + 99n) / 100n + 1_000_000_000_000_000n;
  if (maximumTotal > TOTAL_CAP || (await client.getBalance({ address: account })) < maximumTotal)
    throw new Error("Execution plus data/finality fee exceeds policy or balance");
  const id = keccak256(
    toHex(
      JSON.stringify([
        requestId,
        account.toLowerCase(),
        transaction.to.toLowerCase(),
        transaction.data.toLowerCase(),
      ]),
    ),
  );
  const intent: MuchvestIntent = {
    id,
    requestId,
    chainId: MUCHVEST_CHAIN_ID,
    account,
    to: transaction.to,
    data: transaction.data,
    value: 0n,
    nonce,
    gas,
    gasPrice,
    maximumExecutionFeeWei: execution,
    estimatedL1FeeWei: l1,
    maximumTotalFeeWei: maximumTotal,
  };
  const request = {
    type: "legacy" as const,
    chainId: MUCHVEST_CHAIN_ID,
    from: account,
    to: transaction.to,
    data: transaction.data,
    value: 0n,
    nonce,
    gas,
    gasPrice,
  };
  const simulation = await client.call({
    account,
    to: request.to,
    data: request.data,
    value: 0n,
    gas,
    gasPrice,
  });
  if (
    transaction.data.startsWith("0x095ea7b3") &&
    simulation.data &&
    simulation.data !== "0x" &&
    !decodeFunctionResult({ abi: erc20Abi, functionName: "approve", data: simulation.data })
  )
    throw new Error("ERC20 approval simulation returned false");
  if (!(await policy.reserve(intent)))
    throw new Error(
      "Request/account already reserved; reconcile the durable host record without resending",
    );
  let txHash: Hex | undefined;
  try {
    await assertWallet();
    if ((await client.getTransactionCount({ address: account, blockTag: "pending" })) !== nonce)
      throw new Error("Nonce changed after reservation");
    const currentL1 = await client.readContract({
      address: ORACLE,
      abi: ORACLE_ABI,
      functionName: "getL1Fee",
      args: [envelope.serialized as Hex],
    });
    if (
      execution + (currentL1 * 125n + 99n) / 100n + 1_000_000_000_000_000n > maximumTotal ||
      (await client.getBalance({ address: account })) < maximumTotal
    )
      throw new Error("Data fee/balance changed after reservation");
    await assertWallet();
    txHash = await wallet.sendTransaction(request);
    await policy.submitted(id, txHash);
  } catch {
    return {
      status: "submission_uncertain",
      requestId,
      intentId: id,
      txHash,
      retryAutomatically: false,
      instruction:
        "Reconcile the reserved account/nonce and exact envelope. Do not dispatch again or clear the durable reservation.",
    };
  }
  try {
    const receipt = await wallet.waitForTransactionReceipt(txHash);
    const confirmedHash = receipt.transactionHash ?? txHash;
    if (confirmedHash.toLowerCase() !== txHash.toLowerCase())
      return {
        status: "replaced",
        txHash,
        replacementHash: confirmedHash,
        intentId: id,
        retryAutomatically: false,
      };
    const mined = await client.getTransaction({ hash: txHash });
    if (
      mined.type !== "legacy" ||
      mined.from.toLowerCase() !== account.toLowerCase() ||
      mined.to?.toLowerCase() !== transaction.to.toLowerCase() ||
      mined.input.toLowerCase() !== transaction.data.toLowerCase() ||
      mined.value !== 0n ||
      mined.nonce !== nonce ||
      mined.chainId !== MUCHVEST_CHAIN_ID ||
      mined.gas !== gas ||
      mined.gasPrice !== gasPrice
    )
      throw new Error("Mined envelope differs from durable intent");
    const raw = (await client.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    })) as unknown as {
      transactionHash: Hex;
      blockHash: Hex;
      blockNumber: Hex;
      status: Hex;
      gasUsed: Hex;
      effectiveGasPrice: Hex;
      l1Fee?: Hex;
    };
    if (
      !raw ||
      raw.transactionHash.toLowerCase() !== txHash.toLowerCase() ||
      !raw.l1Fee ||
      raw.blockHash !== receipt.blockHash ||
      BigInt(raw.blockNumber) !== BigInt(receipt.blockNumber) ||
      BigInt(raw.gasUsed) !== BigInt(receipt.gasUsed) ||
      BigInt(raw.effectiveGasPrice) !== BigInt(receipt.effectiveGasPrice)
    )
      throw new Error("Incomplete receipt fee accounting");
    if (
      ![raw.blockNumber, raw.status, raw.gasUsed, raw.effectiveGasPrice, raw.l1Fee].every(value =>
        /^0x[0-9a-f]+$/i.test(value || ""),
      ) ||
      BigInt(raw.gasUsed) <= 0n ||
      BigInt(raw.gasUsed) > gas ||
      BigInt(raw.effectiveGasPrice) !== gasPrice
    )
      throw new Error("Invalid receipt execution fields");
    const status =
      BigInt(raw.status) === 1n ? "confirmed" : BigInt(raw.status) === 0n ? "reverted" : null;
    if (!status || (status === "confirmed") !== ["success", 1, 1n].includes(receipt.status))
      throw new Error("Receipt status mismatch");
    const blockNumber = BigInt(raw.blockNumber),
      block = await client.getBlock({ blockNumber });
    if (block.hash !== raw.blockHash || (await client.getBlockNumber()) < blockNumber + 1n)
      throw new Error("Receipt not canonical with two confirmations");
    const actualTotal = BigInt(raw.gasUsed) * BigInt(raw.effectiveGasPrice) + BigInt(raw.l1Fee);
    const retainLock = actualTotal > maximumTotal || actualTotal > TOTAL_CAP;
    await policy.complete(id, { hash: txHash, status, actualTotalFeeWei: actualTotal, retainLock });
    if (retainLock)
      return {
        status: "fee_overrun_halted",
        receiptStatus: status,
        txHash,
        intentId: id,
        actualTotalFeeWei: actualTotal.toString(),
        retryAutomatically: false,
        instruction:
          "Canonical outcome and actual fees recorded. Host must retain account lock and reconcile budget overrun.",
      };
    return {
      status,
      txHash,
      originalTxHash: txHash,
      intentId: id,
      maximumTotalFeeWei: maximumTotal.toString(),
      actualTotalFeeWei: actualTotal.toString(),
      retryAutomatically: false,
    };
  } catch {
    return {
      status: "submitted",
      txHash,
      intentId: id,
      retryAutomatically: false,
      instruction:
        "Receipt/envelope/fee confirmation incomplete. Keep the durable reservation and reconcile this hash before further account transactions.",
    };
  }
}
