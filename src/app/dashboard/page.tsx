"use client";

import { usePoll } from "@/components/usePoll";
import RequestsTable from "@/components/RequestsTable";
import type { RequestRow } from "@/components/format";

interface Overview {
  stats: { open: number; attention: number; activeEmergencies: number };
  recent: RequestRow[];
  activeEmergencies: RequestRow[];
}

export default function OverviewPage() {
  const { data, error } = usePoll<Overview>("/api/overview", 4000);

  return (
    <>
      <h1>Overview</h1>
      {error && <p className="error">{error}</p>}
      <div className="stats">
        <div className="card stat"><div className="value">{data?.stats.open ?? "—"}</div><div className="label">Open requests</div></div>
        <div className="card stat"><div className="value">{data?.stats.attention ?? "—"}</div><div className="label">Requiring attention</div></div>
        <div className={`card stat ${data && data.stats.activeEmergencies > 0 ? "emergency" : ""}`}>
          <div className="value">{data?.stats.activeEmergencies ?? "—"}</div>
          <div className="label">Active emergency alerts</div>
        </div>
      </div>
      <h2>Recent requests</h2>
      {data ? <RequestsTable rows={data.recent} /> : <p className="muted">Loading…</p>}
      <p className="muted" style={{ fontSize: "0.82rem" }}>Updates automatically every few seconds.</p>
    </>
  );
}
