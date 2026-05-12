import { z } from "zod";

export const gatewayEnvSchema = z.object({
  AIRLOCK_MODE: z.enum(["free", "scale"]).default("free"),
  AIRLOCK_GATEWAY_API_KEYS: z.string().min(1),
  AIRLOCK_MODEL_ALIASES: z.string().min(1).optional(),
  AIRLOCK_MODEL_FALLBACKS: z.string().min(1).optional(),
  AIRLOCK_MODEL_TARGET_SELECTION: z.string().min(1).optional(),
  AIRLOCK_MODEL_SHAPING: z.string().min(1).optional(),
  AIRLOCK_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  ANTHROPIC_DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_BASE_URL: z.url().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url(),
  OPENAI_DEFAULT_MODEL: z.string().min(1)
});

export type GatewayBindings = z.infer<typeof gatewayEnvSchema>;
