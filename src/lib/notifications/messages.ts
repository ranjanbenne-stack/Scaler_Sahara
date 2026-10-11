/**
 * Notification copy. Plain text (no parse_mode) so user content can never
 * break formatting. NEVER claim a booking, dispatch or resolution occurred.
 */

const URGENCY_LABEL: Record<string, string> = {
  routine: "Routine",
  time_sensitive: "Time-sensitive",
  urgent: "Urgent",
  emergency: "Emergency",
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTime(d: Date): string {
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.TZ || "UTC" }) +
    (process.env.TZ ? "" : " UTC");
}

export interface RequestSummary {
  reference: number;
  category: string;
  serviceType: string | null;
  issueSummary: string | null;
  urgency: string;
  createdAt: Date;
  parentName: string;
  householdName: string;
}

export function requestLink(baseUrl: string, requestId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/dashboard/requests/${requestId}`;
}

export function normalRequestMessage(r: RequestSummary, link: string): string {
  const what = r.serviceType ? `${titleCase(r.serviceType)} needed` : titleCase(r.category);
  return [
    "SAHARA | NON-EMERGENCY",
    `A new request was received from your parent (${r.parentName}).`,
    `Request: ${what}`,
    `Issue: ${r.issueSummary ?? "See dashboard"}`,
    `Urgency: ${URGENCY_LABEL[r.urgency] ?? r.urgency}`,
    `Reference: #${r.reference}`,
    "No service has been booked. Open the SAHARA dashboard to view the request:",
    link,
  ].join("\n");
}

export function attentionMessage(r: RequestSummary, reason: string, link: string): string {
  return [
    "⚠️ SAHARA | NEEDS YOUR ATTENTION",
    `Your parent (${r.parentName}) sent a message that may need prompt attention.`,
    `Reason: ${reason}`,
    `Summary: ${r.issueSummary ?? "See dashboard"}`,
    `Time received: ${formatTime(r.createdAt)}`,
    `Reference: #${r.reference}`,
    "Please check on your parent and review the request:",
    link,
  ].join("\n");
}

export function emergencyMessage(r: RequestSummary, link: string, opts: { isSos: boolean; escalationRound?: number }): string {
  const header = opts.isSos ? "🚨🚨 SAHARA EMERGENCY — SOS 🚨🚨" : "🚨🚨 SAHARA EMERGENCY ALERT 🚨🚨";
  const lines = [header];
  if (opts.escalationRound && opts.escalationRound > 0) {
    lines.push(`⏰ ESCALATION (round ${opts.escalationRound}) — this alert has NOT been acknowledged yet.`);
  }
  lines.push(
    opts.isSos
      ? `Your parent (${r.parentName}) has sent an SOS.`
      : `Your parent (${r.parentName}) sent an emergency message.`,
    `Household: ${r.householdName}`,
    `Time received: ${formatTime(r.createdAt)}`,
    "Status: Emergency alert raised — NOT yet acknowledged",
    "Action: Contact your parent immediately and arrange appropriate assistance.",
    "SAHARA has not contacted emergency services.",
    "Open the SAHARA dashboard to acknowledge this alert:",
    link,
  );
  return lines.join("\n");
}

export function parentReceiptMessage(kind: "normal" | "attention" | "emergency", reference: number): string {
  switch (kind) {
    case "emergency":
      return `SAHARA: Your SOS was received and your family is being alerted now (ref #${reference}). If you are in danger, call your local emergency number.`;
    case "attention":
      return `SAHARA: We received your message and have alerted your family to check on you (ref #${reference}). If this is an emergency, send SOS or call your local emergency number.`;
    default:
      return `SAHARA: We received your request and shared it with your family (ref #${reference}). Nothing has been booked yet.`;
  }
}

export function emergencyAckToParentMessage(responderName: string): string {
  return `SAHARA: ${responderName} has seen your SOS alert and is responding.`;
}
