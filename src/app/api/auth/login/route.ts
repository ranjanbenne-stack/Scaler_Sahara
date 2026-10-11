import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDeps } from "@/lib/deps";
import { clientIp, errors, json, sameOrigin, setSessionCookie } from "@/lib/http";
import { verifyPassword } from "@/lib/auth/crypto";
import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errors.forbidden();
  const deps = getDeps();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest();

  const limit = deps.config.RATE_LIMIT_LOGIN_ATTEMPTS_PER_15_MIN;
  const okIp = await rateLimit(deps, `login-ip:${clientIp(req)}`, limit * 3, 15 * 60_000);
  const okUser = await rateLimit(deps, `login-user:${parsed.data.email}`, limit, 15 * 60_000);
  if (!okIp || !okUser) return errors.tooMany();

  const user = await deps.db.user.findUnique({ where: { email: parsed.data.email } });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);
  if (!user || !valid) return json({ error: "invalid_credentials" }, { status: 401 });

  const { token, expiresAt } = await createSession(deps, user.id);
  await setSessionCookie(token, expiresAt);
  return json({ ok: true });
}
