import { z } from "zod";

export const gatewayEnvSchema = z.object({
  AIRLOCK_MODE: z.enum(["free", "scale"]).default("free"),
  AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.1),
  AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(1),
  AIRLOCK_GATEWAY_API_KEYS: z.string().min(1),
  AIRLOCK_MODEL_GROUPS: z.string().min(1).optional(),
  AIRLOCK_MODEL_ALIASES: z.string().min(1).optional(),
  AIRLOCK_MODEL_FALLBACKS: z.string().min(1).optional(),
  AIRLOCK_MODEL_TARGET_SELECTION: z.string().min(1).optional(),
  AIRLOCK_MODEL_KEY_POLICY: z.string().min(1).optional(),
  AIRLOCK_MODEL_SHAPING: z.string().min(1).optional(),
  AIRLOCK_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AIRLOCK_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).default(0),
  AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).default(0),
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(0).default(30_000),
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: z.coerce.boolean().default(false),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  ANTHROPIC_DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_BASE_URL: z.url().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url(),
  OPENAI_DEFAULT_MODEL: z.string().min(1),
  AIRLOCK_TELEMETRY: z
    .custom<{
      send(message: unknown): Promise<void>;
    }>()
    .optional(),
  AIRLOCK_TELEMETRY_DATASET: z
    .custom<{
      writeDataPoint(dataPoint: {
        indexes: string[];
        blobs: string[];
        doubles: number[];
      }): void;
    }>()
    .optional(),
  AIRLOCK_GATEWAY_KEY_QUOTA: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),
  AIRLOCK_GATEWAY_KEY_CONCURRENCY: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),
  AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),
  AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: z.coerce.boolean().default(false),
  AIRLOCK_INTERNAL_ADMIN_TOKEN: z.string().min(1).optional(),
  AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER: z.string().min(1).optional(),
  AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: z.coerce.boolean().default(false),
  AIRLOCK_GATEWAY_KEY_REGISTRY: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),
  AIRLOCK_GATEWAY_KEY_REVOCATION: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional()
});

export type GatewayBindings = z.infer<typeof gatewayEnvSchema>;
