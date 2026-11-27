/** @jest-environment node */
import { readPortfolioSource } from "../portfolio-source";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const networkPassphrase = "Test SDF Future Network ; October 2022";
const scope = { address, networkPassphrase };
const now = Date.parse("2026-11-23T10:00:00Z");
const raw = (extra = {}) => ({ schemaVersion: 1, ...scope, asOf: "2026-11-23T10:00:00Z", assets: [], history: [], ...extra });
const endpoint = "https://portfolio.example.org/snapshot";

describe("read-only portfolio source", () => {
  it("requests only the configured host and binds the response to scope", async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () => Response.json(raw()));
    const data = await readPortfolioSource(scope, { endpoint, fetcher, now: () => now });
    expect(data.address).toBe(address);
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(String(url)).origin).toBe("https://portfolio.example.org");
    expect(new URL(String(url)).searchParams.get("address")).toBe(address);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "invalid", "http://example.org", "https://user:pass@example.org", "https://example.org/#fragment"])("fails closed on absent or unsafe endpoint %#", async (endpoint) => {
    const fetcher = jest.fn();
    await expect(readPortfolioSource(scope, { endpoint, fetcher })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects invalid addresses and unsupported network before transport", async () => {
    const fetcher = jest.fn();
    for (const bad of [{ ...scope, address: "bad" }, { ...scope, address: "G" + "A".repeat(55) }, { ...scope, networkPassphrase: "Mainnet" }]) {
      await expect(readPortfolioSource(bad, { endpoint, fetcher })).rejects.toMatchObject({ code: "invalid_scope", status: 400 });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response("error", { status: 500 }),
    () => new Response("{}", { headers: { "content-length": String(256 * 1024 + 1) } }),
    () => new Response(" ".repeat(256 * 1024 + 1)),
    () => new Response("not JSON"),
    () => new Response(null),
    () => Response.json(raw({ address: "G" + "B".repeat(55) })),
  ])("rejects invalid or oversized transport responses %#", async (response) => {
    await expect(readPortfolioSource(scope, { endpoint, now: () => now, fetcher: jest.fn(async () => response()) })).rejects.toMatchObject({ code: "source_unavailable" });
  });

  it("redacts provider failures and rejects stale/future values", async () => {
    await expect(readPortfolioSource(scope, { endpoint, fetcher: jest.fn(async () => { throw new Error("private failure"); }) })).rejects.toMatchObject({ message: "source_unavailable" });
    for (const asOf of ["2026-11-23T09:54:59Z", "2026-11-23T10:01:01Z"]) {
      await expect(readPortfolioSource(scope, { endpoint, now: () => now, fetcher: jest.fn(async () => Response.json(raw({ asOf }))) })).rejects.toMatchObject({ code: "stale_snapshot" });
    }
    await expect(readPortfolioSource(scope, { endpoint, now: () => now, fetcher: jest.fn(async () => Response.json(raw({ asOf: "2026-11-23T09:55:00Z" }))) })).resolves.toMatchObject({ address });
  });
});
