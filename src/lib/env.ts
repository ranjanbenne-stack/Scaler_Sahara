import { z } from "zod";

/**
 * Server-only configuration. Never import this from a client component —
 * nothing here may be exposed to the browser.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),
  // Public bot username (without @), used only to show t.me links on the dashboard.
  TELEGRAM_BOT_USERNAME: z.string().default(""),

  // gemini | heuristic | none
  LLM_PROVIDER: z.enum(["gemini", "heuristic", "none"]).default("gemini"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  GEMINI_API_BASE: z.string().url().default("https://generativelanguage.googleapis.com"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  LLM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),

  // Emergency escalation policy
  ESCALATION_ACK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  ESCALATION_REPEAT_LAST_LEVEL: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  ESCALATION_MAX_ROUNDS: z.coerce.number().int().positive().default(5),

  // telegram (default) | console (dev only: prints messages instead of sending; refused in production)
  NOTIFY_CHANNEL: z.enum(["telegram", "console"]).default("telegram"),

  // Notification retry policy
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  NOTIFY_EMERGENCY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  // Rate limits (per window)
  RATE_LIMIT_MESSAGES_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_LINK_ATTEMPTS_PER_15_MIN: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_ATTEMPTS_PER_15_MIN: z.coerce.number().int().positive().default(10),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  PAIRING_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(15),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

/** Render sets RENDER_EXTERNAL_URL. Use it when APP_BASE_URL was not provided. */
function withRuntimeDefaults(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (!env.APP_BASE_URL && env.RENDER_EXTERNAL_URL) {
    return { ...env, APP_BASE_URL: env.RENDER_EXTERNAL_URL };
  }
  return env;
}

export function getConfig(): AppConfig {
  if (!cached) {
    const parsed = EnvSchema.safeParse(withRuntimeDefaults(process.env));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper: build a config from overrides without touching process.env. */
export function buildConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return EnvSchema.parse(withRuntimeDefaults({ ...process.env, ...overrides }));
}
