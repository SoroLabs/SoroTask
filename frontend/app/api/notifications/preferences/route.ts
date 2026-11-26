import { NextResponse } from "next/server";
import {
  getWalletAddress,
  isSameOriginMutation,
  readPreferences,
  writePreferences,
} from "@/src/lib/server/notification-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const address = await getWalletAddress(request);
    if (!address) return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    return NextResponse.json(await readPreferences(address), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load notification preferences", error);
    return NextResponse.json({ error: "Notification storage is unavailable" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  }
  try {
    const address = await getWalletAddress(request);
    if (!address) return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
    const preferences = await writePreferences(address, await request.json());
    return NextResponse.json(preferences, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save notification preferences";
    const isValidationError =
      message.startsWith("Notification preferences") ||
      message.startsWith("Invalid ") ||
      message.startsWith("Enter a valid");
    if (!isValidationError) {
      console.error("Failed to save notification preferences", error);
    }
    return NextResponse.json(
      { error: isValidationError ? message : "Notification storage is unavailable" },
      { status: isValidationError ? 400 : 503 },
    );
  }
}
