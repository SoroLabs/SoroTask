/**
 * wallet-multi.test.ts
 *
 * Covers the unified wallet registry, provider signing adapters and session
 * persistence introduced for the multi-wallet hub.
 */

jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  requestAccess: jest.fn(),
  getAddress: jest.fn(),
  getNetworkDetails: jest.fn(),
  signTransaction: jest.fn(),
  WatchWalletChanges: jest.fn().mockImplementation(() => ({
    watch: jest.fn(),
    stop: jest.fn(),
  })),
}));

import { signTransaction as freighterSignTransaction } from "@stellar/freighter-api";
import {
  WALLET_PROVIDERS_META,
  checkWalletAvailability,
  connectWalletWith,
  disconnectWallet,
  loadWalletSession,
  restoreWalletSession,
  saveWalletSession,
  signTransactionWith,
  EXPECTED_NETWORK_PASSPHRASE,
} from "../wallet";

const mockFreighterSign = freighterSignTransaction as jest.Mock;

const NETWORK = {
  network: "FUTURENET",
  networkUrl: "https://horizon-futurenet.stellar.org",
  networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
  sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
};

const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS";

function setWindowProp(key: string, value: unknown) {
  Object.defineProperty(window, key, {
    configurable: true,
    value,
    writable: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  setWindowProp("albedo", undefined);
  setWindowProp("xBullSDK", undefined);
  setWindowProp("xBull", undefined);
  setWindowProp("LobstrSigner", undefined);
  setWindowProp("lobstr", undefined);
});

describe("wallet registry", () => {
  it("lists all five supported wallets including Ledger", () => {
    expect(WALLET_PROVIDERS_META.map((wallet) => wallet.id)).toEqual([
      "freighter",
      "xbull",
      "albedo",
      "lobstr",
      "ledger",
    ]);
    expect(WALLET_PROVIDERS_META.find((w) => w.id === "ledger")?.kind).toBe(
      "hardware",
    );
  });

  it("detects Ledger support from WebUSB", async () => {
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: { requestDevice: jest.fn() },
    });
    expect(await checkWalletAvailability("ledger")).toBe(true);

    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: undefined,
    });
    expect(await checkWalletAvailability("ledger")).toBe(false);
  });

  it("rejects direct Ledger connections so the hardware flow is used", async () => {
    await expect(connectWalletWith("ledger")).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("browser provider connections", () => {
  it("connects xBull", async () => {
    setWindowProp("xBullSDK", {
      connect: jest.fn().mockResolvedValue({ address: ADDRESS }),
    });

    const session = await connectWalletWith("xbull");
    expect(session.address).toBe(ADDRESS);
    expect(session.providerId).toBe("xbull");
  });

  it("connects Albedo", async () => {
    setWindowProp("albedo", {
      publicKey: jest.fn().mockResolvedValue({ publicKey: ADDRESS }),
    });

    const session = await connectWalletWith("albedo");
    expect(session.address).toBe(ADDRESS);
  });

  it("connects LOBSTR", async () => {
    setWindowProp("LobstrSigner", {
      connect: jest.fn().mockResolvedValue({ address: ADDRESS }),
    });

    const session = await connectWalletWith("lobstr");
    expect(session.address).toBe(ADDRESS);
  });
});

describe("provider signing adapters", () => {
  it("signs through Freighter", async () => {
    mockFreighterSign.mockResolvedValue({ signedTxXdr: "freighter-signed" });

    const result = await signTransactionWith("freighter", "xdr", {
      address: ADDRESS,
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    });

    expect(mockFreighterSign).toHaveBeenCalledWith("xdr", {
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
      address: ADDRESS,
    });
    expect(result.signedTxXdr).toBe("freighter-signed");
  });

  it("signs through xBull", async () => {
    const sign = jest.fn().mockResolvedValue({ signedXDR: "xbull-signed" });
    setWindowProp("xBullSDK", { sign });

    const result = await signTransactionWith("xbull", "xdr", {
      address: ADDRESS,
    });

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ xdr: "xdr", publicKey: ADDRESS }),
    );
    expect(result.signedTxXdr).toBe("xbull-signed");
  });

  it("signs through Albedo", async () => {
    const tx = jest
      .fn()
      .mockResolvedValue({ signed_envelope_xdr: "albedo-signed" });
    setWindowProp("albedo", { tx });

    const result = await signTransactionWith("albedo", "xdr", {
      address: ADDRESS,
    });

    expect(tx).toHaveBeenCalledWith(
      expect.objectContaining({ xdr: "xdr", pubkey: ADDRESS }),
    );
    expect(result.signedTxXdr).toBe("albedo-signed");
  });

  it("signs through LOBSTR", async () => {
    const signTransaction = jest
      .fn()
      .mockResolvedValue({ signedTxXdr: "lobstr-signed" });
    setWindowProp("LobstrSigner", { signTransaction });

    const result = await signTransactionWith("lobstr", "xdr", {
      address: ADDRESS,
    });

    expect(signTransaction).toHaveBeenCalledWith(
      "xdr",
      expect.objectContaining({ publicKey: ADDRESS }),
    );
    expect(result.signedTxXdr).toBe("lobstr-signed");
  });

  it("surfaces a provider that is not available", async () => {
    await expect(signTransactionWith("xbull", "xdr")).rejects.toMatchObject({
      code: "NOT_INSTALLED",
    });
  });
});

describe("session persistence", () => {
  it("saves and loads metadata including the Ledger derivation path", () => {
    saveWalletSession(
      { address: ADDRESS, network: NETWORK, providerId: "ledger" },
      "ledger",
      "m/44'/148'/0'",
    );

    const stored = loadWalletSession();
    expect(stored).toMatchObject({
      providerId: "ledger",
      address: ADDRESS,
      derivationPath: "m/44'/148'/0'",
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    });
  });

  it("restores a persisted browser session", async () => {
    setWindowProp("xBullSDK", { connect: jest.fn() });
    saveWalletSession(
      { address: ADDRESS, network: NETWORK, providerId: "xbull" },
      "xbull",
    );

    const restored = await restoreWalletSession();
    expect(restored?.address).toBe(ADDRESS);
    expect(restored?.providerId).toBe("xbull");
  });

  it("restores a Ledger session even when no device is currently attached", async () => {
    saveWalletSession(
      { address: ADDRESS, network: NETWORK, providerId: "ledger" },
      "ledger",
      "m/44'/148'/1'",
    );

    const restored = await restoreWalletSession();
    expect(restored?.providerId).toBe("ledger");
    expect(restored?.derivationPath).toBe("m/44'/148'/1'");
  });

  it("refuses to restore a session for a wallet that is no longer available", async () => {
    saveWalletSession(
      { address: ADDRESS, network: NETWORK, providerId: "xbull" },
      "xbull",
    );

    expect(await restoreWalletSession()).toBeNull();
  });

  it("clears the persisted session on disconnect", async () => {
    setWindowProp("xBullSDK", { connect: jest.fn() });
    saveWalletSession(
      { address: ADDRESS, network: NETWORK, providerId: "xbull" },
      "xbull",
    );

    disconnectWallet();

    expect(loadWalletSession()).toBeNull();
    expect(await restoreWalletSession()).toBeNull();
  });

  it("rejects a persisted session on the wrong network", async () => {
    saveWalletSession(
      {
        address: ADDRESS,
        network: {
          ...NETWORK,
          networkPassphrase: "Test SDF Network ; September 2015",
        },
        providerId: "ledger",
      },
      "ledger",
    );

    expect(await restoreWalletSession()).toBeNull();
  });
});
