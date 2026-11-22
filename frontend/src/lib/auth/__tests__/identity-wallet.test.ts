import { getAddress, signMessage } from "@stellar/freighter-api";
import { signKeeperIdentity, signSocialOwner } from "../identity-wallet";
import { identityLinkMessage, type IdentityChallenge } from "../keeper-identities";

jest.mock("@stellar/freighter-api", () => ({ getAddress: jest.fn(), signMessage: jest.fn() }));
const ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
const base64 = "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==";
const fields = { action: "link" as const, nonce: "a".repeat(64), provider: "github" as const, providerId: "123", walletAddress: ADDRESS, origin: "https://keeper.example", networkPassphrase: "Test SDF Future Network ; October 2022", issuedAt: 100, expiresAt: 300_100 };
const challenge: IdentityChallenge = { ...fields, message: identityLinkMessage(fields) };

describe("keeper wallet message signing", () => {
  beforeEach(() => {
    jest.mocked(getAddress).mockReset().mockResolvedValue({ address: ADDRESS });
    jest.mocked(signMessage).mockReset().mockResolvedValue({ signedMessage: base64, signerAddress: ADDRESS });
  });

  test("canonical text, address and network are sent to Freighter", async () => {
    expect(await signKeeperIdentity(challenge)).toBe(base64);
    expect(signMessage).toHaveBeenCalledWith(challenge.message, { address: ADDRESS, networkPassphrase: challenge.networkPassphrase });
    expect(getAddress).toHaveBeenCalledTimes(2);
  });

  test("wallet signature encodings normalize to the same 64-byte proof", async () => {
    jest.mocked(signMessage).mockResolvedValueOnce({ signedMessage: Buffer.from(base64, "base64"), signerAddress: ADDRESS });
    expect(await signKeeperIdentity(challenge)).toBe(base64);
    jest.mocked(signMessage).mockResolvedValueOnce({ signedMessage: Buffer.from(base64, "base64").toString("hex"), signerAddress: ADDRESS });
    expect(await signKeeperIdentity(challenge)).toBe(base64);
  });

  test("cancellation, changed account and incorrect signer never return a proof", async () => {
    jest.mocked(signMessage).mockResolvedValueOnce({ signedMessage: null, signerAddress: "", error: { code: -4, message: "declined" } });
    await expect(signKeeperIdentity(challenge)).rejects.toThrow("declined");
    jest.mocked(getAddress).mockResolvedValueOnce({ address: ADDRESS }).mockResolvedValueOnce({ address: "other" });
    await expect(signKeeperIdentity(challenge)).rejects.toThrow("account changed");
    jest.mocked(signMessage).mockResolvedValueOnce({ signedMessage: base64, signerAddress: "other" });
    await expect(signKeeperIdentity(challenge)).rejects.toThrow("different keeper");
  });

  test("Farcaster/Lens owner uses personal_sign and the exact resolved address", async () => {
    const request = jest.fn();
    const ownerAddress = "0x" + "1".repeat(40);
    Object.defineProperty(window, "ethereum", { configurable: true, value: { request } });
    try {
      request.mockResolvedValueOnce([ownerAddress]).mockResolvedValueOnce("0xsynthetic-proof");
      expect(await signSocialOwner({ ...challenge, ownerAddress })).toBe("0xsynthetic-proof");
      expect(request.mock.calls[1][0]).toMatchObject({ method: "personal_sign", params: [expect.stringMatching(/^0x/), ownerAddress] });
      request.mockResolvedValueOnce(["0x" + "2".repeat(40)]);
      await expect(signSocialOwner({ ...challenge, ownerAddress })).rejects.toThrow("owner account");
      expect(request).toHaveBeenCalledTimes(3);
    } finally { Reflect.deleteProperty(window, "ethereum"); }
  });
});
