/**
 * WalletContext.test.tsx
 *
 * Tests for WalletProvider and useWallet hook.
 * Mocks app/lib/wallet so no real Freighter extension is needed.
 */

import React from "react";
import { renderToString } from "react-dom/server";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet } from "@/app/context/WalletContext";
import { WalletConnectionError } from "@/app/lib/wallet";

// ---------------------------------------------------------------------------
// Mock app/lib/wallet
// ---------------------------------------------------------------------------

jest.mock("@/app/lib/wallet", () => ({
  connectWallet: jest.fn(),
  restoreSession: jest.fn(),
  restoreWalletSession: jest.fn(),
  connectWalletWith: jest.fn(),
  disconnectWallet: jest.fn(),
  signTransactionWith: jest.fn(),
  saveWalletSession: jest.fn(),
  watchWalletChanges: jest.fn(() => jest.fn()), // returns a stop() fn
  checkWalletAvailability: jest.fn(),
  truncateAddress: jest.fn(
    (addr: string) => addr.slice(0, 5) + "..." + addr.slice(-4),
  ),
  WALLET_PROVIDERS_META: [
    { id: "freighter", name: "Freighter", description: "", kind: "browser" },
    { id: "xbull", name: "xBull", description: "", kind: "browser" },
    { id: "albedo", name: "Albedo", description: "", kind: "web" },
    { id: "lobstr", name: "LOBSTR", description: "", kind: "web" },
    { id: "ledger", name: "Ledger", description: "", kind: "hardware" },
  ],
  WalletConnectionError: class WalletConnectionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "WalletConnectionError";
    }
  },
  EXPECTED_NETWORK_PASSPHRASE: "Test SDF Future Network ; October 2022",
}));

jest.mock("@/app/lib/hardwareWallet", () => ({
  buildStellarPath: jest.fn((account = 0) => `m/44'/148'/${account}'`),
  bytesToBase64: jest.fn(() => "cHVibGljLWtleQ=="),
  encodeSignatureForRpc: jest.fn(() => "c2lnbmF0dXJl"),
  HardwareWalletConnectionError: class HardwareWalletConnectionError extends Error {
    code: string;
    retriable: boolean;
    constructor(code: string, message: string, retriable = true) {
      super(message);
      this.code = code;
      this.retriable = retriable;
      this.name = "HardwareWalletConnectionError";
    }
  },
  openLedgerDevice: jest.fn(),
  reconnectLedgerDevice: jest.fn().mockResolvedValue(null),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: jest.fn(() => ({
      addSignature: jest.fn(),
      toXDR: jest.fn(() => "signed-envelope-xdr"),
    })),
  },
}));

import {
  connectWallet,
  connectWalletWith,
  restoreSession,
  restoreWalletSession,
  disconnectWallet,
  signTransactionWith,
  saveWalletSession,
  watchWalletChanges,
} from "@/app/lib/wallet";
import {
  openLedgerDevice,
  reconnectLedgerDevice,
} from "@/app/lib/hardwareWallet";

const mockConnect = connectWallet as jest.Mock;
const mockRestore = restoreSession as jest.Mock;
const mockRestoreWallet = restoreWalletSession as jest.Mock;
const mockConnectWith = connectWalletWith as jest.Mock;
const mockDisconnectWallet = disconnectWallet as jest.Mock;
const mockSignWith = signTransactionWith as jest.Mock;
const mockSaveSession = saveWalletSession as jest.Mock;
const mockWatch = watchWalletChanges as jest.Mock;
const mockOpenLedger = openLedgerDevice as jest.Mock;
const mockReconnectLedger = reconnectLedgerDevice as jest.Mock;

const MOCK_SESSION = {
  address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRS",
  network: {
    network: "FUTURENET",
    networkUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
  },
};

// ---------------------------------------------------------------------------
// Helper: consumer component
// ---------------------------------------------------------------------------

