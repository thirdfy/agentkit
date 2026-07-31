import * as AaveAddressBook from "@bgd-labs/aave-address-book";

export type AavePoolMarket = {
  exportName: string;
  instanceKey: string;
  chainId: number;
  pool: `0x${string}`;
};

const TESTNET_MARKERS = ["Sepolia", "Testnet", "Amoy", "Fuji", "Mumbai", "Goerli", "Chiado", "Holesky"];

export function aaveExportToInstanceKey(exportName: string): string {
  const stripped = exportName.replace(/^AaveV3/, "");
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export function listAaveV3MainnetPools(): AavePoolMarket[] {
  const rows: AavePoolMarket[] = [];
  for (const exportName of Object.keys(AaveAddressBook)) {
    if (!exportName.startsWith("AaveV3")) continue;
    if (TESTNET_MARKERS.some((marker) => exportName.includes(marker))) continue;
    const record = (AaveAddressBook as Record<string, unknown>)[exportName] as Record<string, unknown>;
    const chainId = Number(record.CHAIN_ID);
    const pool = String(record.POOL || "").trim();
    if (!Number.isFinite(chainId) || chainId <= 0) continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(pool)) continue;
    rows.push({
      exportName,
      instanceKey: aaveExportToInstanceKey(exportName),
      chainId,
      pool: pool.toLowerCase() as `0x${string}`,
    });
  }
  return rows;
}

export function resolveAavePool(chainId: number, poolAddress?: string): AavePoolMarket | null {
  const pools = listAaveV3MainnetPools().filter((row) => row.chainId === chainId);
  if (poolAddress) {
    const normalized = poolAddress.toLowerCase();
    return pools.find((row) => row.pool === normalized) ?? null;
  }
  if (pools.length === 1) return pools[0];
  return pools.find((row) => row.instanceKey === "base") ?? pools[0] ?? null;
}
