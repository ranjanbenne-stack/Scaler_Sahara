import { z } from "zod";

export const REQUEST_CATEGORIES = [
  "home_maintenance",
  "household_assistance",
  "medical_appointment",
  "medical_transport",
  "medical_companion",
  "medicine_refill",
  "technology_support",
  "utility_payment",
  "bill_reminder",
  "personal_assistance",
  "general_enquiry",
  "other",
] as const;

/** Emergency taxonomy — assigned by deterministic rules (or an LLM upgrade), never by user input. */
export const EMERGENCY_CATEGORIES = ["medical_emergency", "general_emergency"] as const;

/** Assigned when classification fails; the request is kept and flagged for review. */
export const FALLBACK_CATEGORY = "unclassified" as const;

export const ALL_CATEGORIES = [...REQUEST_CATEGORIES, ...EMERGENCY_CATEGORIES, FALLBACK_CATEGORY] as const;

export const URGENCY_LEVELS = ["routine", "time_sensitive", "urgent", "emergency"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const URGENCY_RANK: Record<UrgencyLevel, number> = {
  routine: 0,
  time_sensitive: 1,
  urgent: 2,
  emergency: 3,
};

export function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

/**
 * Strict runtime schema for LLM output. Unknown keys are rejected, enums are
 * closed, and cross-field rules keep the result internally consistent.
 */
export const ClassificationSchema = z
  .object({
    category: z.enum(REQUEST_CATEGORIES),
    service_type: z.string().trim().min(1).max(60).nullable(),
    issue_summary: z.string().trim().min(1).max(200),
    urgency: z.enum(URGENCY_LEVELS),
    is_emergency: z.boolean(),
    confidence: z.number().min(0).max(1),
    needs_clarification: z.boolean(),
    clarification_question: z.string().trim().min(1).max(300).nullable(),
  })
  .strict()
  .refine((v) => !v.needs_clarification || v.clarification_question !== null, {
    message: "clarification_question is required when needs_clarification is true",
    path: ["clarification_question"],
  })
  .refine((v) => !v.is_emergency || v.urgency === "emergency", {
    message: "is_emergency requires urgency=emergency",
    path: ["urgency"],
  });

export type Classification = z.infer<typeof ClassificationSchema>;

/** JSON Schema (OpenAPI subset) sent to Gemini as responseSchema. Kept in sync with the Zod schema above. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: [...REQUEST_CATEGORIES] },
    service_type: { type: "STRING", nullable: true },
    issue_summary: { type: "STRING" },
    urgency: { type: "STRING", enum: [...URGENCY_LEVELS] },
    is_emergency: { type: "BOOLEAN" },
    confidence: { type: "NUMBER" },
    needs_clarification: { type: "BOOLEAN" },
    clarification_question: { type: "STRING", nullable: true },
  },
  required: [
    "category",
    "service_type",
    "issue_summary",
    "urgency",
    "is_emergency",
    "confidence",
    "needs_clarification",
    "clarification_question",
  ],
  propertyOrdering: [
    "category",
    "service_type",
    "issue_summary",
    "urgency",
    "is_emergency",
    "confidence",
    "needs_clarification",
    "clarification_question",
  ],
} as const;
