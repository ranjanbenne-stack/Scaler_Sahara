/**
 * Minimal structured logger. Callers must not pass raw message text, tokens or
 * API keys — log identifiers and outcomes instead. `redact` is a last line of defence.
 */
type Level = "debug" | "info" | "warn" | "error";

const SECRET_PATTERNS: RegExp[] = [
  /bot\d+:[A-Za-z0-9_-]{20,}/g, // Telegram bot token in URLs
  /\d{6,}:[A-Za-z0-9_-]{30,}/g, // bare Telegram token
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API key
  /key=[^&\s"]+/g,
];

export function redact(value: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), value);
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  const out = redact(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};
