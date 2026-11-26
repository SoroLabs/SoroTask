import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { KeeperIdentityPanel } from "../KeeperIdentityPanel";
import { KeeperSocialBadges } from "../KeeperSocialBadges";
import { identityLinkMessage, type IdentityChallenge, type VerifiedSocialIdentity } from "@/src/lib/auth/keeper-identities";
import { signKeeperIdentity, signSocialOwner } from "@/src/lib/auth/identity-wallet";
import { signIn } from "next-auth/react";

jest.mock("@/src/lib/auth/identity-wallet", () => ({ signKeeperIdentity: jest.fn(), signSocialOwner: jest.fn() }));
jest.mock("next-auth/react", () => ({ signIn: jest.fn() }));

const NOW = 1_755_200_000_000;
const ADDRESS = "GB7RICBT3KM36Z5VDUFC63BYHTVZXM6IQZMWJ3LRNSM5RM63TRTJARRK";
const IDENTITY: VerifiedSocialIdentity = {
  provider: "github", providerId: "123", username: "synthetic-keeper", profileUrl: "https://github.com/synthetic-keeper",
  walletAddress: ADDRESS, verifiedAt: NOW, expiresAt: NOW + 60_000,
};

function challenge(action: "link" | "unlink" = "link"): IdentityChallenge {
  const fields = { action, nonce: "a".repeat(64), provider: "github" as const, providerId: "123", walletAddress: ADDRESS,
    origin: window.location.origin, networkPassphrase: "Test SDF Future Network ; October 2022", issuedAt: NOW, expiresAt: NOW + 300_000 };
  return { ...fields, message: identityLinkMessage(fields) };
}

