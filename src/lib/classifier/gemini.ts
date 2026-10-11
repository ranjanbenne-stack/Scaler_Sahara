import { ClassificationSchema, GEMINI_RESPONSE_SCHEMA } from "./schema";
import { CLASSIFIER_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import type { Classifier, ClassifierResult } from "./types";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  apiBase: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Google Gemini classifier via the REST generateContent endpoint in JSON mode.
 * The response is still validated with the strict Zod schema — JSON mode is
 * not treated as a guarantee.
 */
export class GeminiClassifier implements Classifier {
  readonly provider = "gemini";
  readonly model: string;
  private readonly opts: GeminiOptions;

  constructor(opts: GeminiOptions) {
    this.opts = opts;
    this.model = opts.model;
  }

  async classify(message: string): Promise<ClassifierResult> {
    const started = Date.now();
    const base = { provider: this.provider, model: this.model };
    const fail = (error: string): ClassifierResult => ({ ok: false, error, ...base, latencyMs: Date.now() - started });

    if (!this.opts.apiKey) return fail("GEMINI_API_KEY is not configured");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const doFetch = this.opts.fetchImpl ?? fetch;

    try {
      const url = `${this.opts.apiBase}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
      const res = await doFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CLASSIFIER_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(message) }] }],
          generationConfig: {
            temperature: 0,
            // Generous: on "thinking" Gemini models, reasoning tokens count against this limit.
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      });

      if (!res.ok) {
        // Do not include the response body: it can echo request content.
        return fail(`Gemini HTTP ${res.status}`);
      }

      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };
      if (body.promptFeedback?.blockReason) return fail(`Gemini blocked prompt: ${body.promptFeedback.blockReason}`);

      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text) return fail(`Gemini returned no content (finishReason=${body.candidates?.[0]?.finishReason ?? "unknown"})`);

      return parseClassification(text, base, started);
    } catch (err) {
      const name = (err as Error)?.name;
      return fail(name === "AbortError" ? `Gemini timed out after ${this.opts.timeoutMs}ms` : `Gemini request failed: ${name ?? "error"}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Shared parser: JSON.parse + strict schema validation. Exported for tests and other providers. */
export function parseClassification(
  text: string,
  base: { provider: string; model: string },
  started: number,
): ClassifierResult {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, error: "LLM output was not valid JSON", ...base, latencyMs: Date.now() - started };
  }
  const parsed = ClassificationSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, error: `LLM output failed schema validation: ${issues}`, ...base, latencyMs: Date.now() - started };
  }
  return { ok: true, classification: parsed.data, ...base, latencyMs: Date.now() - started };
}
