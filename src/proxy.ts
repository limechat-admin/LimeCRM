import NextAuth, { type NextAuthRequest } from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authConfig, devUserEmail } from "@/server/auth.config";

const { auth } = NextAuth(authConfig);

// Only checks for a valid session cookie. Whether that person is still an active user is
// checked against the database in getCurrentUser (src/server/auth.ts).
// The unused event parameter selects auth()'s middleware overload over its route-handler one.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const onSession = (req: NextAuthRequest, _event: NextFetchEvent) => {
  if (req.auth?.user) return NextResponse.next();
  const url = new URL("/signin", req.nextUrl);
  url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
};
const requireSession = auth(onSession);

export function proxy(req: NextRequest, event: NextFetchEvent) {
  if (devUserEmail()) return NextResponse.next();
  return requireSession(req, event);
}

export const config = {
  // Everything except: /api/v1 (bearer token, src/server/api.ts), Auth.js's own routes, the
  // sign-in page, and static files (the sign-in page shows /limechat-icon.svg).
  matcher: [
    "/((?!api/v1(?:/|$)|api/auth(?:/|$)|signin(?:/|$)|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
