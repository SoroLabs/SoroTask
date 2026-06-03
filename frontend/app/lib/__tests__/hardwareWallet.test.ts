import { detectLedgerSupport, isWebHidSupported } from "../hardwareWallet";

describe("hardwareWallet", () => {
  it("reports WebHID unsupported in jsdom", async () => {
    expect(await isWebHidSupported()).toBe(false);
    expect(await detectLedgerSupport()).toBe(false);
  });
});
