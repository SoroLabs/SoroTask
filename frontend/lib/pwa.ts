export interface BackgroundRequest {
  id: string;
  url: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export async function queueBackgroundRequest(request: BackgroundRequest): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Background requests require a service worker-capable browser.");
  }
  if (!request.id.trim()) throw new Error("Background request ID is required.");

  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) throw new Error("The SoroTask service worker is not active.");

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("Timed out while saving the offline request."));
    }, 5000);

    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean; error?: string }>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data.ok) resolve();
      else reject(new Error(event.data.error || "Failed to save the offline request."));
    };
    worker.postMessage({ type: "QUEUE_BACKGROUND_REQUEST", request }, [channel.port2]);
  });
}
