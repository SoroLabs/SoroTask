import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationPreferenceCenter } from "./notification-preference-center";

const mockWalletAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

jest.mock("@stellar/freighter-api", () => ({
  signMessage: jest.fn(async (_message: string, options: { address: string }) => ({
    signedMessage: "c2lnbmF0dXJl",
    signerAddress: options.address,
  })),
}));

jest.mock("@/app/context/WalletContext", () => ({
  useWallet: () => ({
    session: {
      address: mockWalletAddress,
      network: { networkPassphrase: "Test SDF Network ; September 2015" },
    },
    openConnectModal: jest.fn(),
  }),
}));

function apiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createPreferences() {
  return {
    channels: {
      inApp: true,
      browser: true,
      email: false,
      webhook: false,
      telegram: false,
      discord: false,
    },
    categories: {
      taskFailed: true,
      taskRecovered: true,
      gasLow: true,
      taskPaused: true,
      executionSuccess: false,
      executionSkipped: true,
      weeklyDigest: false,
    },
    categoryChannels: {},
    externalEndpoints: {
      webhook: { url: "", secret: "", configured: false },
      telegram: { url: "", secret: "", configured: false },
      discord: { url: "", secret: "", configured: false },
    },
    externalSecretsConfigured: {
      webhook: false,
      telegram: false,
      discord: false,
    },
    emailAddress: "",
    updatedAt: null,
  };
}

describe("NotificationPreferenceCenter", () => {
  let fetchMock: jest.Mock;
  let permissionState: NotificationPermission;

  beforeEach(() => {
    permissionState = "default";
    class MockNotification {
      static get permission() {
        return permissionState;
      }

      static requestPermission = jest.fn(async () => permissionState);
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: MockNotification,
    });
  });

  it("wallet-links and saves granular notification preferences through the API", async () => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/notifications/wallet-session" && !init?.method) {
        return apiResponse({ error: "Wallet session required" }, 401);
      }
      if (path === "/api/notifications/wallet-challenge") {
        return apiResponse({
          challenge: "wallet challenge",
          networkPassphrase: "Test SDF Network ; September 2015",
        });
      }
      if (path === "/api/notifications/wallet-session" && init?.method === "POST") {
        return apiResponse({});
      }
      if (path === "/api/notifications/preferences" && init?.method === "GET") {
        return apiResponse(createPreferences());
      }
      if (path === "/api/notifications/feed") return apiResponse([]);
      if (path === "/api/notifications/preferences" && init?.method === "PUT") {
        return apiResponse({
          ...JSON.parse(String(init.body)),
          externalSecretsConfigured: {
            webhook: true,
            telegram: false,
            discord: false,
          },
        });
      }
      if (path === "/api/notifications/test") return apiResponse({ ok: true });
      return apiResponse({ error: "Unexpected request" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<NotificationPreferenceCenter />);
    fireEvent.click(screen.getByRole("button", { name: "Link wallet" }));
    expect(await screen.findByRole("button", { name: "Disconnect wallet" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Notification email address"), {
      target: { value: "operator@example.com" },
    });
    fireEvent.click(screen.getByLabelText("Route Task failed via Webhook"));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(screen.getByText("Preferences saved successfully")).toBeInTheDocument(),
    );
    const saveRequest = fetchMock.mock.calls.find(
      ([path, init]) =>
        path === "/api/notifications/preferences" && init?.method === "PUT",
    );
    expect(saveRequest).toBeDefined();
    const saved = JSON.parse(String(saveRequest?.[1]?.body));
    expect(saved.emailAddress).toBe("operator@example.com");
    expect(saved.categoryChannels.taskFailed).toEqual(["webhook"]);

    permissionState = "denied";
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(await screen.findByText("Browser alerts are blocked")).toBeInTheDocument();
  });

  it("loads and displays delivered notification history for a linked wallet", async () => {
    fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/notifications/wallet-session") {
        return apiResponse({ address: mockWalletAddress });
      }
      if (path === "/api/notifications/preferences") {
        return apiResponse(createPreferences());
      }
      if (path === "/api/notifications/feed") {
        return apiResponse([
          {
            id: "notification-1",
            type: "taskFailed",
            title: "Task #42 failed",
            message: "Execution failed.",
            url: "/settings",
            timestamp: "2026-04-26T12:00:00.000Z",
          },
        ]);
      }
      return apiResponse({ error: "Unexpected request" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<NotificationPreferenceCenter />);

    expect(await screen.findByText("Task #42 failed")).toBeInTheDocument();
    expect(screen.getByText("Execution failed.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications/feed",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
