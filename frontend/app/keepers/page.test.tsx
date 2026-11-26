import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import KeepersPage from "./page";
import type { VerifiedSocialIdentity } from "@/src/lib/auth/keeper-identities";

jest.mock("@/app/context/WalletContext", () => ({ useWallet: () => ({ session: null, connect: jest.fn(), status: "idle" }) }));
jest.mock("@/app/components/WalletButton", () => ({ WalletButton: () => <button>Connect wallet</button> }));

const ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
const NOW = 1_755_200_000_000;
const keeper = { id: "fixture-node", address: ADDRESS, tier: "gold", stakeXlm: 100, totalExecutions: 42,
  successfulExecutions: 42, uptimePercent: 99, averageLatencyMs: 20, gasSpentXlm: 1, revenueXlm: 5, slashingIncidents: [] };
const identity: VerifiedSocialIdentity = { provider: "github", providerId: "123", username: "synthetic-keeper",
  profileUrl: "https://github.com/synthetic-keeper", walletAddress: ADDRESS, verifiedAt: NOW, expiresAt: NOW + 60_000 };
const response = (value: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => value });

describe("Keeper leaderboard verified identities", () => {
  const originalFetch = global.fetch;
  const fetcher = jest.fn();
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    global.fetch = fetcher;
    fetcher.mockReset().mockImplementation(async (url: string) => String(url).includes("/leaderboard")
      ? response([keeper]) : response({ identities: { [ADDRESS]: [identity] }, github: null, providers: { github: false, farcaster: false, lens: true } }));
  });
  afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

  test("renders keeper metrics and independently verified ownership badges", async () => {
    render(<KeepersPage />);
    expect(await screen.findByText("fixture-node")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /GitHub synthetic-keeper, ownership verified/ })).toHaveAttribute("href", identity.profileUrl);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(`address=${ADDRESS}`))).toBe(true);
  });

  test("untrusted badges supplied in keeper metrics never render", async () => {
    fetcher.mockImplementation(async (url: string) => String(url).includes("/leaderboard")
      ? response([{ ...keeper, identities: [identity], verifiedIdentities: [identity] }]) : response({ identities: {} }));
    render(<KeepersPage />);
    await screen.findByText("fixture-node");
    await waitFor(() => expect(screen.queryByText("Loading keeper metrics…")).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /ownership verified/ })).not.toBeInTheDocument();
  });

  test("identity service failure clears badges while preserving keeper metrics", async () => {
    render(<KeepersPage />);
    await screen.findByRole("link", { name: /ownership verified/ });
    fetcher.mockImplementation(async (url: string) => String(url).includes("/leaderboard") ? response([keeper]) : response({}, false));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Verified social profiles are temporarily unavailable.");
    expect(screen.getByText("fixture-node")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ownership verified/ })).not.toBeInTheDocument();
  });

  test("a stale overlapping refresh cannot overwrite newer verified identities", async () => {
    render(<KeepersPage />);
    await screen.findByRole("link", { name: /ownership verified/ });
    let finish: ((value: ReturnType<typeof response>) => void) | undefined;
    let defer = true;
    fetcher.mockImplementation(async (url: string) => {
      if (String(url).includes("/leaderboard")) return response([keeper]);
      if (defer) { defer = false; return new Promise((resolve) => { finish = resolve; }); }
      return response({ identities: {} });
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /ownership verified/ })).not.toBeInTheDocument());
    finish?.(response({ identities: { [ADDRESS]: [identity] } }));
    await waitFor(() => expect(screen.queryByRole("link", { name: /ownership verified/ })).not.toBeInTheDocument());
  });

  test("empty, loading and service failure states remain actionable", async () => {
    fetcher.mockImplementation(async (url: string) => String(url).includes("/leaderboard") ? response([]) : response({}));
    const view = render(<KeepersPage />);
    expect(screen.getByText("Loading keeper metrics…")).toBeInTheDocument();
    await screen.findByText(/No keeper metrics are available/);
    view.unmount();
    fetcher.mockImplementation(async (url: string) => String(url).includes("/leaderboard") ? response({}, false) : response({}));
    render(<KeepersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Keeper service returned HTTP 503");
  });
});
