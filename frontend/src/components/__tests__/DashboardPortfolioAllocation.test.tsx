import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardPortfolioAllocation } from "../DashboardPortfolioAllocation";

let session: { address: string; network: { networkPassphrase: string } } | null;
jest.mock("@/app/context/WalletContext", () => ({ useWallet: () => ({ session }) }));
jest.mock("next/dynamic", () => () => function Chart(props: { status: string; snapshot?: { address: string }; onRetry: () => void }) {
  return <><p data-testid="chart-status">{props.status}</p>{props.snapshot && <p>{props.snapshot.address}</p>}<button onClick={props.onRetry}>Retry</button></>;
});
const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const otherAddress = "G" + "B".repeat(55);
const networkPassphrase = "Test SDF Future Network ; October 2022";
const snapshot = (addressValue = address) => ({ schemaVersion: 1, address: addressValue, networkPassphrase, asOf: new Date().toISOString(), assets: [], history: [] });
const response = (raw: unknown, ok = true) => ({ ok, json: async () => raw });

describe("dashboard portfolio feed", () => {
  beforeEach(() => { session = null; global.fetch = jest.fn(); });
  afterEach(() => { jest.useRealTimers(); });
  it("does not request a portfolio before a wallet is connected", () => {
    render(<DashboardPortfolioAllocation />);
    expect(screen.getByTestId("chart-status")).toHaveTextContent("disconnected");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("loads scoped data and requests no-store", async () => {
    session = { address, network: { networkPassphrase } };
    jest.mocked(fetch).mockResolvedValue(response(snapshot()) as Response);
    render(<DashboardPortfolioAllocation />);
    await waitFor(() => expect(screen.getByTestId("chart-status")).toHaveTextContent("ready"));
    expect(screen.getByText(address)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/portfolio-allocation?address="), expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("does not show stale responses after wallet switch or disconnect", async () => {
    session = { address, network: { networkPassphrase } };
    let finish: (value: Response) => void = () => {};
    jest.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<DashboardPortfolioAllocation />);
    session = { address: otherAddress, network: { networkPassphrase } };
    jest.mocked(fetch).mockResolvedValue(response(snapshot(otherAddress)) as Response);
    view.rerender(<DashboardPortfolioAllocation />);
    await waitFor(() => expect(screen.getByText(otherAddress)).toBeInTheDocument());
    await act(async () => finish(response(snapshot()) as Response));
    expect(screen.queryByText(address)).not.toBeInTheDocument();
    session = null;
    view.rerender(<DashboardPortfolioAllocation />);
    expect(screen.queryByText(otherAddress)).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-status")).toHaveTextContent("disconnected");
  });
  it.each([{ error: "not_configured" }, { error: "source_unavailable" }])("shows a safe provider error %# and supports retry", async (raw) => {
    session = { address, network: { networkPassphrase } };
    jest.mocked(fetch).mockResolvedValueOnce(response(raw, false) as Response).mockResolvedValue(response(snapshot()) as Response);
    render(<DashboardPortfolioAllocation />);
    await waitFor(() => expect(screen.getByTestId("chart-status")).toHaveTextContent(raw.error === "not_configured" ? "not-configured" : "error"));
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("chart-status")).toHaveTextContent("ready"));
  });
  it.each([{}, snapshot(otherAddress), { ...snapshot(), asOf: "2020-01-01T00:00:00Z" }])("rejects invalid, mismatched or stale snapshots %#", async (raw) => {
    session = { address, network: { networkPassphrase } };
    jest.mocked(fetch).mockResolvedValue(response(raw) as Response);
    render(<DashboardPortfolioAllocation />);
    await waitFor(() => expect(screen.getByTestId("chart-status")).toHaveTextContent("error"));
  });
  it("aborts pending requests on unmount", () => {
    session = { address, network: { networkPassphrase } };
    jest.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const view = render(<DashboardPortfolioAllocation />);
    const signal = jest.mocked(fetch).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it("times out a transport that never resolves", () => {
    jest.useFakeTimers();
    session = { address, network: { networkPassphrase } };
    jest.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    render(<DashboardPortfolioAllocation />);
    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByTestId("chart-status")).toHaveTextContent("error");
    expect(jest.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("stops displaying data once its valuation expires", async () => {
    jest.useFakeTimers();
    session = { address, network: { networkPassphrase } };
    jest.mocked(fetch).mockResolvedValue(response(snapshot()) as Response);
    render(<DashboardPortfolioAllocation />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId("chart-status")).toHaveTextContent("ready");
    act(() => jest.advanceTimersByTime(5 * 60_000));
    expect(screen.queryByText(address)).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-status")).toHaveTextContent("error");
  });
});