describe("keeper verified social interface", () => {
  const fetcher = jest.fn();
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    global.fetch = fetcher;
    fetcher.mockReset();
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ github: { id: "123", username: "synthetic-keeper" }, providers: { github: true, farcaster: true, lens: true } }) });
    jest.mocked(signKeeperIdentity).mockReset().mockResolvedValue("synthetic-signature");
    jest.mocked(signSocialOwner).mockReset().mockResolvedValue(undefined);
  });
  afterEach(async () => { await act(async () => undefined); jest.restoreAllMocks(); global.fetch = originalFetch; });

  test("renders only unexpired profiles for the exact keeper, with safe links", async () => {
    const { container } = render(<KeeperSocialBadges address={ADDRESS} identities={[IDENTITY, { ...IDENTITY, providerId: "2", profileUrl: "javascript:alert(1)" }, { ...IDENTITY, expiresAt: NOW }, { ...IDENTITY, walletAddress: "other" }]} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    const link = screen.getByRole("link", { name: /GitHub synthetic-keeper, ownership verified/ });
    expect(link).toHaveAttribute("href", IDENTITY.profileUrl);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect((await axe(container)).violations).toEqual([]);
  });

  test("link controls have labels, disabled disconnected state and no automatic signing", async () => {
    const { container } = render(<KeeperIdentityPanel identities={[]} onChanged={jest.fn()} />);
    await screen.findByText("Signed in as GitHub synthetic-keeper.");
    expect(screen.getByRole("combobox", { name: "Social provider" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify and link" })).toBeDisabled();
    expect(signKeeperIdentity).not.toHaveBeenCalled();
    expect((await axe(container)).violations).toEqual([]);
  });

  test("a badge disappears at expiry even when the metrics table does not refresh", () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      render(<KeeperSocialBadges address={ADDRESS} identities={[IDENTITY]} />);
      expect(screen.getByRole("link")).toBeInTheDocument();
      jest.spyOn(Date, "now").mockReturnValue(IDENTITY.expiresAt);
      act(() => { jest.advanceTimersByTime(60_000); });
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    } finally { jest.useRealTimers(); }
  });

  test("explicit link signs the canonical challenge once and refreshes after verification", async () => {
    const changed = jest.fn();
    render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={changed} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify and link" })).toBeEnabled());
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: challenge() }) });
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ identity: IDENTITY }) });
    fireEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(signKeeperIdentity).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Profile ownership verified and linked.");
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toMatchObject({ operation: "complete", walletSignature: "synthetic-signature" });
  });

  test("wallet cancellation never submits completion or retries signing", async () => {
    render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify and link" })).toBeEnabled());
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: challenge() }) });
    jest.mocked(signKeeperIdentity).mockRejectedValueOnce(new Error("Wallet signature was declined."));
    fireEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("declined"));
    expect(signKeeperIdentity).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([, args]) => args?.body && JSON.parse(args.body).operation === "complete")).toHaveLength(0);
  });

  test.each(["wallet change", "unmount"])("%s during social signing prevents a second wallet prompt", async (reason) => {
    const view = render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={jest.fn()} />);
    await screen.findByText("Signed in as GitHub synthetic-keeper.");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "farcaster" } });
    fireEvent.change(screen.getByLabelText("Farcaster FID"), { target: { value: "42" } });
    const fields = { ...challenge(), provider: "farcaster" as const, providerId: "42", ownerAddress: "0x" + "1".repeat(40) };
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: { ...fields, message: identityLinkMessage(fields) } }) });
    let finish!: (signature: string) => void;
    jest.mocked(signSocialOwner).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    await waitFor(() => expect(signSocialOwner).toHaveBeenCalledTimes(1));
    if (reason === "wallet change") view.rerender(<KeeperIdentityPanel address="another-wallet" identities={[]} onChanged={jest.fn()} />);
    else view.unmount();
    await act(async () => { finish("synthetic-owner-signature"); });
    expect(signKeeperIdentity).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([, args]) => args?.body && JSON.parse(args.body).operation === "complete")).toHaveLength(0);
  });

  test.each([null, { ...IDENTITY, walletAddress: "another-wallet" }, { ...IDENTITY, providerId: "456" }])("invalid completion %j never claims verified ownership", async (identity) => {
    const changed = jest.fn();
    render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={changed} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify and link" })).toBeEnabled());
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: challenge() }) });
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ identity }) });
    fireEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("status")).not.toHaveTextContent("ownership verified");
    expect(changed).not.toHaveBeenCalled();
  });

  test("malicious or wallet-mismatched challenge cannot reach either wallet", async () => {
    render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verify and link" })).toBeEnabled());
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: { ...challenge(), message: "Sign an arbitrary transaction" } }) });
    fireEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("invalid"));
    expect(signKeeperIdentity).not.toHaveBeenCalled();
    expect(signSocialOwner).not.toHaveBeenCalled();
  });

  test("provider selection exposes labelled Farcaster and Lens fields", async () => {
    const { container } = render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={jest.fn()} />);
    await screen.findByText("Signed in as GitHub synthetic-keeper.");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "farcaster" } });
    expect(screen.getByLabelText("Farcaster FID")).toHaveAttribute("maxLength", "100");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "lens" } });
    expect(screen.getByLabelText("Lens account address")).toBeRequired();
    expect((await axe(container)).violations).toEqual([]);
  });

  test("unlink is a distinct signed action", async () => {
    const changed = jest.fn();
    render(<KeeperIdentityPanel address={ADDRESS} identities={[IDENTITY]} onChanged={changed} />);
    await screen.findByText("Signed in as GitHub synthetic-keeper.");
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ challenge: challenge("unlink") }) });
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ identity: null }) });
    fireEvent.click(screen.getByRole("button", { name: "Unlink github" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(jest.mocked(signKeeperIdentity).mock.calls[0][0].action).toBe("unlink");
  });

  test("GitHub sign-in remains actionable without a provider session", async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ github: null, providers: { github: true, farcaster: false, lens: false } }) });
    render(<KeeperIdentityPanel address={ADDRESS} identities={[]} onChanged={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    expect(signIn).toHaveBeenCalledWith("github", { callbackUrl: "/keepers" });
    expect(screen.getByRole("button", { name: "Verify and link" })).toBeDisabled();
  });
});
