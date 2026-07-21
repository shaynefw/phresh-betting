import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Read-only shared system views. Access is gated by an unguessable
  // share_token in the path; the page itself resolves the token and
  // 404s if it's missing or revoked. No sign-in required.
  "/share(.*)",
  // Next.js auto-generated metadata image routes. These are NOT static
  // files (no extension), so the matcher.config's asset exclusion can't
  // skip them — without explicit public-route whitelisting, Clerk
  // redirects them to /sign-in for unauthenticated requests, which
  // means social-media crawlers (Twitter, Slack, iMessage, Discord)
  // never get the PNG when someone shares a link. Allowing them public
  // is safe — these routes only render branded marketing imagery, no
  // user data.
  "/opengraph-image(.*)",
  "/twitter-image(.*)",
  "/apple-icon(.*)",
  "/icon(.*)",
  "/favicon(.*)",
]);

const PREVIEW = process.env.PREVIEW_MODE === "1";

const previewMiddleware = (_req: NextRequest) => NextResponse.next();

const realMiddleware = clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;
  const { userId } = await auth();
  if (!userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
});

export default PREVIEW ? previewMiddleware : realMiddleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
