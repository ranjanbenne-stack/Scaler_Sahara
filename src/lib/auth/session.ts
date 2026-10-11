import type { Deps } from "../deps";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "sahara_session";

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
}

/** Creates a session; returns the opaque token for the cookie. Only its hash is stored. */
export async function createSession(deps: Pick<Deps, "db" | "config" | "now">, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(deps.now().getTime() + deps.config.SESSION_TTL_HOURS * 3600_000);
  await deps.db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  return { token, expiresAt };
}

export async function getSessionUser(deps: Pick<Deps, "db" | "now">, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const session = await deps.db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt <= deps.now()) return null;
  return { id: session.user.id, displayName: session.user.displayName, email: session.user.email };
}

export async function destroySession(deps: Pick<Deps, "db">, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await deps.db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}
