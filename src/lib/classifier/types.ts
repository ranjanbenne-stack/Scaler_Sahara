import type { Classification } from "./schema";

export type ClassifierResult =
  | { ok: true; classification: Classification; provider: string; model: string; latencyMs: number }
  | { ok: false; error: string; provider: string; model: string; latencyMs: number };

/**
 * Pluggable classifier. Implementations must never throw — they return
 * `{ ok: false }` so the caller can persist the request with a fallback.
 * Output is advisory data only; it never triggers actions directly.
 */
export interface Classifier {
  readonly provider: string;
  readonly model: string;
  classify(message: string): Promise<ClassifierResult>;
}
