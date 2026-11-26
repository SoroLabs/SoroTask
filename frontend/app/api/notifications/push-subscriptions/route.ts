import { NextResponse } from "next/server";
import {
  addPushSubscription,
  getWalletAddress,
  isSameOriginMutation,
  removePushSubscription,
} from "@/src/lib/server/notification-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }
  try {
    const address = await getWalletAddress(request);
    if (!address) return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    await addPushSubscription(address, await request.json());
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save push subscription";
    const invalid = message.startsWith("A push") || message.startsWith("Invalid");
    if (!invalid) console.error("Failed to store push subscription", error);
    return NextResponse.json(
      { error: invalid ? message : "Notification storage is unavailable" },
      { status: invalid ? 400 : 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }
  try {
    const address = await getWalletAddress(request);
    if (!address) return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    const body = (await request.json()) as { endpoint?: unknown };
    if (typeof body.endpoint !== "string") {
      return NextResponse.json({ error: "A subscription endpoint is required" }, { status: 400 });
    }
    await removePushSubscription(address, body.endpoint);
    return NextResponse.json({ subscribed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove push subscription";
    if (message.startsWith("Invalid")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Failed to remove push subscription", error);
    return NextResponse.json({ error: "Notification storage is unavailable" }, { status: 503 });
  }
}
