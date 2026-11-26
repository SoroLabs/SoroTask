import { validateNotificationEndpointUrl } from "./notification-secrets";

describe("validateNotificationEndpointUrl", () => {
  it.each([
    "http://hooks.example.com/path",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://service.internal/hook",
    "https://user:pass@hooks.example.com/hook",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(validateNotificationEndpointUrl(url)).toBeTruthy();
  });

  it("accepts HTTPS URLs on public hostnames", () => {
    expect(
      validateNotificationEndpointUrl("https://hooks.example.com/abc"),
    ).toBeNull();
  });
});
