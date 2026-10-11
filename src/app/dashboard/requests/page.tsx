"use client";

import { useState } from "react";
import { usePoll } from "@/components/usePoll";
import RequestsTable from "@/components/RequestsTable";
import type { RequestRow } from "@/components/format";

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "status=ESCALATED", label: "Active emergencies" },
  { value: "status=NEEDS_REVIEW", label: "Needs review" },
  { value: "status=RECEIVED", label: "Received" },
  { value: "emergency=1", label: "All emergencies" },
];

export default function RequestsPage() {
  const [filter, setFilter] = useState("");
  const { data, error } = usePoll<{ requests: RequestRow[] }>(`/api/requests${filter ? `?${filter}` : ""}`, 4000);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Requests</h1>
        <label style={{ flexDirection: "row", alignItems: "center" }}>
          Show&nbsp;
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {data ? <RequestsTable rows={data.requests} /> : <p className="muted">Loading…</p>}
    </>
  );
}
