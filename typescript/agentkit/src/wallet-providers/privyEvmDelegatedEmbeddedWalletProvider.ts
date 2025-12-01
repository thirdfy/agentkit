import { PrivyClient, WalletWithMetadata } from "@privy-io/server-auth";
import canonicalize from "canonicalize";
import crypto from "crypto";
import {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
  Hex,
  PublicClient,
  ReadContractParameters,
  ReadContractReturnType,
  TransactionReceipt,
  TransactionRequest,
  createPublicClient,
  http,
} from "viem";
import { Network } from "../network";
import { NETWORK_ID_TO_CHAIN_ID, getChain } from "../network/network";
import { PrivyWalletConfig, PrivyWalletExport, createPrivyClient } from "./privyShared";
import { WalletProvider } from "./walletProvider";

interface PrivyResponse<T> {
  data: T;
}

const DEFAULT_GASLESS_CHAINS = [8453, 84532];

const parseChainList = (value?: string | number[]): number[] => {
  if (!value) {
    return DEFAULT_GASLESS_CHAINS;
  }

  if (Array.isArray(value)) {
    return value
      .map((chain) => Number(chain))
      .filter((chain) => Number.isFinite(chain));
  }

  return value
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((chain) => Number.isFinite(chain));
};

/**
 * Configuration options for the Privy Embedded Wallet provider.
 */
export interface PrivyEvmDelegatedEmbeddedWalletConfig extends PrivyWalletConfig {
  /** The ID of the delegated wallet */
  walletId: string;

  /** The network ID to connect to (e.g., "base-mainnet") */
  networkId?: string;

  /** The chain ID to connect to */
  chainId?: string;

  /** The wallet type to use */
  walletType: "embedded";

  /** Optional RPC URL for Viem public client */
  rpcUrl?: string;

  /** Optional configuration for built-in gasless sponsorship */
  gasless?: PrivyGaslessConfig;
}

type GaslessContextType =
  | "swap"
  | "transfer"
  | "conversion"
  | "faucet"
  | "approval"
  | "contract_call"
  | "other";

interface PrivyGaslessConfig {
  enabled?: boolean;
  supportedChains?: number[];
  authorizationPrivateKey?: string;
  authorizationKeyId?: string;
  privyApiUrl?: string;
  defaultContext?: GaslessContextType;
}

/**
 * A wallet provider that uses Privy's embedded wallets with delegation.
 * This provider extends the EvmWalletProvider to provide Privy-specific wallet functionality
 * while maintaining compatibility with the base wallet provider interface.
 */
export class PrivyEvmDelegatedEmbeddedWalletProvider extends WalletProvider {
  #walletId: string;
  #embeddedWalletId?: string;
  #address: string;
  #appId: string;
  #appSecret: string;
  #authKey: string;
  #authKeyId?: string;
  #network: Network;
  #publicClient: PublicClient;
  #gaslessEnabled: boolean;
  #gaslessChains: Set<number>;
  #gaslessAuthKey?: string;
  #gaslessAuthKeyId?: string;
  #gaslessDefaultContext: GaslessContextType;
  #privyApiUrl: string;
  #walletApiClients: Map<string, PrivyClient>;

  /**
   * Private constructor to enforce use of factory method.
   *
   * @param config - The configuration options for the wallet provider
   */
  private constructor(
    config: PrivyEvmDelegatedEmbeddedWalletConfig & { address: string; walletInstanceId?: string },
  ) {
    super();

    this.#walletId = config.walletId;
    this.#embeddedWalletId = config.walletInstanceId;
    this.#address = config.address;
    this.#appId = config.appId;
    this.#appSecret = config.appSecret;
    this.#authKey = config.authorizationPrivateKey || "";
     this.#authKeyId = config.authorizationKeyId;

    const envGaslessEnabled = process.env.AGENTKIT_GASLESS_ENABLED === "true";
    const envChainList = process.env.AGENTKIT_GASLESS_CHAINS;
    const resolvedGaslessChains =
      config.gasless?.supportedChains ??
      (envChainList ? parseChainList(envChainList) : DEFAULT_GASLESS_CHAINS);

    this.#gaslessEnabled = config.gasless?.enabled ?? envGaslessEnabled;
    this.#gaslessChains = new Set(resolvedGaslessChains);
    this.#gaslessAuthKey = config.gasless?.authorizationPrivateKey ?? config.authorizationPrivateKey;
    this.#gaslessAuthKeyId = config.gasless?.authorizationKeyId ?? config.authorizationKeyId;
    this.#gaslessDefaultContext = config.gasless?.defaultContext ?? "contract_call";
    this.#privyApiUrl =
      config.gasless?.privyApiUrl ?? process.env.PRIVY_WALLET_API_URL ?? "https://api.privy.io";
    this.#walletApiClients = new Map();

    const networkId = config.networkId || "base-sepolia";
    const chainId = config.chainId || NETWORK_ID_TO_CHAIN_ID[networkId];

    this.#network = {
      protocolFamily: "evm",
      networkId: networkId,
      chainId: chainId,
    };

