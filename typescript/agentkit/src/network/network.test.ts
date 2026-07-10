import { CHAIN_ID_TO_NETWORK_ID, getChain, NETWORK_ID_TO_VIEM_CHAIN } from "./network";

describe("network chain registry", () => {
  it("maps Robinhood mainnet chain id 4663", () => {
    expect(CHAIN_ID_TO_NETWORK_ID[4663]).toBe("robinhood-mainnet");
    expect(NETWORK_ID_TO_VIEM_CHAIN["robinhood-mainnet"].id).toBe(4663);
  });

  it("resolves Robinhood mainnet via getChain fallback", () => {
    const chain = getChain("4663");
    expect(chain.id).toBe(4663);
    expect(chain.name).toBe("Robinhood Chain");
    expect(chain.nativeCurrency.symbol).toBe("ETH");
  });

  it("still resolves DogeOS testnet via getChain fallback", () => {
    const chain = getChain("6281971");
    expect(chain.id).toBe(6281971);
    expect(chain.name).toBe("DogeOS Chikyu Testnet");
  });
});
