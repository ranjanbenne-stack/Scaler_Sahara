import type { AppConfig } from "../env";
import { GeminiClassifier } from "./gemini";
import { HeuristicClassifier, NoopClassifier } from "./heuristic";
import type { Classifier } from "./types";

export function createClassifier(config: AppConfig): Classifier {
  switch (config.LLM_PROVIDER) {
    case "gemini":
      return new GeminiClassifier({
        apiKey: config.GEMINI_API_KEY,
        model: config.GEMINI_MODEL,
        apiBase: config.GEMINI_API_BASE,
        timeoutMs: config.LLM_TIMEOUT_MS,
      });
    case "heuristic":
      return new HeuristicClassifier();
    case "none":
      return new NoopClassifier();
  }
}

export type { Classifier, ClassifierResult } from "./types";
