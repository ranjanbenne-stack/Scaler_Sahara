"use client";

import Link from "next/link";
import { fmtTime, label, type RequestRow } from "./format";

export default function RequestsTable({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) return <p className="muted card">No requests yet. Requests appear here automatically when your parent messages the SAHARA bot.</p>;
  return (
    <table className="responsive">
      <thead>
        <tr>
          <th>Ref</th>
          <th>Received</th>
          <th>Request</th>
          <th>Category</th>
          <th>Urgency</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.isEmergency ? "emergency-row" : undefined}>
            <td data-label="Ref"><Link href={`/dashboard/requests/${r.id}`}>#{r.reference}</Link></td>
            <td data-label="Received">{fmtTime(r.createdAt)}</td>
            <td data-label="Request">
              {r.isEmergency && <span className="badge emergency">🚨 EMERGENCY</span>}{" "}
              <Link href={`/dashboard/requests/${r.id}`}>{r.issueSummary ?? r.originalMessage.slice(0, 80)}</Link>
              <div className="muted" style={{ fontSize: "0.82rem" }}>{r.parent.displayName} · {r.household.name}</div>
            </td>
            <td data-label="Category">{label(r.category)}{r.serviceType ? ` · ${label(r.serviceType)}` : ""}</td>
            <td data-label="Urgency"><span className={`badge ${r.urgency}`}>{label(r.urgency)}</span></td>
            <td data-label="Status">
              <span className={`badge ${r.status}`}>{label(r.status)}</span>
              {r.needsReview && r.status !== "NEEDS_REVIEW" && <> <span className="badge NEEDS_REVIEW">Review</span></>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
