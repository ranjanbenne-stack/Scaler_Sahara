import { normalizeMessage } from "../emergency/detect";
import type { Classification } from "./schema";
import type { Classifier, ClassifierResult } from "./types";

/**
 * Offline keyword classifier for local development without an LLM key
 * (LLM_PROVIDER=heuristic). Confidence is capped at 0.5 so every result is
 * flagged NEEDS_REVIEW by the intake pipeline — not for production.
 */
const RULES: { re: RegExp; category: Classification["category"]; service: string | null; summary: (m: string) => string }[] = [
  { re: /\b(electrician|fan|light|switch|wiring|socket|power cut)\b/, category: "home_maintenance", service: "electrician", summary: summarize },
  { re: /\b(plumber|leak|tap|pipe|toilet|drain)\b/, category: "home_maintenance", service: "plumber", summary: summarize },
  { re: /\b(medicine|tablets|pills|prescription|refill)\b/, category: "medicine_refill", service: "pharmacy", summary: summarize },
  { re: /\b(doctor|appointment|clinic|checkup|check up)\b/, category: "medical_appointment", service: null, summary: summarize },
  { re: /\b(phone|wifi|internet|tv|television|whatsapp|app)\b/, category: "technology_support", service: "technician", summary: summarize },
  { re: /\b(bill|electricity bill|pay)\b/, category: "utility_payment", service: null, summary: summarize },
  { re: /\b(groceries|cook|clean|laundry)\b/, category: "household_assistance", service: null, summary: summarize },
];

function summarize(m: string): string {
  const words = m.split(" ").slice(0, 12).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export class HeuristicClassifier implements Classifier {
  readonly provider = "heuristic";
  readonly model = "keyword-rules-v1";

  async classify(message: string): Promise<ClassifierResult> {
    const started = Date.now();
    const n = normalizeMessage(message);
    const rule = RULES.find((r) => r.re.test(n));
    const classification: Classification = {
      category: rule?.category ?? "other",
      service_type: rule?.service ?? null,
      issue_summary: (rule?.summary ?? summarize)(n || "empty message"),
      urgency: "routine",
      is_emergency: false,
      confidence: rule ? 0.5 : 0.2,
      needs_clarification: false,
      clarification_question: null,
    };
    return { ok: true, classification, provider: this.provider, model: this.model, latencyMs: Date.now() - started };
  }
}

/** LLM_PROVIDER=none: always "fails" so the request is stored as unclassified for review. */
export class NoopClassifier implements Classifier {
  readonly provider = "none";
  readonly model = "none";
  async classify(): Promise<ClassifierResult> {
    return { ok: false, error: "No classifier configured (LLM_PROVIDER=none)", provider: this.provider, model: this.model, latencyMs: 0 };
  }
}
