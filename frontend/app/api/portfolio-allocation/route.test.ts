/** @jest-environment node */
import { GET } from "./route";
import { PortfolioSourceError, readPortfolioSource } from "@/src/lib/portfolio-source";

jest.mock("@/src/lib/portfolio-source", () => ({
  readPortfolioSource: jest.fn(),
  PortfolioSourceError: class extends Error { constructor(public code: string, public status: number) { super(code); } },
}));
const source = jest.mocked(readPortfolioSource);

describe("portfolio snapshot route", () => {
  afterEach(() => { jest.resetAllMocks(); delete process.env.SOROTASK_PORTFOLIO_API_URL; });
  it("returns the scoped snapshot with no-store", async () => {
    process.env.SOROTASK_PORTFOLIO_API_URL = "https://portfolio.example.org";
    source.mockResolvedValue({ schemaVersion: 1, address: "scope", networkPassphrase: "network", asOf: "2026-11-23T00:00:00Z", assets: [], history: [] });
    const response = await GET(new Request("http://localhost/api/portfolio-allocation?address=scope&networkPassphrase=network"));
    expect(source).toHaveBeenCalledWith({ address: "scope", networkPassphrase: "network" }, { endpoint: "https://portfolio.example.org" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).address).toBe("scope");
  });
  it("returns stable errors without leaking provider details", async () => {
    source.mockRejectedValue(new PortfolioSourceError("not_configured", 503));
    let response = await GET(new Request("http://localhost/api/portfolio-allocation"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    source.mockRejectedValue(new Error("private provider details"));
    response = await GET(new Request("http://localhost/api/portfolio-allocation"));
    expect(await response.json()).toEqual({ error: "source_unavailable" });
  });
});
