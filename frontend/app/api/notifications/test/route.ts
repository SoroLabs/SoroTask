import { NextResponse } from "next/server";
import {
  getWalletAddress,
  isSameOriginMutation,
  sendChannelTest,
  sendPushTest,
} from "@/src/lib/server/notification-service";
import type { ExternalNotificationChannel } from "@/src/lib/notification-preferences";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }
  try {
    const address = await getWalletAddress(request);
    if (!address) return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    const body = (await request.json()) as {
      channel?: unknown;
      url?: unknown;
      secret?: unknown;
    };
    if (body.channel === "browser") {
      await sendPushTest(address);
    } else if (
      body.channel === "webhook" ||
      body.channel === "telegram" ||
      body.channel === "discord"
    ) {
      await sendChannelTest(address, body.channel as ExternalNotificationChannel, {
        url: typeof body.url === "string" ? body.url : "",
        secret: typeof body.secret === "string" ? body.secret : "",
      });
    } else {
      return NextResponse.json({ error: "Unsupported test channel" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification test failed";
    console.error("Notification test delivery failed", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
