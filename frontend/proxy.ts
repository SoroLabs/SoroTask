import { auth } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateCsp } from "@/lib/csp-generator";

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function addSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;
  const nonce = createNonce();
  const isDev = process.env.NODE_ENV === "development";
  const csp = generateCsp({
    nonce,
    isDev,
    extraDirectives: {
      "connect-src": [
        "https://*.stellar.org",
        "https://*.soroban.org",
        "https://soroban-testnet.stellar.org",
        "https://horizon-testnet.stellar.org",
        "https://*.sentry.io",
        "wss://*.stellar.org",
        `wss://${req.nextUrl.host}`,
        ...(isDev ? ["http://localhost:*", "ws://localhost:*"] : []),
      ],
      ...(!isDev ? { "upgrade-insecure-requests": [] } : {}),
    },
  });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // Public routes that don't require authentication
  const publicRoutes = ["/", "/auth/signin", "/auth/error"];
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(route));

  // Handle callback URL preservation
  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") || pathname;

  // If user is not authenticated and trying to access a protected route
  if (!isAuthenticated && !isPublicRoute) {
    const signInUrl = new URL("/auth/signin", req.url);
    // Preserve the intended destination for redirect after login
    signInUrl.searchParams.set("callbackUrl", callbackUrl);
    return addSecurityHeaders(NextResponse.redirect(signInUrl), csp);
  }

  // If user is authenticated and trying to access sign-in page
  if (isAuthenticated && pathname === "/auth/signin") {
    // Check if there's a callback URL to redirect to
    const redirectTo = req.nextUrl.searchParams.get("callbackUrl") || "/";
    return addSecurityHeaders(NextResponse.redirect(new URL(redirectTo, req.url)), csp);
  }

  // If user is authenticated and trying to access error page, redirect to home
  if (isAuthenticated && pathname === "/auth/error") {
    return addSecurityHeaders(NextResponse.redirect(new URL("/", req.url)), csp);
  }

  return addSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp,
  );
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/auth (NextAuth.js routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
