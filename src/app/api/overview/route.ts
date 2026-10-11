import { getDeps } from "@/lib/deps";
import { currentUser, errors, json } from "@/lib/http";
import { listRequestsForUser, overviewForUser } from "@/lib/requests/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const deps = getDeps();
  const [stats, recent, emergencies] = await Promise.all([
    overviewForUser(deps, user.id),
    listRequestsForUser(deps, user.id, { limit: 8 }),
    listRequestsForUser(deps, user.id, { emergencyOnly: true, status: "ESCALATED", limit: 20 }),
  ]);
  return json({ stats, recent, activeEmergencies: emergencies, serverTime: new Date().toISOString() });
}
