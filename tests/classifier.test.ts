import { describe, expect, it, vi } from "vitest";
import { GeminiClassifier, parseClassification } from "../src/lib/classifier/gemini";
import { HeuristicClassifier } from "../src/lib/classifier/heuristic";

const VALID = {
  category: "home_maintenance",
  service_type: "electrician",
  issue_summary: "Bedroom fan needs inspection",
  urgency: "routine",
  is_emergency: false,
  confidence: 0.95,
  needs_clarification: false,
  clarification_question: null,
};

function geminiResponse(text: string, status = 200) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function classifierWith(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return new GeminiClassifier({ apiKey: "test-key", model: "gemini-test", apiBase: "https://gemini.invalid", timeoutMs, fetchImpl });
}

describe("Gemini classifier (mocked HTTP, no paid calls)", () => {
  it("classifies the electrician request as home_maintenance", async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(JSON.stringify(VALID)));
    const res = await classifierWith(fetchImpl as unknown as typeof fetch).classify("I need an electrician to come and check the fan in my bedroom.");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.classification.category).toBe("home_maintenance");
      expect(res.classification.service_type).toBe("electrician");
      expect(res.classification.urgency).toBe("routine");
      expect(res.classification.is_emergency).toBe(false);
    }
  });

  it("sends JSON mode with a response schema and the key in a header (not the URL)", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => geminiResponse(JSON.stringify(VALID)));
    await classifierWith(fetchImpl as unknown as typeof fetch).classify("fan broken");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://gemini.invalid/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.properties.category.enum).toContain("home_maintenance");
  });

  it("rejects invalid JSON without throwing", async () => {
    const res = await classifierWith((async () => geminiResponse("Sure! The category is home maintenance.")) as unknown as typeof fetch).classify("x");
    expect(res).toMatchObject({ ok: false, error: "LLM output was not valid JSON" });
  });

  it("rejects unknown categories and urgency values", async () => {
    for (const bad of [{ ...VALID, category: "book_electrician_now" }, { ...VALID, urgency: "whenever" }]) {
      const res = await classifierWith((async () => geminiResponse(JSON.stringify(bad))) as unknown as typeof fetch).classify("x");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/schema validation/);
    }
  });

  it("rejects extra keys (no free-form action fields)", async () => {
    const res = await classifierWith((async () => geminiResponse(JSON.stringify({ ...VALID, action: "dispatch_electrician" }))) as unknown as typeof fetch).classify("x");
    expect(res.ok).toBe(false);
  });

  it("rejects inconsistent output (emergency flag without emergency urgency)", () => {
    const res = parseClassification(JSON.stringify({ ...VALID, is_emergency: true, urgency: "routine" }), { provider: "t", model: "t" }, Date.now());
    expect(res.ok).toBe(false);
  });

  it("handles HTTP errors, timeouts and a missing key", async () => {
    expect((await classifierWith((async () => new Response("{}", { status: 500 })) as unknown as typeof fetch).classify("x")).ok).toBe(false);

    const hanging = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const timedOut = await classifierWith(hanging, 50).classify("x");
    expect(timedOut).toMatchObject({ ok: false });
    if (!timedOut.ok) expect(timedOut.error).toMatch(/timed out/);

    const noKey = new GeminiClassifier({ apiKey: "", model: "m", apiBase: "https://gemini.invalid", timeoutMs: 100 });
    expect((await noKey.classify("x")).ok).toBe(false);
  });

  it("heuristic dev classifier returns low confidence so results get reviewed", async () => {
    const res = await new HeuristicClassifier().classify("I need an electrician to check my bedroom fan");
    expect(res.ok && res.classification.category).toBe("home_maintenance");
    expect(res.ok && res.classification.confidence).toBeLessThan(0.6);
  });
});
