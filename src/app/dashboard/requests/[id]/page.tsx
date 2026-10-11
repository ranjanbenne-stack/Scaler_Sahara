"use client";

import { use, useState } from "react";
import Link from "next/link";
import { usePoll } from "@/components/usePoll";
import { fmtTime, label } from "@/components/format";

interface Detail {
  request: {
    id: string;
    reference: number;
    createdAt: string;
    updatedAt: string;
    originalMessage: string;
    category: string;
    serviceType: string | null;
    issueSummary: string | null;
    urgency: string;
    isEmergency: boolean;
    confidence: number | null;
    needsReview: boolean;
    clarificationQuestion: string | null;
    status: string;
    detectionSource: string;
    classificationMeta: Record<string, unknown> | null;
    acknowledgedAt: string | null;
    escalationLevel: number;
    nextEscalationAt: string | null;
    parent: { displayName: string };
    household: { name: string };
    acknowledgedBy: { displayName: string } | null;
    events: { id: string; type: string; createdAt: string; data: Record<string, unknown> | null }[];
    notifications: {
      id: string;
      kind: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      sentAt: string | null;
      createdAt: string;
      nextAttemptAt: string;
      recipient: { displayName: string };
    }[];
  };
}

const DETECTION_LABEL: Record<string, string> = {
  RULE_SOS: "Deterministic rule — SOS keyword (LLM not used)",
  RULE_PHRASE: "Deterministic rule — emergency phrase (LLM not used)",
  RULE_POSSIBLE: "Deterministic rule — possible emergency signal, plus classifier",
  LLM: "LLM classifier",
  FALLBACK: "Fallback — not classified automatically",
};

