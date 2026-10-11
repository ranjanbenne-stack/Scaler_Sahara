"use client";

import Link from "next/link";
import { usePoll } from "./usePoll";
import { ago, fmtTime, type RequestRow } from "./format";

/** Shown on every dashboard page while any emergency is unacknowledged. */
export default function EmergencyBanner() {
  const { data } = usePoll<{ activeEmergencies: RequestRow[] }>("/api/overview", 4000);
  const active = data?.activeEmergencies ?? [];
  if (active.length === 0) return null;

  return (
    <div role="alert" aria-live="assertive">
      {active.map((r) => (
        <div key={r.id} className="alert-banner">
          <div className="title">🚨 EMERGENCY — {r.issueSummary?.startsWith("SOS") ? "SOS" : "ALERT"} — NOT ACKNOWLEDGED</div>
          <div>
            {r.parent.displayName} · {r.household.name} · received {fmtTime(r.createdAt)} ({ago(r.createdAt)})
            {r.escalationLevel > 0 && <> · escalation round {r.escalationLevel}</>}
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <Link href={`/dashboard/requests/${r.id}`}>Open and acknowledge →</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
