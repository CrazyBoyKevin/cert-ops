import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken, shouldUseSecureCookie } from "@/lib/auth";
import { appRouteHref, readAppRoute, loginHref, safeReturnHref } from "@/lib/app-route";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  const finish = (response: NextResponse) => {
    if (session && token && shouldUseSecureCookie(request)) response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(session.expiresAt * 1000),
    });
    return response;
  };
  if (pathname === "/login") {
    return finish(session ? NextResponse.redirect(new URL(safeReturnHref(request.nextUrl.searchParams.get("next")), request.url)) : NextResponse.next());
  }
  if (!session) return NextResponse.redirect(new URL(loginHref(pathname + request.nextUrl.search), request.url));
  if (pathname === "/" && readAppRoute(request.nextUrl.searchParams).settings) {
    return finish(NextResponse.redirect(new URL(appRouteHref(readAppRoute(request.nextUrl.searchParams)), request.url)));
  }
  return finish(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
