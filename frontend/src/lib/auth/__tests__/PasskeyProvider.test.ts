import {
  PasskeyProvider,
  detectDevicePlatform,
} from "../PasskeyProvider";

describe("PasskeyProvider", () => {
  it("detects device platform correctly", () => {
    const platform = detectDevicePlatform();
    expect(["ios", "android", "desktop"]).toContain(platform);
  });

  it("checks freighter availability without throwing", () => {
    const available = PasskeyProvider.isFreighterAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("authorizes operation with fallback simulation", async () => {
    const result = await PasskeyProvider.authorizeOperation(
      "create_task",
      "G_TEST_USER_12345",
      "hash12345"
    );
    expect(result).toBeDefined();
    expect(result.method).toBeDefined();
    expect(result.signature).toBeDefined();
  });
});
