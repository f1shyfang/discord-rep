import { clerkMiddleware } from "@clerk/nextjs/server";

// Public pages stay accessible; tRPC protectedProcedure enforces authentication.
export default clerkMiddleware(
  () => {},
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
