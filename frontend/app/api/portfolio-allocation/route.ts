import { NextResponse } from "next/server";
import { PortfolioSourceError, readPortfolioSource } from "@/src/lib/portfolio-source";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = { address: url.searchParams.get("address") ?? "", networkPassphrase: url.searchParams.get("networkPassphrase") ?? "" };
  const headers = { "Cache-Control": "no-store" };
  try {
    const snapshot = await readPortfolioSource(scope, { endpoint: process.env.SOROTASK_PORTFOLIO_API_URL });
    return NextResponse.json(snapshot, { headers });
  } catch (error) {
    const known = error instanceof PortfolioSourceError ? error : new PortfolioSourceError("source_unavailable", 503);
    return NextResponse.json({ error: known.code }, { status: known.status, headers });
  }
}
