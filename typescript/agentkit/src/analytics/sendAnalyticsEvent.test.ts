/**
 * Tests for best-effort Coinbase analytics beacon.
 */
import { sendAnalyticsEvent } from "./sendAnalyticsEvent";

describe("sendAnalyticsEvent", () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it("resolves when the beacon returns HTTP 400 (never throws)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
    }) as unknown as typeof fetch;

    await expect(
      sendAnalyticsEvent({
        name: "agent_initialization",
        action: "initialize_wallet_provider",
        component: "wallet_provider",
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0] || "")).toContain("HTTP 400");
  });

  it("resolves when fetch rejects (network failure)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("fetch failed")) as unknown as typeof fetch;

    await expect(
      sendAnalyticsEvent({
        name: "agent_action_invocation",
        action: "invoke_action",
        component: "agent_action",
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
  });

  it("resolves on HTTP 200 without warning", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    await expect(
      sendAnalyticsEvent({
        name: "agent_initialization",
        action: "initialize_wallet_provider",
        component: "wallet_provider",
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
