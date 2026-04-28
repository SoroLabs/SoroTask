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
