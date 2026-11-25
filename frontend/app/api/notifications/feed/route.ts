import { NextResponse } from "next/server";
import {
  getWalletAddress,
  readInAppNotifications,
} from "@/src/lib/server/notification-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const address = await getWalletAddress(request);
    if (!address) {
      return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    }
    return NextResponse.json(await readInAppNotifications(address), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load notification feed", error);
    return NextResponse.json({ error: "Notification storage is unavailable" }, { status: 503 });
  }
}
