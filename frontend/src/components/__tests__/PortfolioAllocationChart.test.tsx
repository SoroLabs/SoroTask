import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { PortfolioAllocationChart } from "../PortfolioAllocationChart";

// Keep the real Pie/Area/Tooltip implementation; supply deterministic layout.
jest.mock("recharts", () => {
  const charts = jest.requireActual("recharts");
  const React = jest.requireActual("react");
  return { ...charts, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 500, height: 288 }}>{React.cloneElement(children, { width: 500, height: 288 })}</div> };
});
const snapshot = (extra = {}) => ({ schemaVersion: 1, address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  networkPassphrase: "Test SDF Future Network ; October 2022", asOf: "2026-11-23T10:00:00Z",
  assets: [{ assetId: "usdc", symbol: "USDC", name: "USD Coin", activeUsdCents: "60000", idleUsdCents: "20000" },
    { assetId: "eurc", symbol: "EURC", name: "Euro Coin", activeUsdCents: "10000", idleUsdCents: "10000" }],
  history: [{ at: "2026-11-22T00:00:00Z", totalUsdCents: "90000" }, { at: "2026-11-23T00:00:00Z", totalUsdCents: "100000" }], ...extra });

describe("portfolio allocation chart", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })) });
  });

  it("renders real SVG charts, exact totals and accessible detail rows", () => {
    const { container } = render(<PortfolioAllocationChart snapshot={snapshot()} />);
    expect(screen.getByRole("heading", { name: "Portfolio allocation" })).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/All assets and exact USD values/));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Historical balance trend")).toBeInTheDocument();
  });

  it("supports keyboard focus and hover without depending on color", () => {
    render(<PortfolioAllocationChart snapshot={snapshot()} />);
    const list = screen.getByRole("list", { name: "Token allocation details" });
    const token = within(list).getByRole("button", { name: /USDC/ });
    fireEvent.focus(token);
    expect(screen.getByText("USDC · 80.0%")).toBeInTheDocument();
    expect(screen.getByText("$800.00 total")).toBeInTheDocument();
    expect(token).toHaveAttribute("aria-pressed", "true");
    fireEvent.blur(token);
    expect(screen.queryByText("USDC · 80.0%")).not.toBeInTheDocument();
    fireEvent.mouseEnter(within(list).getByRole("button", { name: /EURC/ }));
    expect(screen.getByText("EURC · 20.0%")).toBeInTheDocument();
    fireEvent.mouseLeave(within(list).getByRole("button", { name: /EURC/ }));
    fireEvent.click(token);
    expect(screen.getByText("USDC · 80.0%")).toBeInTheDocument();
  });

  it("shows USD details for hovered SVG sectors", () => {
    const { container } = render(<PortfolioAllocationChart snapshot={snapshot()} />);
    const sector = container.querySelector(".recharts-pie-sector")!;
    fireEvent.mouseEnter(sector);
    expect(screen.getAllByText("USDC · 80.0%").length).toBeGreaterThan(0);
    fireEvent.mouseLeave(container.querySelector(".recharts-pie-sector")!);
    expect(screen.getByText(/Hover a segment or focus a token/)).toBeInTheDocument();
  });

  it.each(["loading", "disconnected", "not-configured"] as const)("renders %s without a donut", (status) => {
    render(<PortfolioAllocationChart status={status} snapshot={snapshot()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("allocation-donut")).not.toBeInTheDocument();
  });

  it("handles errors, malformed data and a retry action", () => {
    const retry = jest.fn();
    const view = render(<PortfolioAllocationChart status="error" onRetry={retry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry portfolio" }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(<PortfolioAllocationChart snapshot={{ assets: "bad" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("handles empty and all-zero portfolios, and insufficient history", () => {
    const view = render(<PortfolioAllocationChart snapshot={snapshot({ assets: [] })} />);
    expect(screen.getByText("No valued assets in this portfolio yet.")).toBeInTheDocument();
    view.rerender(<PortfolioAllocationChart snapshot={snapshot({ assets: [{ assetId: "zero", symbol: "ZERO", name: "Zero", activeUsdCents: "0", idleUsdCents: "0" }] })} />);
    expect(screen.queryByTestId("allocation-donut")).not.toBeInTheDocument();
    view.rerender(<PortfolioAllocationChart snapshot={snapshot({ history: [] })} />);
    expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument();
  });

  it("groups large portfolios and keeps all assets in the table", () => {
    const assets = Array.from({ length: 25 }, (_, i) => ({ assetId: String(i), symbol: `T${i}`, name: `Token ${i}`, activeUsdCents: "100", idleUsdCents: "0" }));
    render(<PortfolioAllocationChart snapshot={snapshot({ assets })} />);
    expect(screen.getByRole("button", { name: /Other assets/ })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(26);
  });

  it("updates allocation and removes obsolete focused details", () => {
    const view = render(<PortfolioAllocationChart snapshot={snapshot()} />);
    fireEvent.focus(screen.getByRole("button", { name: /EURC/ }));
    view.rerender(<PortfolioAllocationChart snapshot={snapshot({ assets: [snapshot().assets[0]] })} />);
    expect(screen.queryByText("EURC · 20.0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("100.0%").length).toBeGreaterThan(0);
  });

  it("honors reduced motion and removes its preference listener", () => {
    let listener: () => void = () => {};
    const media = { matches: true, addEventListener: jest.fn((_: string, callback: () => void) => { listener = callback; }), removeEventListener: jest.fn() };
    jest.mocked(window.matchMedia).mockReturnValue(media as unknown as MediaQueryList);
    const view = render(<PortfolioAllocationChart snapshot={snapshot()} />);
    media.matches = false;
    act(() => listener());
    expect(media.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("passes automated accessibility checks with text equivalents", async () => {
    const { container } = render(<PortfolioAllocationChart snapshot={snapshot()} />);
    expect((await axe(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });
});
