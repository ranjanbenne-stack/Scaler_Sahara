import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/deps";
import { currentUser, errors, json } from "@/lib/http";
import { listRequestsForUser } from "@/lib/requests/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["RECEIVED", "NEEDS_REVIEW", "ESCALATED", "ACKNOWLEDGED", "CLOSED"]);

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? undefined;
  if (status && !STATUSES.has(status)) return errors.badRequest();
  const requests = await listRequestsForUser(getDeps(), user.id, {
    status,
    emergencyOnly: sp.get("emergency") === "1",
    limit: Number(sp.get("limit") ?? 100) || 100,
  });
  return json({ requests });
}
