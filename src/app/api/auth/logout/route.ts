import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/deps";
import { clearSessionCookie, errors, json, sameOrigin } from "@/lib/http";
import { SESSION_COOKIE, destroySession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errors.forbidden();
  await destroySession(getDeps(), (await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return json({ ok: true });
}
