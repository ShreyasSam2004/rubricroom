import { NextResponse, type NextRequest } from "next/server";

export const WORKSPACE_COOKIE = "rr_ws";
const VALID = /^ws_[a-f0-9]{32}$/;

function newWorkspaceId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ws_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Every visitor gets an anonymous, unguessable workspace id (no login). It is the only key that
 * scopes their hackathons, ideas, debates and plans, so visitors never see each other's data.
 */
export function proxy(request: NextRequest) {
  const existing = request.cookies.get(WORKSPACE_COOKIE)?.value;
  if (existing && VALID.test(existing)) return NextResponse.next();

  const id = newWorkspaceId();
  const headers = new Headers(request.headers);
  const others = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${WORKSPACE_COOKIE}=`));
  headers.set("cookie", [...others, `${WORKSPACE_COOKIE}=${id}`].join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}

export const config = {
  // Static files (including the product tour video in /demo) don't need a workspace.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|demo/).*)"],
};
