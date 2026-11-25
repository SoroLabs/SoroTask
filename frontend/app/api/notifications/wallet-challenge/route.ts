import { NextResponse } from "next/server";
import {
  createWalletChallenge,
  isSameOriginMutation,
  storeWalletChallenge,
} from "@/src/lib/server/notification-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      address?: unknown;
      networkPassphrase?: unknown;
    };
    if (
      typeof body.address !== "string" ||
      typeof body.networkPassphrase !== "string" ||
      body.networkPassphrase.length > 200
    ) {
      return NextResponse.json({ error: "A wallet address and network are required" }, { status: 400 });
    }

    const origin = process.env.NOTIFICATION_APP_ORIGIN || new URL(request.url).origin;
    const challenge = createWalletChallenge(body.address, origin);
    await storeWalletChallenge(body.address, challenge);
    return NextResponse.json({ challenge, networkPassphrase: body.networkPassphrase }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create wallet challenge";
    if (message === "A valid Stellar public key is required") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Failed to create notification wallet challenge", error);
    return NextResponse.json({ error: "Notification storage is unavailable" }, { status: 503 });
  }
}
