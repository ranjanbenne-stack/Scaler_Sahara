export interface ServiceOffer {
  code: string;
  label: string;
  helperLabel: string;
  estimatedCostInr: number;
  includes: string;
  keywords: string[];
}

export const VISIT_SLOTS = [
  { id: "today_afternoon", label: "Today · 2:00–5:00 PM" },
  { id: "tomorrow_morning", label: "Tomorrow · 9:00 AM–12:00 PM" },
  { id: "tomorrow_afternoon", label: "Tomorrow · 2:00–5:00 PM" },
  { id: "weekend_morning", label: "This weekend · 10:00 AM–1:00 PM" },
] as const;

export type VisitSlotId = (typeof VISIT_SLOTS)[number]["id"];

const OFFERS: ServiceOffer[] = [
  {
    code: "electrician",
    label: "Electrician",
    helperLabel: "Electrician visit",
    estimatedCostInr: 850,
    includes: "Includes the visit and basic labour",
    keywords: ["electric", "fan", "light", "switch", "wiring", "socket", "power", "mcb", "tube light"],
  },
  {
    code: "plumber",
    label: "Plumber",
    helperLabel: "Plumber visit",
    estimatedCostInr: 750,
    includes: "Includes the visit and basic labour",
    keywords: ["plumb", "tap", "leak", "pipe", "drain", "toilet", "faucet", "cistern"],
  },
  {
    code: "carpenter",
    label: "Carpenter",
    helperLabel: "Carpenter visit",
    estimatedCostInr: 900,
    includes: "Includes the visit and basic labour",
    keywords: ["carpent", "door", "cupboard", "wardrobe", "furniture", "hinge"],
  },
  {
    code: "appliance",
    label: "Appliance repair",
    helperLabel: "Appliance technician",
    estimatedCostInr: 1100,
    includes: "Includes the visit and a basic diagnosis",
    keywords: ["appliance", "washing machine", "fridge", "refriger", "geyser", "mixer", "microwave"],
  },
  {
    code: "handyman",
    label: "Handyman",
    helperLabel: "Handyman visit",
    estimatedCostInr: 700,
    includes: "Includes the visit and basic labour",
    keywords: ["handyman", "handy man", "odd job"],
  },
  {
    code: "tech_visit",
    label: "Tech support visit",
    helperLabel: "Tech support visit",
    estimatedCostInr: 600,
    includes: "Includes a home visit for phone, TV, or Wi-Fi help",
    keywords: ["wifi", "wi-fi", "laptop", "computer", "television"],
  },
];

const NOT_A_VISIT = new Set([
  "medical_appointment",
  "medical_transport",
  "medical_companion",
  "medicine_refill",
  "medical_emergency",
  "general_emergency",
  "utility_payment",
  "bill_reminder",
]);

export interface OfferInput {
  category: string;
  serviceType: string | null;
  issueSummary: string | null;
  originalMessage: string;
  isEmergency: boolean;
  status: string;
}

/** Visits a child can book for this request. Empty when it is not a handyman-style job. */
export function offersForRequest(input: OfferInput): ServiceOffer[] {
  if (input.isEmergency || input.status === "CLOSED" || input.status === "ESCALATED") return [];
  if (NOT_A_VISIT.has(input.category)) return [];

  const text = `${input.serviceType ?? ""} ${input.issueSummary ?? ""} ${input.originalMessage}`.toLowerCase();
  const matched = OFFERS.filter((offer) => offer.keywords.some((word) => text.includes(word)));

  if (input.category === "technology_support") {
    const tech = OFFERS.filter((offer) => offer.code === "tech_visit" || offer.code === "handyman");
    return uniqueOffers([...matched, ...tech]);
  }
  if (input.category === "home_maintenance") {
    const home = OFFERS.filter((offer) => offer.code !== "tech_visit");
    return uniqueOffers([...matched, ...home]);
  }
  return matched;
}

export function offerByCode(code: string): ServiceOffer | undefined {
  return OFFERS.find((offer) => offer.code === code);
}

export function visitSlot(id: string): (typeof VISIT_SLOTS)[number] | undefined {
  return VISIT_SLOTS.find((slot) => slot.id === id);
}

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function uniqueOffers(offers: ServiceOffer[]): ServiceOffer[] {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    if (seen.has(offer.code)) return false;
    seen.add(offer.code);
    return true;
  });
}
