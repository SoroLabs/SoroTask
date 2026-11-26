import { IdentityError } from "./social-provider-verification";

/** Limit bytes while streaming, including requests without Content-Length. */
export async function readIdentityRequest(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 8_192) throw new IdentityError("request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new IdentityError("invalid_request");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8_192) {
        await reader.cancel();
        throw new IdentityError("request_too_large", 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new IdentityError("invalid_request");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError("invalid_request");
  } finally { reader.releaseLock(); }
}