function eventText(e: Detail["request"]["events"][number]): string {
  const d = e.data ?? {};
  switch (e.type) {
    case "CLASSIFIED": return `Classified as ${label(String(d.category))}, ${label(String(d.urgency))} (confidence ${d.confidence ?? "?"}, ${d.provider ?? ""})`;
    case "CLASSIFICATION_FAILED": return `Classification failed: ${d.error ?? "unknown error"}`;
    case "EMERGENCY_DETECTED": return `Emergency detected (${d.rule ?? d.source ?? "rule"}${d.matched ? `: "${d.matched}"` : ""})`;
    case "POSSIBLE_EMERGENCY_DETECTED": return `Possible emergency signal ("${d.matched}") — urgency floored at Urgent`;
    case "ESCALATION_ROUND": return `Escalation round ${d.round} (${label(String(d.mode))})`;
    case "NOTIFICATION_QUEUED": return `Notification queued (${label(String(d.kind))})`;
    case "NOTIFICATION_SENT": return `Notification delivered (${label(String(d.kind))}, attempt ${d.attempt})`;
    case "NOTIFICATION_FAILED": return `Notification failed (attempt ${d.attempt}) — will retry: ${d.error}`;
    case "NOTIFICATION_DEAD": return `Notification failed permanently: ${d.error}`;
    case "NOTIFICATION_FALLBACK": return `Delivery fallback: ${d.reason}`;
    case "ACKNOWLEDGED": return `Acknowledged by ${d.byName}`;
    case "NO_REACHABLE_CONTACT": return "No family member reachable on Telegram";
    default: return label(e.type);
  }
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = usePoll<Detail>(`/api/requests/${id}`, 3000);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  if (error && !data) {
    return (
      <div className="card">
        <h1>Request not available</h1>
        <p className="muted">It doesn't exist or you don't have access to it.</p>
        <Link href="/dashboard/requests">← Back to requests</Link>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;
  const r = data.request;
  const unacked = r.isEmergency && r.status === "ESCALATED";

  async function acknowledge() {
    setAckBusy(true);
    setAckError(null);
    const res = await fetch(`/api/requests/${id}/acknowledge`, { method: "POST" });
    setAckBusy(false);
    if (!res.ok) setAckError("Could not acknowledge. Please try again.");
    await reload();
  }

  return (
    <>
      <p><Link href="/dashboard/requests">← All requests</Link></p>

      {r.isEmergency && (
        <section className={`card ${unacked ? "emergency-panel" : ""}`} style={{ marginBottom: "1rem" }}>
          <h1>🚨 {r.detectionSource === "RULE_SOS" ? "SOS EMERGENCY" : "EMERGENCY ALERT"}</h1>
          <dl className="kv">
            <dt>Parent</dt><dd><strong>{r.parent.displayName}</strong></dd>
            <dt>Household</dt><dd>{r.household.name}</dd>
            <dt>Time received</dt><dd>{fmtTime(r.createdAt)}</dd>
            <dt>Escalation</dt>
            <dd>
              {unacked
                ? <>Round {r.escalationLevel}{r.nextEscalationAt ? ` · next escalation ${fmtTime(r.nextEscalationAt)}` : " · automatic re-alerts stopped"}</>
                : "Stopped (acknowledged)"}
            </dd>
            <dt>Acknowledgement</dt>
            <dd>
              {r.acknowledgedAt
                ? <span className="badge ACKNOWLEDGED">Acknowledged by {r.acknowledgedBy?.displayName} at {fmtTime(r.acknowledgedAt)}</span>
                : <span className="badge ESCALATED">NOT ACKNOWLEDGED</span>}
            </dd>
          </dl>
          {unacked && (
            <div style={{ marginTop: "1rem" }}>
              <p><strong>Contact your parent immediately and arrange appropriate assistance.</strong> SAHARA has not contacted emergency services.</p>
              <button className="danger" onClick={acknowledge} disabled={ackBusy}>
                {ackBusy ? "Acknowledging…" : "I'm responding — acknowledge alert"}
              </button>
              {ackError && <p className="error">{ackError}</p>}
            </div>
          )}
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Request #{r.reference}</h2>
          <p className="muted">From {r.parent.displayName} · {fmtTime(r.createdAt)}</p>
          <div className="quote">{r.originalMessage}</div>
          {r.clarificationQuestion && <p><strong>Suggested clarification:</strong> {r.clarificationQuestion}</p>}
          <p className="muted" style={{ fontSize: "0.85rem" }}>No service has been booked. SAHARA currently records and notifies only.</p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Classification</h2>
          <dl className="kv">
            <dt>Category</dt><dd>{label(r.category)}</dd>
            <dt>Service type</dt><dd>{label(r.serviceType)}</dd>
            <dt>Issue</dt><dd>{r.issueSummary ?? "—"}</dd>
            <dt>Urgency</dt><dd><span className={`badge ${r.urgency}`}>{label(r.urgency)}</span></dd>
            <dt>Emergency</dt><dd>{r.isEmergency ? "Yes" : "No"}</dd>
            <dt>Confidence</dt><dd>{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</dd>
            <dt>Status</dt><dd><span className={`badge ${r.status}`}>{label(r.status)}</span>{r.needsReview && <> <span className="badge NEEDS_REVIEW">Needs review</span></>}</dd>
            <dt>Detected by</dt><dd>{DETECTION_LABEL[r.detectionSource] ?? r.detectionSource}</dd>
          </dl>
        </section>
      </div>

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Event timeline</h2>
          <ul className="timeline">
            {r.events.map((e) => (
              <li key={e.id} className={/EMERGENCY|ESCALAT|DEAD|NO_REACHABLE/.test(e.type) ? "emergency" : undefined}>
                <div>{eventText(e)}</div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>{fmtTime(e.createdAt)}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Notification delivery</h2>
          {r.notifications.length === 0 ? (
            <p className="muted">No notifications.</p>
          ) : (
            <table className="responsive">
              <thead><tr><th>To</th><th>Type</th><th>Status</th><th>Attempts</th></tr></thead>
              <tbody>
                {r.notifications.map((n) => (
                  <tr key={n.id}>
                    <td data-label="To">{n.recipient.displayName}</td>
                    <td data-label="Type">{label(n.kind)}</td>
                    <td data-label="Status">
                      <span className={`badge ${n.status}`}>{label(n.status)}</span>
                      {n.sentAt && <div className="muted" style={{ fontSize: "0.78rem" }}>{fmtTime(n.sentAt)}</div>}
                      {n.lastError && n.status !== "SENT" && <div className="muted" style={{ fontSize: "0.78rem" }}>{n.lastError}</div>}
                    </td>
                    <td data-label="Attempts">{n.attempts}/{n.maxAttempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
