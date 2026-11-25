/**
 * Socket Error Tracking
 *
 * Wraps socket.io-client to track connection issues,
 * disconnections, and communication errors.
 */

import { io, Socket } from "socket.io-client";
import { trackSocketError, trackSocketEvent } from "./tracking";

const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:3000";

/**
 * Create a tracked socket that logs all errors
 */
export function createTrackedSocket() {
  const socket = io(KEEPER_URL, {
    transports: ["websocket"],
    reconnection: false, // We manage reconnection manually
  });

  // Track connection
  socket.on("connect", () => {
    trackSocketEvent("connect", "received");
  });

  // Track disconnection
  socket.on("disconnect", (reason) => {
    trackSocketEvent("disconnect", "received", { reason });

    if (reason !== "io client disconnect") {
      // Unexpected disconnect - track as error
      trackSocketError(new Error(`Socket disconnected: ${reason}`), { reason });
    }
  });

  // Track connection errors
  socket.on("connect_error", (error) => {
    trackSocketError(error instanceof Error ? error : new Error(String(error)), {
      event: "connect_error",
    });
  });

  // Track all event errors
  socket.onAny((event, ...args) => {
    // Track custom events as breadcrumbs (optional, for debugging)
    if (process.env.NODE_ENV === "development") {
      trackSocketEvent(event, "received");
    }
  });

  return socket;
}

/**
 * Wrap a socket with error tracking middleware
 */
export function wrapSocketWithTracking(socket: Socket): Socket {
  // Add error listeners
  socket.on("error", (error) => {
    trackSocketError(error instanceof Error ? error : new Error(String(error)), {
      event: "socket_error",
    });
  });

  socket.on("reconnect_attempt", (attempt) => {
    trackSocketEvent("reconnect_attempt", "received", { attempt });
  });

  socket.on("reconnect_failed", () => {
    trackSocketError(new Error("Reconnection failed after maximum attempts"), {
      event: "reconnect_failed",
    });
  });

  return socket;
}

/**
 * Track socket subscription to events
 */
export function trackSocketSubscription(
  eventName: string,
  details?: Record<string, unknown>
) {
  trackSocketEvent(eventName, "subscribed", details);
}

/**
 * Track socket message send
 */
export function trackSocketMessage(eventName: string, data?: unknown) {
  const dataSize = data ? JSON.stringify(data).length : undefined;
  trackSocketEvent(eventName, "sent", dataSize ? { dataSize } : undefined);
}
