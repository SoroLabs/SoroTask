import { StrKey } from "@stellar/stellar-sdk";
import { parsePortfolioSnapshot, type PortfolioSnapshot } from "./portfolio-allocation";

const NETWORK = "Test SDF Future Network ; October 2022";
const MAX_BYTES = 256 * 1024;

export class PortfolioSourceError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

/** Fixed, server-configured read-only feed; request data cannot choose a host. */
export async function readPortfolioSource(scope: { address: string; networkPassphrase: string }, options: {
  endpoint?: string;
  fetcher?: typeof fetch;
  now?: () => number;
} = {}): Promise<PortfolioSnapshot> {
  if (!StrKey.isValidEd25519PublicKey(scope.address) || scope.networkPassphrase !== NETWORK) {
    throw new PortfolioSourceError("invalid_scope", 400);
  }
  if (!options.endpoint) throw new PortfolioSourceError("not_configured", 503);
  let url: URL;
  try {
    url = new URL(options.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
  } catch { throw new PortfolioSourceError("not_configured", 503); }
  url.searchParams.set("address", scope.address);
  url.searchParams.set("networkPassphrase", scope.networkPassphrase);
  try {
    const response = await (options.fetcher ?? fetch)(url.toString(), {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" },
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error(); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const snapshot = parsePortfolioSnapshot(JSON.parse(text + decoder.decode()), scope);
    const age = (options.now ?? Date.now)() - Date.parse(snapshot.asOf);
    if (age > 5 * 60_000 || age < -60_000) throw new PortfolioSourceError("stale_snapshot", 503);
    return snapshot;
  } catch (error) {
    if (error instanceof PortfolioSourceError) throw error;
    throw new PortfolioSourceError("source_unavailable", 503);
  }
}
