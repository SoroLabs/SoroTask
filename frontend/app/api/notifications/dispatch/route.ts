import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  dispatchNotification,
  type NotificationDispatch,
} from "@/src/lib/server/notification-service";
import { notificationCategories } from "@/src/lib/notification-preferences";

export const runtime = "nodejs";

function isValidDeliveryToken(request: Request): boolean {
  const configured = process.env.NOTIFICATION_DELIVERY_TOKEN ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !provided) return false;
  const expectedBuffer = Buffer.from(configured);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export async function POST(request: Request) {
  if (!isValidDeliveryToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Partial<NotificationDispatch>;
    if (
      typeof body.recipient !== "string" ||
      !/^[G][A-Z2-7]{55}$/.test(body.recipient) ||
      typeof body.category !== "string" ||
      !notificationCategories.some((category) => category.id === body.category) ||
      typeof body.title !== "string" ||
      body.title.length > 160 ||
      typeof body.message !== "string" ||
      body.message.length > 4000
    ) {
      return NextResponse.json({ error: "Invalid notification payload" }, { status: 400 });
    }
    const results = await dispatchNotification(body as NotificationDispatch);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("Notification dispatch failed", error);
    return NextResponse.json({ error: "Notification delivery failed" }, { status: 503 });
  }
}
