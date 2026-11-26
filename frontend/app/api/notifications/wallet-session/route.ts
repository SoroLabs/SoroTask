import { NextResponse } from "next/server";
import {
  createWalletSession,
  getWalletAddress,
  isSameOriginMutation,
  revokeWalletSession,
  walletSessionCookie,
} from "@/src/lib/server/notification-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const address = await getWalletAddress(request);
    if (!address) return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    return NextResponse.json({ address }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load notification wallet session", error);
    return NextResponse.json({ error: "Notification storage is unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      address?: unknown;
      challenge?: unknown;
      signature?: unknown;
    };
    if (
      typeof body.address !== "string" ||
      typeof body.challenge !== "string" ||
      typeof body.signature !== "string" ||
      body.challenge.length > 2048 ||
      body.signature.length > 256
    ) {
      return NextResponse.json({ error: "Invalid wallet proof" }, { status: 400 });
    }

    const token = await createWalletSession(
      body.address,
      body.challenge,
      body.signature,
    );
    const response = NextResponse.json({ connected: true });
    response.headers.set(
      "Set-Cookie",
      walletSessionCookie(token, process.env.NODE_ENV === "production"),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet proof failed";
    if (
      message === "Wallet challenge expired or already used" ||
      message === "A valid Stellar public key is required" ||
      message === "Wallet signature is invalid"
    ) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    console.error("Failed to verify notification wallet proof", error);
    return NextResponse.json({ error: "Notification storage is unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }
  try {
    await revokeWalletSession(request);
    const response = NextResponse.json({ connected: false });
    response.headers.set(
      "Set-Cookie",
      "sorotask_notification_session=; HttpOnly; SameSite=Strict; Path=/api/notifications; Max-Age=0" +
        (process.env.NODE_ENV === "production" ? "; Secure" : ""),
    );
    return response;
  } catch (error) {
    console.error("Failed to revoke notification wallet session", error);
    return NextResponse.json({ error: "Unable to disconnect wallet" }, { status: 503 });
  }
}
