import { offersForRequest } from "@/lib/booking/catalog";

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function label(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export interface RequestRow {
  id: string;
  reference: number;
  createdAt: string;
  originalMessage: string;
  category: string;
  serviceType: string | null;
  issueSummary: string | null;
  urgency: string;
  isEmergency: boolean;
  needsReview: boolean;
  status: string;
  acknowledgedAt: string | null;
  escalationLevel: number;
  parent: { id: string; displayName: string };
  household: { id: string; name: string };
  booking?: {
    status: string;
    serviceLabel: string;
    helperLabel: string;
    visitLabel: string;
    estimatedCostInr: number;
  } | null;
}

export function careChip(r: Pick<RequestRow, "isEmergency" | "status" | "category" | "serviceType" | "issueSummary" | "originalMessage" | "booking">): { tone: string; text: string } {
  if (r.isEmergency && r.status === "ESCALATED") return { tone: "alert", text: "Needs you" };
  if (r.booking?.status === "EN_ROUTE") return { tone: "progress", text: "On the way" };
  if (r.booking?.status === "CONFIRMED" || r.booking?.status === "BOOKED") return { tone: "assigned", text: "Visit booked" };
  if (r.booking?.status === "COMPLETED" || r.status === "CLOSED") return { tone: "done", text: "Complete" };
  const bookable = offersForRequest(r).length > 0 && r.booking?.status !== "CANCELLED";
  if (bookable && !r.booking) return { tone: "approval", text: "Approval required" };
  if (r.booking?.status === "CANCELLED") return { tone: "approval", text: "Book again" };
  return { tone: "open", text: label(r.status) };
}
