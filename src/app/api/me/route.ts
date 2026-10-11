import { getDeps } from "@/lib/deps";
import { currentUser, errors, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current user + the households they can see (as CHILD), with member link status. */
export async function GET() {
  const user = await currentUser();
  if (!user) return errors.unauthorized();
  const deps = getDeps();
  const memberships = await deps.db.householdMembership.findMany({
    where: { userId: user.id, role: "CHILD" },
    include: {
      household: {
        include: {
          memberships: {
            include: { user: { select: { id: true, displayName: true, telegram: { select: { botStarted: true, linkedAt: true } } } } },
            orderBy: [{ role: "asc" }, { escalationOrder: "asc" }],
          },
        },
      },
    },
  });
  const me = await deps.db.user.findUniqueOrThrow({ where: { id: user.id }, include: { telegram: { select: { botStarted: true, linkedAt: true } } } });
  return json({
    user: { id: user.id, displayName: user.displayName, email: user.email, telegramLinked: Boolean(me.telegram), botStarted: me.telegram?.botStarted ?? false },
    demoMode: deps.config.DEMO_MODE,
    botUsername: deps.config.TELEGRAM_BOT_USERNAME || null,
    households: memberships.map((m) => ({
      id: m.household.id,
      name: m.household.name,
      members: m.household.memberships.map((hm) => ({
        membershipId: hm.id,
        userId: hm.user.id,
        displayName: hm.user.displayName,
        role: hm.role,
        isEmergencyContact: hm.isEmergencyContact,
        escalationOrder: hm.escalationOrder,
        telegramLinked: Boolean(hm.user.telegram),
        botStarted: hm.user.telegram?.botStarted ?? false,
      })),
    })),
  });
}
