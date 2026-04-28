import { auth } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;

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
    return NextResponse.redirect(signInUrl);
  }

  // If user is authenticated and trying to access sign-in page
  if (isAuthenticated && pathname === "/auth/signin") {
    // Check if there's a callback URL to redirect to
    const redirectTo = req.nextUrl.searchParams.get("callbackUrl") || "/";
    return NextResponse.redirect(new URL(redirectTo, req.url));
  }

  // If user is authenticated and trying to access error page, redirect to home
  if (isAuthenticated && pathname === "/auth/error") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
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
