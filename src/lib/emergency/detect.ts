/**
 * Deterministic emergency detection. Runs BEFORE any LLM call and cannot be
 * overridden by the LLM. Pure function — no I/O — so it is fast and testable.
 *
 * Levels:
 *  - "emergency": clear emergency → SOS flow immediately, LLM never invoked.
 *  - "possible":  may indicate an emergency → never routine; urgency floored at
 *                 "urgent", flagged for human review, child alerted promptly.
 *  - "none":      no emergency signal; normal classification.
 */

export type EmergencyCategory = "medical_emergency" | "general_emergency";

export type EmergencyDetection =
  | { level: "emergency"; rule: "SOS" | "PHRASE"; category: EmergencyCategory; matched: string }
  | { level: "possible"; category: EmergencyCategory; matched: string }
  | { level: "none" };

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan'?t\b/g, "cannot"],
  [/\bwon'?t\b/g, "will not"],
  [/\b(\w+)n't\b/g, "$1 not"],
  [/\bi'm\b/g, "i am"],
  [/\b(i|we|you|they)'ve\b/g, "$1 have"],
  [/\b(i|we|you|they|he|she)'ll\b/g, "$1 will"],
  [/\b(i|we|you|they|he|she)'d\b/g, "$1 would"],
  [/\b(it|he|she|that|there)'s\b/g, "$1 is"],
];

export function normalizeMessage(text: string): string {
  let s = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  return s.replace(/'/g, "").replace(/\s+/g, " ").trim();
}

/** Exact SOS after normalization: "SOS", "sos!", "S.O.S", " Sos ", "SOS SOS". */
function isSos(normalized: string): boolean {
  const compact = normalized.replace(/[\s']/g, "");
  return /^(sos)+$/.test(compact);
}

interface Rule {
  re: RegExp;
  category: EmergencyCategory;
}

// Clear emergency phrases. Word-bounded and applied to normalized text.
const CLEAR_RULES: Rule[] = [
  { re: /\bhelp me (urgently|now|quickly|please help)\b/, category: "general_emergency" },
  { re: /\b(i need|need|send|get me|call) (an? )?(emergency|urgent) (help|assistance)\b/, category: "general_emergency" },
  { re: /\bemergency help\b/, category: "general_emergency" },
  { re: /\bthis is an emergency\b/, category: "general_emergency" },
  { re: /\bi (have|ve|'ve) fallen\b/, category: "medical_emergency" },
  { re: /\bi fell( down)?( and)? (can ?not|can't|cant|cannot) (get up|move|stand)\b/, category: "medical_emergency" },
  { re: /\bi (can ?not|can't|cant|cannot|am unable to|m unable to) breathe?\b/, category: "medical_emergency" },
  { re: /\b(trouble|difficulty|hard to) breathing\b/, category: "medical_emergency" },
  { re: /\b(chest pain|heart attack|having a stroke|stroke symptoms)\b/, category: "medical_emergency" },
  { re: /\b(call|need|send) (an? )?ambulance\b/, category: "medical_emergency" },
  { re: /\b(bleeding (a lot|heavily|badly|will not stop))\b/, category: "medical_emergency" },
  { re: /\b(unconscious|passed out|fainted|choking|overdose)\b/, category: "medical_emergency" },
  { re: /\b(fire in (the|my) (house|home|kitchen|room)|house is on fire|smell(ing)? gas|gas leak)\b/, category: "general_emergency" },
  { re: /\b(someone (broke|is breaking) in|intruder|being attacked|robbery)\b/, category: "general_emergency" },
];

// Possible-emergency signals. Not conclusive, but must never be treated as routine.
const POSSIBLE_RULES: Rule[] = [
  { re: /\bi fell\b|\bfell down\b|\bslipped\b/, category: "medical_emergency" },
  { re: /\b(dizzy|faint|lightheaded|light headed|confused|numb(ness)?)\b/, category: "medical_emergency" },
  { re: /\b(severe|terrible|unbearable|bad) (pain|headache)\b/, category: "medical_emergency" },
  { re: /\b(not feeling well|feeling very unwell|feel very sick|very sick|vomiting blood)\b/, category: "medical_emergency" },
  { re: /\b(hurt myself|injured|bleeding)\b/, category: "medical_emergency" },
  { re: /\b(scared|frightened|afraid|unsafe|someone at the door)\b/, category: "general_emergency" },
  // Note: plain "help" is deliberately NOT a signal — most assistance requests contain it.
  { re: /\b(urgent|urgently|emergency|help me please|please help me)\b/, category: "general_emergency" },
];

export function detectEmergency(text: string): EmergencyDetection {
  const normalized = normalizeMessage(text);
  if (!normalized) return { level: "none" };

  if (isSos(normalized)) {
    // SOS gives no information about the nature of the emergency.
    return { level: "emergency", rule: "SOS", category: "general_emergency", matched: "sos" };
  }

  for (const r of CLEAR_RULES) {
    const m = normalized.match(r.re);
    if (m) return { level: "emergency", rule: "PHRASE", category: r.category, matched: m[0] };
  }

  for (const r of POSSIBLE_RULES) {
    const m = normalized.match(r.re);
    if (m) return { level: "possible", category: r.category, matched: m[0] };
  }

  return { level: "none" };
}