    // Create a public client for read operations
    const chain = getChain(chainId);
    if (!chain) {
      throw new Error(`Chain with ID ${chainId} not found`);
    }

    const rpcUrl = config.rpcUrl || process.env.RPC_URL;
    this.#publicClient = createPublicClient({
      chain,
      transport: rpcUrl ? http(rpcUrl) : http(),
    });
  }

  /**
   * Creates and configures a new PrivyEvmDelegatedEmbeddedWalletProvider instance.
   *
   * @param config - The configuration options for the Privy wallet
   * @returns A configured PrivyEvmDelegatedEmbeddedWalletProvider instance
   *
   * @example
   * ```typescript
   * const provider = await PrivyEvmDelegatedEmbeddedWalletProvider.configureWithWallet({
   *   appId: "your-app-id",
   *   appSecret: "your-app-secret",
   *   authorizationPrivateKey: "your-auth-key",
   *   walletId: "privy-wallet-id",
   *   networkId: "base-mainnet"
   * });
   * ```
   */
  public static async configureWithWallet(
    config: PrivyEvmDelegatedEmbeddedWalletConfig,
  ): Promise<PrivyEvmDelegatedEmbeddedWalletProvider> {
    try {
      if (!config.walletId) {
        throw new Error("walletId is required for PrivyEvmDelegatedEmbeddedWalletProvider");
      }

      if (!config.appId || !config.appSecret) {
        throw new Error(
          "appId and appSecret are required for PrivyEvmDelegatedEmbeddedWalletProvider",
        );
      }

      if (!config.authorizationPrivateKey) {
        throw new Error(
          "authorizationPrivateKey is required for PrivyEvmDelegatedEmbeddedWalletProvider",
        );
      }

      const privyClient = createPrivyClient(config);
      const user = await privyClient.getUser(config.walletId);

      const embeddedWallets = user.linkedAccounts.filter(
        (account): account is WalletWithMetadata =>
          account.type === "wallet" && account.walletClientType === "privy",
      );

      if (embeddedWallets.length === 0) {
        throw new Error(`Could not find wallet address for wallet ID ${config.walletId}`);
      }

      const walletRecord = embeddedWallets[0];
      const walletAddress = walletRecord.address;
      const walletInstanceId = (walletRecord as WalletWithMetadata & { id?: string }).id;

      // Verify the network/chain ID if provided
      if (config.chainId) {
        const chain = getChain(config.chainId);
        if (!chain) {
          throw new Error(`Chain with ID ${config.chainId} not found`);
        }
      }

      return new PrivyEvmDelegatedEmbeddedWalletProvider({
        ...config,
        address: walletAddress as string,
        walletInstanceId,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to configure Privy embedded wallet provider: ${error.message}`);
      }
      throw new Error("Failed to configure Privy embedded wallet provider");
    }
  }

  /**
   * Gets the address of the wallet.
   *
   * @returns The address of the wallet.
   */
  getAddress(): string {
    return this.#address;
  }

  /**
   * Gets the network of the wallet.
   *
   * @returns The network of the wallet.
   */
  getNetwork(): Network {
    return this.#network;
  }

  /**
   * Gets the name of the wallet provider.
   *
   * @returns The name of the wallet provider.
   */
  getName(): string {
    return "privy_evm_embedded_wallet_provider";
  }

  /**
   * Gets the Viem PublicClient used for read-only operations.
   *
   * @returns The Viem PublicClient instance used for read-only operations.
   */
  getPublicClient(): PublicClient {
    return this.#publicClient;
  }

  /**
   * Gets the balance of the wallet.
   *
   * @returns The balance of the wallet in wei
   */
  async getBalance(): Promise<bigint> {
    try {
      const balance = await this.#publicClient.getBalance({
        address: this.#address as Address,
      });

      return balance;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Error getting balance: ${error.message}`);
      }
      throw new Error("Error getting balance");
    }
  }

  /**
   * Signs a raw hash.
   *
   * @param hash - The hash to sign.
   * @returns The signed hash.
   */
  async sign(hash: `0x${string}`): Promise<Hex> {
    const body = {
      address: this.#address,
      chain_type: "ethereum",
      method: "personal_sign",
      params: {
        message: hash,
        encoding: "hex",
      },
    };

    try {
      const response = await this.executePrivyRequest<PrivyResponse<{ signature: Hex }>>(body);
      return response.data?.signature;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Hash signing failed: ${error.message}`);
      }
      throw new Error("Hash signing failed");
    }
  }

  /**
   * Signs a message.
   *
   * @param message - The message to sign.
   * @returns The signed message.
   */
  async signMessage(message: string): Promise<Hex> {
    const body = {
      address: this.#address,
      chain_type: "ethereum",
      method: "personal_sign",
      params: {
        message,
        encoding: "utf-8",
      },
    };

    try {
      const response = await this.executePrivyRequest<PrivyResponse<{ signature: Hex }>>(body);
      return response.data?.signature;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Message signing failed: ${error.message}`);
      }
      throw new Error("Message signing failed");
    }
  }

  /**
   * Signs typed data according to EIP-712.
   *
   * @param typedData - The typed data object to sign
   * @param typedData.domain - The domain object containing contract and chain information
   * @param typedData.types - The type definitions for the structured data
   * @param typedData.primaryType - The primary type being signed
   * @param typedData.message - The actual data to sign
   * @returns A Address that resolves to the signed typed data as a hex string
   */
  async signTypedData(typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex> {
    const body = {
      address: this.#address,
      chain_type: "ethereum",
      chain_id: this.#network.chainId,
      ...typedData,
    };

    try {
      const response = await this.executePrivyRequest<{ signature: Hex }>({
        method: "eth_signTypedData_v4",
        params: body,
      });
      return response.signature;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error("Typed data signing failed: " + error.message);
      }
      throw new Error("Typed data signing failed with unknown error");
    }
  }

  /**
   * Signs a transaction.
   *
   * @param transaction - The transaction to sign.
   * @returns The signed transaction.
   */
  async signTransaction(transaction: TransactionRequest): Promise<Hex> {
    const body = {
      address: this.#address,
      chain_type: "ethereum",
      method: "eth_signTransaction",
      params: {
        transaction: {
          ...transaction,
          from: this.#address,
        },
      },
    };

    try {
      const response =
        await this.executePrivyRequest<PrivyResponse<{ signed_transaction: Hex }>>(body);
      return response.data?.signed_transaction;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Transaction signing failed: ${error.message}`);
      }
      throw new Error("Transaction signing failed");
    }
  }

  /**
   * Sends a transaction.
   *
   * @param transaction - The transaction to send.
   * @returns The hash of the transaction.
   */
  async sendTransaction(transaction: TransactionRequest): Promise<Hex> {
    if (this.shouldUseGasless()) {
      try {
        return await this.sendWithGasSponsorship(transaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn(
          "[PrivyEvmDelegatedEmbeddedWalletProvider] Gasless transaction failed, falling back to standard transaction:",
          message,
        );
      }
    }

    return this.sendViaPrivyRpc(transaction);
  }

  private async sendViaPrivyRpc(transaction: TransactionRequest): Promise<Hex> {
    const body = {
      address: this.#address,
      chain_type: "ethereum",
      method: "eth_sendTransaction",
      caip2: `eip155:${this.#network.chainId!}`,
      params: {
        transaction: {
          ...transaction,
          from: this.#address,
        },
      },
    };

    try {
      const response = await this.executePrivyRequest<PrivyResponse<{ hash: Hex }>>(body);
      return response.data?.hash;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Transaction sending failed: ${error.message}`);
      }
      throw new Error("Transaction sending failed");
    }
  }

  private shouldUseGasless(): boolean {
    if (!this.#gaslessEnabled || !this.#network.chainId) {
      return false;
    }

    return this.#gaslessChains.has(Number(this.#network.chainId));
  }

  private getWalletSelector():
    | { walletId: string }
    | { address: `0x${string}`; chainType: "ethereum" } {
    if (this.#embeddedWalletId) {
      return { walletId: this.#embeddedWalletId };
    }

    if (this.#walletId && !this.#walletId.startsWith("did:")) {
      return { walletId: this.#walletId };
    }

    return { address: this.#address as `0x${string}`, chainType: "ethereum" as const };
  }

  private async sendWithGasSponsorship(transaction: TransactionRequest): Promise<Hex> {
    const client = this.createWalletApiClient(this.#gaslessAuthKey, this.#gaslessAuthKeyId);
    const selector = this.getWalletSelector();
    const chainId = Number(this.#network.chainId!);
    const payload = this.mapTransactionForPrivy(transaction);
    const authorizationContext = this.buildAuthorizationContext(this.#gaslessAuthKey);

    const execute = async (sponsor: boolean) => {
      const request = {
        ...selector,
        caip2: `eip155:${chainId}` as `eip155:${string}`,
        sponsor,
        transaction: payload,
        ...(authorizationContext ? { authorization_context: authorizationContext } : {}),
      } as any;

      const response = await client.walletApi.ethereum.sendTransaction(request);

      return response.hash as Hex;
    };

    try {
      return await execute(true);
    } catch (error) {
      if (this.isRecoverableSponsorshipError(error)) {
        return execute(false);
      }
      throw error;
    }
  }

  private mapTransactionForPrivy(transaction: TransactionRequest) {
    return {
      to: transaction.to as `0x${string}`,
      data: (transaction.data ?? "0x") as `0x${string}`,
      value: this.normalizeHex(transaction.value),
      gasLimit: this.normalizeHex((transaction as any).gas ?? (transaction as any).gasLimit),
    };
  }

  private normalizeHex(value?: bigint | number | string | Hex | null): `0x${string}` | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === "bigint") {
      return `0x${value.toString(16)}` as `0x${string}`;
    }

    if (typeof value === "number") {
      return `0x${BigInt(value).toString(16)}` as `0x${string}`;
    }

    if (typeof value === "string") {
      if (value.startsWith("0x")) {
        return value as `0x${string}`;
      }
      return `0x${BigInt(value).toString(16)}` as `0x${string}`;
    }

    return value as `0x${string}`;
  }

  private createWalletApiClient(authKey?: string, authKeyId?: string): PrivyClient {
    const resolvedKey = authKey ?? this.#gaslessAuthKey ?? this.#authKey;
    if (!resolvedKey) {
      throw new Error("Gasless sponsorship requires a Privy authorization private key");
    }

    const resolvedKeyId = authKeyId ?? this.#gaslessAuthKeyId ?? this.#authKeyId;

    const cacheKey = `${resolvedKey}:${resolvedKeyId ?? "default"}`;
    if (this.#walletApiClients.has(cacheKey)) {
      return this.#walletApiClients.get(cacheKey)!;
    }

    const client = new PrivyClient(this.#appId, this.#appSecret, {
      walletApi: {
        authorizationPrivateKey: resolvedKey,
        apiURL: this.#privyApiUrl,
      },
    });

    if (resolvedKeyId) {
      const httpInstance = (client.walletApi as any)?.api;
      if (httpInstance?.instance?.defaults?.headers) {
        httpInstance.instance.defaults.headers["privy-authorization-key-id"] = resolvedKeyId;
      }
    }

    this.#walletApiClients.set(cacheKey, client);
    return client;
  }

  private buildAuthorizationContext(authKey?: string) {
    const normalizedKey = this.normalizePrivyAuthorizationKey(authKey ?? this.#gaslessAuthKey);
    if (!normalizedKey) {
      return undefined;
    }

    return {
      authorization_private_keys: [normalizedKey],
    };
  }

  private isRecoverableSponsorshipError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const status = (error as any).status ?? (error as any).statusCode;
    if (status === 401 || status === 403) {
      return true;
    }

    const message = (error as any).message;
    if (typeof message === "string") {
      return message.includes("No valid authorization signatures");
    }

    return false;
  }

  /**
   * Waits for a transaction receipt.
   *
   * @param txHash - The hash of the transaction to wait for.
   * @returns The transaction receipt.
   */
  async waitForTransactionReceipt(txHash: Hex): Promise<TransactionReceipt> {
    return await this.#publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
  }

  /**
   * Reads data from a smart contract.
   *
   * @param params - Parameters for reading the contract
   * @param params.address - The address of the contract
   * @param params.abi - The ABI of the contract
   * @param params.functionName - The name of the function to call
   * @param params.args - The arguments to pass to the function
   * @returns A Address that resolves to the contract function's return value
   */
  async readContract<
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    params: ReadContractParameters<abi, functionName, args>,
  ): Promise<ReadContractReturnType<abi, functionName, args>> {
    return this.#publicClient.readContract<abi, functionName, args>(params);
  }

  /**
   * Transfer the native asset of the network.
   *
   * @param to - The destination address.
   * @param value - The amount to transfer in atomic units (Wei).
   * @returns The transaction hash.
   */
  async nativeTransfer(to: string, value: string): Promise<Hex> {
    const valueInWei = BigInt(value);

    try {
      const txHash = await this.sendTransaction({
        to: to as `0x${string}`,
        value: valueInWei,
      });

      const receipt = await this.waitForTransactionReceipt(txHash);

      if (!receipt) {
        throw new Error("Transaction failed");
      }

      return receipt.transactionHash;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Native transfer failed: ${error.message}`);
      }
      throw new Error("Native transfer failed");
    }
  }

  /**
   * Exports the wallet information.
   *
   * @returns The wallet data
   */
  exportWallet(): PrivyWalletExport {
    return {
      walletId: this.#walletId,
      embeddedWalletId: this.#embeddedWalletId,
      authorizationPrivateKey: this.#authKey,
      networkId: this.#network.networkId!,
      chainId: this.#network.chainId,
      authorizationKeyId: this.#authKeyId,
    };
  }

  /**
   * Generate Privy authorization signature for API requests
   *
   * @param url - The URL for the request
   * @param body - The request body
   * @returns The generated signature
   */
  private normalizePrivyAuthorizationKey(key?: string | null): string | undefined {
    if (!key) {
      return undefined;
    }

    return key.startsWith("wallet-auth:") ? key.replace("wallet-auth:", "") : key;
  }

  private generatePrivySignature(url: string, body: object): string {
    try {
      const payload = {
        version: 1,
        method: "POST",
        url,
        body,
        headers: {
          "privy-app-id": this.#appId,
        },
      };

      const serializedPayload = canonicalize(payload);
      if (!serializedPayload) throw new Error("Failed to canonicalize payload");

      const serializedPayloadBuffer = Buffer.from(serializedPayload);

      const normalizedKey = this.normalizePrivyAuthorizationKey(this.#authKey);
      if (!normalizedKey) {
        throw new Error("Missing Privy authorization key");
      }
      const privateKeyAsString = normalizedKey;
      const privateKeyAsPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyAsString}\n-----END PRIVATE KEY-----`;

      const privateKey = crypto.createPrivateKey({
        key: privateKeyAsPem,
        format: "pem",
      });

      const signatureBuffer = crypto.sign("sha256", serializedPayloadBuffer, privateKey);
      return signatureBuffer.toString("base64");
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Error generating Privy authorization signature: ${error.message}`);
      }
      throw new Error("Error generating Privy authorization signature");
    }
  }

  /**
   * Get Privy headers for API requests
   *
   * @param url - The URL for the request
   * @param body - The request body
   * @returns The headers for the request
   */
  private getPrivyHeaders(url: string, body: object) {
    return {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${this.#appId}:${this.#appSecret}`).toString("base64")}`,
      "privy-app-id": this.#appId,
      "privy-authorization-signature": this.generatePrivySignature(url, body),
    };
  }

  /**
   * Execute a Privy API request.
   *
   * @param body - The request body to send to the Privy API
   * @returns A promise that resolves to the response data
   * @throws Error if the request fails
   */
  private async executePrivyRequest<T>(body: Record<string, unknown>): Promise<T> {
    const url = `https://api.privy.io/v1/wallets/rpc`;
    const headers = this.getPrivyHeaders(url, body);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error("Privy request failed: " + error.message);
      }
      throw new Error("Privy request failed with unknown error");
    }
  }
}
