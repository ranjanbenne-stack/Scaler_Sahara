"use client";

import Link from "next/link";
import { usePoll } from "@/components/usePoll";
import { careChip, fmtTime, type RequestRow } from "@/components/format";

interface Overview {
  stats: { open: number; attention: number; activeEmergencies: number; needsBooking: number; openTasks: number };
  recent: RequestRow[];
}

interface Me {
  user: { displayName: string };
  households: { name: string; members: { displayName: string; role: string }[] }[];
}

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

export default function OverviewPage() {
  const { data, error } = usePoll<Overview>("/api/overview", 4000);
  const me = usePoll<Me>("/api/me", 30000);
  const name = me.data?.user.displayName ?? "there";
  const parent = me.data?.households.flatMap((h) => h.members).find((m) => m.role === "PARENT");
  const recent = data?.recent[0];
  const needs = (data?.stats.needsBooking ?? 0) + (data?.stats.activeEmergencies ?? 0);
  const calm = needs === 0;

  return (
    <div className="care-home">
      <p className="eyebrow">Family view</p>
      <h1>At-a-glance care</h1>
      <p className="care-hello">{greeting(name)}</p>
      <p className="muted">Care update for {parent?.displayName ?? "your parent"}</p>
      {error && <p className="error">{error}</p>}

      <section className={`care-status ${data && data.stats.activeEmergencies > 0 ? "alert" : calm ? "ok" : "wait"}`}>
        <strong>
          {data && data.stats.activeEmergencies > 0
            ? "Your parent needs you now"
            : data && data.stats.needsBooking > 0
              ? "A home visit is waiting for your approval"
              : "No open emergencies"}
        </strong>
        <span>{recent ? `Last message · ${fmtTime(recent.createdAt)}` : "Messages from the SAHARA bot show up here."}</span>
      </section>

      <div className="care-stats">
        <div className="card stat">
          <div className="label">Open tasks</div>
          <div className="value">{data?.stats.openTasks ?? "—"}</div>
        </div>
        <div className={`card stat ${needs > 0 ? "attention" : ""}`}>
          <div className="label">Needs you</div>
          <div className="value">{data ? needs : "—"}</div>
        </div>
      </div>

      <h2>Recent requests</h2>
      {!data && <p className="muted">Loading…</p>}
      {data && data.recent.length === 0 && (
        <p className="muted card">No requests yet. When your parent asks for an electrician or another handyman, you can book the visit from here.</p>
      )}
      <div className="request-cards">
        {data?.recent.map((row) => {
          const chip = careChip(row);
          return (
            <Link key={row.id} href={`/dashboard/requests/${row.id}`} className={`request-card ${chip.tone}`}>
              <span>
                <strong>{row.issueSummary ?? row.booking?.serviceLabel ?? row.originalMessage.slice(0, 72)}</strong>
                <small>{row.parent.displayName} · {row.household.name}</small>
              </span>
              <em>{chip.text}</em>
            </Link>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: "0.82rem" }}>Updates automatically every few seconds. Estimates are not payments.</p>
    </div>
  );
}
