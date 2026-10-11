"use client";

import { useState } from "react";
import { formatInr, offersForRequest, VISIT_SLOTS, type ServiceOffer } from "@/lib/booking/catalog";
import { fmtTime } from "./format";

interface Booking {
  serviceCode: string;
  serviceLabel: string;
  helperLabel: string;
  visitLabel: string;
  estimatedCostInr: number;
  includes: string;
  question: string | null;
  status: string;
  createdAt: string;
}

interface RequestBits {
  id: string;
  reference: number;
  createdAt: string;
  originalMessage: string;
  category: string;
  serviceType: string | null;
  issueSummary: string | null;
  isEmergency: boolean;
  status: string;
  parent: { displayName: string };
  household: { name: string };
  booking: Booking | null;
}

const ACTIVE = new Set(["BOOKED", "CONFIRMED", "EN_ROUTE"]);

export function VisitTimeline({ request }: { request: RequestBits }) {
  const booking = request.booking && request.booking.status !== "CANCELLED" ? request.booking : null;
  const rank = booking ? ["BOOKED", "CONFIRMED", "EN_ROUTE", "COMPLETED"].indexOf(booking.status) : -1;
  const steps = [
    { title: "Request received", detail: `${fmtTime(request.createdAt)} · From ${request.parent.displayName}`, on: true },
    { title: "Visit booked", detail: booking ? `${booking.visitLabel} · ${formatInr(booking.estimatedCostInr)}` : "Choose a time and approve the visit", on: rank >= 0 },
    { title: "Helper confirmed", detail: rank >= 1 ? booking?.helperLabel ?? "Confirmed" : "When you have lined up the visit", on: rank >= 1 },
    { title: "On the way", detail: rank >= 2 ? "You marked the visit as on the way" : "Update this when they leave", on: rank >= 2 },
    { title: "Visit complete", detail: rank >= 3 ? "Closed" : "Mark complete when the work is done", on: rank >= 3 },
  ];
  const current = steps.findIndex((step) => !step.on);

  return (
    <section className="card care-panel">
      <p className="eyebrow">Live task timeline</p>
      <h2 style={{ marginTop: 0 }}>{request.issueSummary ?? request.booking?.serviceLabel ?? "Request"}</h2>
      <p className="muted">Request #{request.reference} · {request.household.name}</p>
      {request.booking?.status === "CANCELLED" && <p className="error">The last visit was cancelled. You can book another time.</p>}
      <ol className="visit-timeline">
        {steps.map((step, i) => (
          <li key={step.title} className={step.on ? "done" : i === current ? "current" : "upcoming"}>
            <strong>{step.title}</strong>
            <span>{step.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function BookingPanel({ request, onChange }: { request: RequestBits; onChange: () => Promise<void> | void }) {
  const offers = offersForRequest(request);
  const active = request.booking && ACTIVE.has(request.booking.status) ? request.booking : null;
  const [serviceCode, setServiceCode] = useState(offers[0]?.code ?? "");
  const [visitId, setVisitId] = useState<string>(VISIT_SLOTS[0].id);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (offers.length === 0 && !request.booking) return null;
  const selected: ServiceOffer | undefined = offers.find((offer) => offer.code === serviceCode) ?? offers[0];

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError("That did not go through. Please try again.");
      return false;
    }
    await onChange();
    return true;
  }

  return (
    <section className="card care-panel">
      <p className="eyebrow">{active ? "Visit booked" : "Action required"}</p>
      {active ? (
        <>
          <h2 style={{ marginTop: 0 }}>{active.serviceLabel}</h2>
          <p className="muted">{request.household.name}</p>
          <p className="price">{formatInr(active.estimatedCostInr)}</p>
          <p className="muted">{active.includes}. {active.visitLabel}.</p>
          <div className="row">
            {active.status === "BOOKED" && <button disabled={busy} onClick={() => post(`/api/requests/${request.id}/booking`, { action: "confirm" })}>Helper confirmed</button>}
            {(active.status === "BOOKED" || active.status === "CONFIRMED") && (
              <button disabled={busy} onClick={() => post(`/api/requests/${request.id}/booking`, { action: "en_route" })}>On the way</button>
            )}
            <button disabled={busy} onClick={() => post(`/api/requests/${request.id}/booking`, { action: "complete" })}>Visit complete</button>
            <button className="secondary" disabled={busy} onClick={() => post(`/api/requests/${request.id}/booking`, { action: "cancel" })}>Cancel visit</button>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>Update the timeline as the visit moves. Your parent is told on Telegram when they have started the bot. SAHARA does not take payment or send a helper by itself.</p>
        </>
      ) : request.booking?.status === "COMPLETED" ? (
        <>
          <h2 style={{ marginTop: 0 }}>{request.booking.serviceLabel} complete</h2>
          <p className="muted">{request.booking.visitLabel} · {formatInr(request.booking.estimatedCostInr)}</p>
        </>
      ) : selected ? (
        <>
          <h2 style={{ marginTop: 0 }}>{selected.label}</h2>
          <p className="muted">{request.household.name}{request.issueSummary ? ` · ${request.issueSummary}` : ""}</p>
          <p className="price">{formatInr(selected.estimatedCostInr)}</p>
          <p className="muted">{selected.includes}</p>
          {offers.length > 1 && (
            <label>
              Service
              <select value={selected.code} onChange={(e) => setServiceCode(e.target.value)}>
                {offers.map((offer) => (
                  <option key={offer.code} value={offer.code}>{offer.label} · {formatInr(offer.estimatedCostInr)}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Visit time
            <select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
              {VISIT_SLOTS.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
            </select>
          </label>
          <div className="row">
            <button disabled={busy} onClick={() => post(`/api/requests/${request.id}/book`, { serviceCode: selected.code, visitId })}>
              {busy ? "Booking…" : "Approve and book"}
            </button>
            <button className="secondary" type="button" onClick={() => setAsking((v) => !v)}>Ask a question</button>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>The estimate is for the visit and basic labour. Nothing is paid in SAHARA, and a helper is not dispatched automatically. Your parent gets a Telegram message with the time you chose.</p>
        </>
      ) : null}

      {asking && (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await post(`/api/requests/${request.id}/question`, { question });
            if (ok) {
              setQuestion("");
              setAsking(false);
              setNote("Question sent to your parent.");
            }
          }}
        >
          <label>
            Question for {request.parent.displayName}
            <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} required placeholder="Which room is the fan in?" />
          </label>
          <div><button type="submit" disabled={busy}>Send question</button></div>
        </form>
      )}
      {request.booking?.question && <p><strong>Last question:</strong> {request.booking.question}</p>}
      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
