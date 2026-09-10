import { NextRequest, NextResponse } from "next/server";

// The local demo cannot reach scan, email, authentication or report APIs.
// Normal development and production keep their existing routing behavior.
export function proxy(request: NextRequest) {
  if (process.env.SCANRR_DEMO !== "1") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (!["GET", "HEAD"].includes(request.method)) {
    return NextResponse.json({ error: "Demo mode: live actions are disabled." }, { status: 403 });
  }
  if (path === "/") return NextResponse.redirect(new URL("/demo", request.url));
  if (path === "/demo" || path.startsWith("/_next/static/") || path === "/_next/webpack-hmr" || path === "/favicon.ico") {
    return NextResponse.next();
  }
  return NextResponse.json({ error: "Demo mode: only the sample report is available." }, { status: 403 });
}
