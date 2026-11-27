export type ExternalChannelId = "webhook" | "telegram" | "discord";

export type ExternalChannelConfig = {
  url: string;
  secret: string;
};

/**
 * Validate an endpoint before it is sent to the server. Server delivery also
 * resolves and pins public DNS addresses to prevent SSRF and DNS rebinding.
 */
export function validateNotificationEndpointUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a valid HTTPS endpoint URL";
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isIpAddress =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  const blockedSuffixes = [
    ".localhost",
    ".local",
    ".internal",
    ".test",
    ".lan",
    ".invalid",
  ];

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isIpAddress ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    blockedSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    return "Use an HTTPS URL with a public hostname (local and IP addresses are not allowed)";
  }

  return null;
}
