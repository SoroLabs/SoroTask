import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationPreferenceCenter } from "./notification-preference-center";
import { NOTIFICATION_PREFERENCES_STORAGE_KEY } from "../lib/notification-preferences";

describe("NotificationPreferenceCenter", () => {
  let permissionState: NotificationPermission;
  let requestPermissionMock: jest.Mock<Promise<NotificationPermission>, []>;

  beforeEach(() => {
    window.localStorage.clear();
    permissionState = "default";
    requestPermissionMock = jest.fn(async () => permissionState);

    class MockNotification {
      static get permission() {
        return permissionState;
      }

      static requestPermission = requestPermissionMock;

      constructor() {
        return {};
      }
    }

    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: MockNotification,
    });
  });

  it("loads saved preferences, persists edits, and reflects permission recovery messaging", async () => {
    window.localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        channels: {
          inApp: true,
          browser: true,
          email: true,
        },
        categories: {
          taskFailed: true,
          taskRecovered: true,
          gasLow: true,
          taskPaused: true,
          executionSuccess: false,
          executionSkipped: true,
          weeklyDigest: true,
        },
        updatedAt: "2026-04-26T12:00:00.000Z",
      }),
    );

    render(<NotificationPreferenceCenter />);

    expect(await screen.findByText("Preferences loaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Email summaries")).toBeChecked();
    expect(
      screen.getByText("Browser permission still needs a decision"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Email summaries"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(
        screen.getByText("Preferences saved successfully"),
      ).toBeInTheDocument(),
    );

    const storedPreferences = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
    );

    expect(storedPreferences.channels.email).toBe(false);
    expect(typeof storedPreferences.updatedAt).toBe("string");

    permissionState = "denied";
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));

    expect(
      await screen.findByText("Browser alerts are blocked"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/allow notifications to recover delivery/i),
    ).toBeInTheDocument();
  });
});

describe("NotificationPreferenceCenter · external channels (issue #1263)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    class MockNotification {
      static get permission() {
        return "granted";
      }
      static requestPermission = async () => "granted";
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      writable: true,
      value: MockNotification,
    });
  });

  it("configures a webhook endpoint, sends a test ping, and saves granular routing", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<NotificationPreferenceCenter />);

    const urlInput = await screen.findByLabelText("Webhook endpoint URL");
    fireEvent.change(urlInput, {
      target: { value: "https://hooks.example.com/abc" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send test ping" }));

    await waitFor(() =>
      expect(screen.getByText(/Test ping delivered/i)).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/abc",
      expect.objectContaining({ method: "POST" }),
    );

    // Granular routing: route task-failed through the webhook only.
    fireEvent.click(
      screen.getByLabelText("Route Task failed via Webhook"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(
        screen.getByText("Preferences saved successfully"),
      ).toBeInTheDocument(),
    );

    const stored = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
    );
    expect(stored.categoryChannels.taskFailed).toEqual(["webhook"]);
    expect(stored.externalEndpoints.webhook.url).toBe(
      "https://hooks.example.com/abc",
    );
  });
});
