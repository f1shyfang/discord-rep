import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public pages stay accessible; tRPC protectedProcedure enforces authentication.
export default clerkMiddleware(
  () => {
    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    // Proxy headers may replace a route's headers. Preserve SSE's no-transform
    // guarantee so compression/CDN transforms cannot buffer live event hints.
    response.headers.set("Cache-Control", "private, no-store, no-transform");
    return response;
  },
  () => ({
    // Read bindings per request: Worker secrets are unavailable at module load.
    authorizedParties:
      process.env.CLERK_SECRET_KEY?.startsWith("sk_live_") &&
      process.env.APP_ORIGIN
        ? [process.env.APP_ORIGIN]
        : undefined,
  }),
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
