import "server-only";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDeps } from "./deps";
import { SESSION_COOKIE, getSessionUser, type SessionUser } from "./auth/session";

export function json(data: unknown, init?: ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { "content-type": "application/json", "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export const errors = {
  unauthorized: () => json({ error: "unauthorized" }, { status: 401 }),
  forbidden: () => json({ error: "forbidden" }, { status: 403 }),
  notFound: () => json({ error: "not_found" }, { status: 404 }),
  badRequest: (details?: unknown) => json({ error: "bad_request", details }, { status: 400 }),
  tooMany: () => json({ error: "rate_limited" }, { status: 429 }),
};

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(getDeps(), token);
}

/**
 * CSRF defence for cookie-authenticated mutations: SameSite=Lax cookies plus a
 * same-origin check on the Origin header.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
