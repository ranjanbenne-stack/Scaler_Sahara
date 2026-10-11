/**
 * DEMO DATA ONLY. Refuses to run unless DEMO_MODE=true and NODE_ENV != production.
 *   npm run db:seed-demo
 * Creates a demo child login and a clearly-labelled "[DEMO]" household with
 * sample requests. Demo records are never presented as live data: the household
 * name carries the [DEMO] prefix and the dashboard shows a DEMO banner.
 */
import "./load-env";
import { getDeps } from "../src/lib/deps";
import { hashPassword } from "../src/lib/auth/crypto";
import { nextRequestReference } from "../src/lib/requests/reference";

async function main() {
  const deps = getDeps();
  if (!deps.config.DEMO_MODE || deps.config.NODE_ENV === "production") {
    throw new Error("Refusing to seed: set DEMO_MODE=true in a non-production environment.");
  }
  const email = "demo.child@example.test";
  const existing = await deps.db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Demo data already present. Log in as ${email}.`);
    return;
  }
  const password = process.env.DEMO_PASSWORD || "demo-password-123";
  const child = await deps.db.user.create({ data: { displayName: "Demo Child", email, passwordHash: await hashPassword(password) } });
  const parent = await deps.db.user.create({ data: { displayName: "Demo Parent" } });
  const household = await deps.db.household.create({ data: { name: "[DEMO] Sharma Household" } });
  await deps.db.householdMembership.createMany({
    data: [
      { householdId: household.id, userId: child.id, role: "CHILD", isEmergencyContact: true, escalationOrder: 1 },
      { householdId: household.id, userId: parent.id, role: "PARENT" },
    ],
  });
  const now = Date.now();
  const samples = [
    { msg: "I need an electrician to come and check the fan in my bedroom.", category: "home_maintenance", serviceType: "electrician", issueSummary: "Bedroom fan needs inspection", urgency: "routine" as const, status: "RECEIVED" as const, ago: 3600_000 },
    { msg: "My blood pressure tablets will finish in two days", category: "medicine_refill", serviceType: "pharmacy", issueSummary: "Blood pressure medication running out", urgency: "time_sensitive" as const, status: "RECEIVED" as const, ago: 7200_000 },
  ];
  for (const s of samples) {
    const req = await deps.db.$transaction(async (tx) => {
      const reference = await nextRequestReference(tx);
      const created = await tx.request.create({
        data: {
          reference,
          householdId: household.id,
          parentUserId: parent.id,
          originalMessage: s.msg,
          category: s.category,
          serviceType: s.serviceType,
          issueSummary: s.issueSummary,
          urgency: s.urgency,
          confidence: 0.9,
          status: s.status,
          detectionSource: "LLM",
          classificationMeta: { demo: true },
          createdAt: new Date(now - s.ago),
        },
      });
      return created;
    });
    await deps.db.requestEvent.createMany({
      data: [
        { requestId: req.id, type: "RECEIVED", data: { demo: true }, createdAt: new Date(now - s.ago) },
        { requestId: req.id, type: "CLASSIFIED", data: { demo: true, category: s.category }, createdAt: new Date(now - s.ago + 1500) },
      ],
    });
  }
  console.log(`Demo data created. Log in at ${deps.config.APP_BASE_URL}/login as ${email} / ${password === "demo-password-123" ? "(DEMO_PASSWORD default — see README)" : "(DEMO_PASSWORD)"}`);
  await deps.db.$disconnect();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
