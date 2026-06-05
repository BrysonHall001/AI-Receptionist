import dotenv from "dotenv";
dotenv.config();

import { z } from "zod";

/**
 * Environment schema. The six REQUIRED variables have no defaults — if any is
 * missing the process exits immediately (LAYER 10 requirement). The remaining
 * variables are optional knobs with sane defaults.
 */
const envSchema = z.object({
  // ---- REQUIRED ----
  TWILIO_ACCOUNT_SID: z.string().min(1, "required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "required"),
  TWILIO_PHONE_NUMBER: z.string().min(1, "required"),
  OPENAI_API_KEY: z.string().min(1, "required"),
  DATABASE_URL: z.string().min(1, "required"),
  RESEND_API_KEY: z.string().min(1, "required"),

  // ---- OPTIONAL ----
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  RESEND_FROM: z.string().default("onboarding@resend.dev"),
  PORT: z.coerce.number().int().positive().default(3000),
  TWILIO_VALIDATE_SIGNATURE: z.enum(["true", "false"]).default("false"),
  MAX_TURNS: z.coerce.number().int().positive().default(12),
  MAX_EMPTY_TURNS: z.coerce.number().int().positive().default(2),
  AI_MAX_RETRIES: z.coerce.number().int().positive().default(3),

  // ---- PROVIDER MODE ----
  // "auto" (default): use the real service if the key looks real, otherwise a
  // local mock so the app works end-to-end with placeholder keys.
  AI_PROVIDER: z.enum(["auto", "mock", "openai"]).default("auto"),
  EMAIL_PROVIDER: z.enum(["auto", "mock", "resend"]).default("auto"),

  // ---- AUTH ----
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  SUPER_ADMIN_EMAIL: z.string().default("admin@example.com"),
  SUPER_ADMIN_PASSWORD: z.string().default("changeme123"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validate process.env. Crashes the process if any required var is missing. */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(
      "FATAL: invalid or missing environment variables.\n" +
        details +
        "\nCopy .env.example to .env and fill in the required values.",
    );
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

// Eagerly validated on first import so misconfiguration fails fast at boot.
export const env: Env = loadEnv();

/** A secret that is empty or still a copy-paste placeholder (xxxx, your_, etc). */
export function isPlaceholderSecret(value: string): boolean {
  if (!value) return true;
  const s = value.toLowerCase();
  return (
    /x{4,}/.test(s) ||
    s.includes("your_") ||
    s.includes("changeme") ||
    s.includes("placeholder") ||
    s.includes("example-key") ||
    s.includes("dummy")
  );
}

/** Whether to use the local mock receptionist instead of calling OpenAI. */
export function useMockAI(): boolean {
  if (env.AI_PROVIDER === "mock") return true;
  if (env.AI_PROVIDER === "openai") return false;
  return isPlaceholderSecret(env.OPENAI_API_KEY);
}

/** Whether to log emails locally instead of sending via Resend. */
export function useMockEmail(): boolean {
  if (env.EMAIL_PROVIDER === "mock") return true;
  if (env.EMAIL_PROVIDER === "resend") return false;
  return isPlaceholderSecret(env.RESEND_API_KEY);
}

/** Whether to log texts locally instead of sending via Twilio. */
export function useMockSms(): boolean {
  return isPlaceholderSecret(env.TWILIO_AUTH_TOKEN);
}