function TestConsumer() {
  const {
    status,
    session,
    errorCode,
    errorMessage,
    connect,
    disconnect,
    clearError,
  } = useWallet();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="address">{session?.address ?? "none"}</p>
      <p data-testid="network">{session?.network.network ?? "none"}</p>
      <p data-testid="error-code">{errorCode ?? "none"}</p>
      <p data-testid="error-message">{errorMessage ?? "none"}</p>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
      <button onClick={clearError}>clear-error</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletProvider>
      <TestConsumer />
    </WalletProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWatch.mockReturnValue(jest.fn()); // default: returns a no-op stop fn
  mockRestoreWallet.mockResolvedValue(undefined);
  mockReconnectLedger.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Session restore on mount
// ---------------------------------------------------------------------------

describe("session restore on mount", () => {
  it("does not access wallet APIs while rendering on the server", () => {
    const markup = renderToString(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(markup).toContain('data-testid="status">idle');
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it("restores an existing session silently", async () => {
    mockRestore.mockResolvedValue(MOCK_SESSION);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("connected");
    });
    expect(screen.getByTestId("address").textContent).toBe(
      MOCK_SESSION.address,
    );
    expect(screen.getByTestId("network").textContent).toBe("FUTURENET");
  });

  it("sets status to disconnected when no prior session exists", async () => {
    mockRestore.mockResolvedValue(null);

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("disconnected");
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// connect action
// ---------------------------------------------------------------------------

describe("connect action", () => {
  it("transitions to connected on success", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockResolvedValue(MOCK_SESSION);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("connected");
    expect(screen.getByTestId("address").textContent).toBe(
      MOCK_SESSION.address,
    );
  });

  it("sets error state when connection fails with NOT_INSTALLED", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("NOT_INSTALLED", "Freighter is not installed."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("error-code").textContent).toBe("NOT_INSTALLED");
  });

  it("sets error state when user rejects the popup", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("USER_REJECTED", "User rejected."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("error-code").textContent).toBe("USER_REJECTED");
  });

  it("sets WRONG_NETWORK error when wallet is on wrong network", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("WRONG_NETWORK", "Switch to Futurenet."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("error-code").textContent).toBe("WRONG_NETWORK");
    expect(screen.getByTestId("error-message").textContent).toBe(
      "Switch to Futurenet.",
    );
  });
});

// ---------------------------------------------------------------------------
// disconnect action
// ---------------------------------------------------------------------------

describe("disconnect action", () => {
  it("clears session and sets status to disconnected", async () => {
    mockRestore.mockResolvedValue(MOCK_SESSION);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("connected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("disconnect"));
    });

    expect(screen.getByTestId("status").textContent).toBe("disconnected");
    expect(screen.getByTestId("address").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// clearError action
// ---------------------------------------------------------------------------

describe("clearError action", () => {
  it("resets error state back to disconnected", async () => {
    mockRestore.mockResolvedValue(null);
    mockConnect.mockRejectedValue(
      new WalletConnectionError("UNKNOWN", "Something went wrong."),
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect"));
    });
    expect(screen.getByTestId("status").textContent).toBe("error");

    await act(async () => {
      await userEvent.click(screen.getByText("clear-error"));
    });

    expect(screen.getByTestId("status").textContent).toBe("disconnected");
    expect(screen.getByTestId("error-code").textContent).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// useWallet outside provider
// ---------------------------------------------------------------------------

describe("useWallet outside provider", () => {
  it("throws a descriptive error", () => {
    // Suppress React's error boundary console output
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<TestConsumer />)).toThrow(
      "useWallet must be used inside <WalletProvider>.",
    );

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// RBF & Transaction Speed-Up
// ---------------------------------------------------------------------------

describe("RBF & Transaction Speed-Up actions", () => {
  function RbfTestConsumer() {
    const {
      pendingTransactions,
      trackTransaction,
      speedUpTransaction,
      dismissTransaction,
    } = useWallet();

    return (
      <div>
        <p data-testid="tx-count">{pendingTransactions.length}</p>
        {pendingTransactions.map((tx) => (
          <div key={tx.id} data-testid={`tx-${tx.id}`}>
            <span data-testid={`status-${tx.id}`}>{tx.status}</span>
            <span data-testid={`fee-${tx.id}`}>{tx.baseFee}</span>
            <span data-testid={`seq-${tx.id}`}>{tx.sequenceNumber}</span>
          </div>
        ))}
        <button
          onClick={() =>
            trackTransaction({
              txHash: "0xinitialhash123",
              description: "Transfer XLM",
              sequenceNumber: 501,
              baseFee: 100,
            })
          }
        >
          track-tx
        </button>
        <button
          onClick={() => {
            const first = pendingTransactions[0];
            if (first) {
              speedUpTransaction(first.id, 150); // Bump 100 -> 150 (+50%)
            }
          }}
        >
          speed-up-valid
        </button>
        <button
          onClick={() => {
            const first = pendingTransactions[0];
            if (first) {
              speedUpTransaction(first.id, 110); // Attempt invalid bump < +20%
            }
          }}
        >
          speed-up-invalid
        </button>
        <button
          onClick={() => {
            const first = pendingTransactions[0];
            if (first) {
              dismissTransaction(first.id);
            }
          }}
        >
          dismiss-tx
        </button>
      </div>
    );
  }

  it("tracks new transactions and replaces stuck transaction with >= +20% fee bump", async () => {
    mockRestore.mockResolvedValue(null);
    render(
      <WalletProvider>
        <RbfTestConsumer />
      </WalletProvider>,
    );

    // Track a new transaction
    await act(async () => {
      await userEvent.click(screen.getByText("track-tx"));
    });

    expect(screen.getByTestId("tx-count").textContent).toBe("1");

    // Speed up with valid +50% bump (100 -> 150)
    await act(async () => {
      await userEvent.click(screen.getByText("speed-up-valid"));
    });

    // Old tx should be marked 'replaced' and new replacement tx added (total 2)
    expect(screen.getByTestId("tx-count").textContent).toBe("2");

    // Dismiss first transaction
    await act(async () => {
      await userEvent.click(screen.getByText("dismiss-tx"));
    });

    expect(screen.getByTestId("tx-count").textContent).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Multi-wallet switching, Ledger signing & session persistence
// ---------------------------------------------------------------------------

const MULTI_NETWORK = {
  network: "FUTURENET",
  networkUrl: "https://horizon-futurenet.stellar.org",
  networkPassphrase: "Test SDF Future Network ; October 2022",
  sorobanRpcUrl: "https://rpc-futurenet.stellar.org",
};

function makeSession(providerId: string, address = `${providerId}-address`) {
  return { address, network: MULTI_NETWORK, providerId };
}

function MultiWalletConsumer() {
  const {
    status,
    session,
    activeWallet,
    connectWith,
    signTransaction,
    disconnect,
    errorMessage,
  } = useWallet();
  const [signed, setSigned] = React.useState("none");

  return (
    <div>
      <p data-testid="mw-status">{status}</p>
      <p data-testid="mw-wallet">{activeWallet ?? "none"}</p>
      <p data-testid="mw-address">{session?.address ?? "none"}</p>
      <p data-testid="mw-error">{errorMessage ?? "none"}</p>
      <p data-testid="mw-signed">{signed}</p>
      {(["freighter", "xbull", "albedo", "lobstr", "ledger"] as const).map(
        (id) => (
          <button key={id} onClick={() => void connectWith(id)}>
            {`connect-${id}`}
          </button>
        ),
      )}
      <button
        onClick={async () => {
          const result = await signTransaction("envelope-xdr");
          setSigned(result.signedTxXdr);
        }}
      >
        sign
      </button>
      <button onClick={disconnect}>disconnect-multi</button>
    </div>
  );
}

function renderMulti() {
  return render(
    <WalletProvider>
      <MultiWalletConsumer />
    </WalletProvider>,
  );
}

describe("multi-wallet switching", () => {
  it("switches between browser providers and tears down the previous watcher", async () => {
    mockRestoreWallet.mockResolvedValue(null);
    mockConnectWith.mockImplementation(async (id: string) => makeSession(id));
    const stop = jest.fn();
    mockWatch.mockReturnValue(stop);

    renderMulti();
    await waitFor(() =>
      expect(screen.getByTestId("mw-status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect-freighter"));
    });
    expect(screen.getByTestId("mw-wallet").textContent).toBe("freighter");
    expect(mockConnectWith).toHaveBeenCalledWith("freighter");
    expect(mockSaveSession).toHaveBeenCalledWith(
      expect.objectContaining({ address: "freighter-address" }),
      "freighter",
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect-xbull"));
    });
    expect(screen.getByTestId("mw-wallet").textContent).toBe("xbull");
    expect(mockConnectWith).toHaveBeenCalledWith("xbull");
    expect(stop).toHaveBeenCalled();

    await act(async () => {
      await userEvent.click(screen.getByText("connect-albedo"));
    });
    expect(screen.getByTestId("mw-wallet").textContent).toBe("albedo");

    await act(async () => {
      await userEvent.click(screen.getByText("connect-lobstr"));
    });
    expect(screen.getByTestId("mw-wallet").textContent).toBe("lobstr");
  });

  it("connects Ledger and signs through the APDU bridge", async () => {
    mockRestoreWallet.mockResolvedValue(null);
    const bridge = {
      getAddress: jest.fn().mockResolvedValue({
        address: "GLEDGERADDRESS",
        path: "m/44'/148'/0'",
        publicKey: new Uint8Array(32).fill(2),
      }),
      signTransaction: jest.fn().mockResolvedValue({
        signature: new Uint8Array(64).fill(9),
        publicKey: new Uint8Array(32).fill(2),
        path: "m/44'/148'/0'",
      }),
      close: jest.fn(),
    };
    mockOpenLedger.mockResolvedValue(bridge);

    renderMulti();
    await waitFor(() =>
      expect(screen.getByTestId("mw-status").textContent).toBe("disconnected"),
    );

    await act(async () => {
      await userEvent.click(screen.getByText("connect-ledger"));
    });

    expect(screen.getByTestId("mw-wallet").textContent).toBe("ledger");
    expect(screen.getByTestId("mw-address").textContent).toBe("GLEDGERADDRESS");
    expect(mockSaveSession).toHaveBeenCalledWith(
      expect.objectContaining({ address: "GLEDGERADDRESS" }),
      "ledger",
      "m/44'/148'/0'",
    );

    await act(async () => {
      await userEvent.click(screen.getByText("sign"));
    });

    expect(bridge.signTransaction).toHaveBeenCalledWith(
      "envelope-xdr",
      expect.objectContaining({
        path: "m/44'/148'/0'",
        networkPassphrase: MULTI_NETWORK.networkPassphrase,
      }),
    );
    expect(screen.getByTestId("mw-signed").textContent).toBe(
      "signed-envelope-xdr",
    );
    expect(mockSignWith).not.toHaveBeenCalled();
  });

  it("routes non-Ledger signing through the active wallet adapter", async () => {
    mockRestoreWallet.mockResolvedValue(makeSession("xbull"));
    mockSignWith.mockResolvedValue({ signedTxXdr: "xbull-signed" });

    renderMulti();
    await waitFor(() =>
      expect(screen.getByTestId("mw-status").textContent).toBe("connected"),
    );
    expect(screen.getByTestId("mw-wallet").textContent).toBe("xbull");

    await act(async () => {
      await userEvent.click(screen.getByText("sign"));
    });

    expect(mockSignWith).toHaveBeenCalledWith(
      "xbull",
      "envelope-xdr",
      expect.objectContaining({
        address: "xbull-address",
        networkPassphrase: MULTI_NETWORK.networkPassphrase,
      }),
    );
    expect(screen.getByTestId("mw-signed").textContent).toBe("xbull-signed");
  });
});

describe("session persistence", () => {
  it("restores the persisted provider and clears it on disconnect", async () => {
    mockRestoreWallet.mockResolvedValue(makeSession("lobstr"));

    renderMulti();

    await waitFor(() =>
      expect(screen.getByTestId("mw-status").textContent).toBe("connected"),
    );
    expect(screen.getByTestId("mw-wallet").textContent).toBe("lobstr");
    expect(screen.getByTestId("mw-address").textContent).toBe("lobstr-address");

    await act(async () => {
      await userEvent.click(screen.getByText("disconnect-multi"));
    });

    expect(mockDisconnectWallet).toHaveBeenCalled();
    expect(screen.getByTestId("mw-status").textContent).toBe("disconnected");
    expect(screen.getByTestId("mw-wallet").textContent).toBe("none");
    expect(screen.getByTestId("mw-address").textContent).toBe("none");
  });

  it("silently reconnects a previously authorised Ledger on restore", async () => {
    mockRestoreWallet.mockResolvedValue({
      ...makeSession("ledger", "GLEDGERRESTORED"),
      derivationPath: "m/44'/148'/2'",
    });
    const bridge = {
      getAddress: jest.fn(),
      signTransaction: jest.fn(),
      close: jest.fn(),
    };
    mockReconnectLedger.mockResolvedValue(bridge);

    renderMulti();

    await waitFor(() =>
      expect(screen.getByTestId("mw-status").textContent).toBe("connected"),
    );
    expect(screen.getByTestId("mw-wallet").textContent).toBe("ledger");
    expect(screen.getByTestId("mw-address").textContent).toBe(
      "GLEDGERRESTORED",
    );
    expect(mockReconnectLedger).toHaveBeenCalled();
  });
});
