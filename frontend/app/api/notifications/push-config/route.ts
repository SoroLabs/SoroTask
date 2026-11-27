import { NextResponse } from "next/server";
import { getPublicPushKey } from "@/src/lib/server/notification-service";

export const runtime = "nodejs";

export async function GET() {
  const publicKey = getPublicPushKey();
  if (!publicKey) {
    return NextResponse.json({ error: "Web Push is not configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
