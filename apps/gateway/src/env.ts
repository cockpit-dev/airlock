import { z } from "zod";

export const gatewayEnvSchema = z.object({
  /** Gateway operating mode. "free" optimizes for Cloudflare free-tier limits; "scale" enables higher throughput and full telemetry sampling. Default: "free". */
  AIRLOCK_MODE: z.enum(["free", "scale"]).default("free"),

  /** Success telemetry sampling rate for free mode (0–1). Only emitted when telemetry is configured. Default: 0.1. */
  AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.1),

  /** Success telemetry sampling rate for scale mode (0–1). Default: 1 (full sampling). */
  AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(1),

  /** Gateway API keys for caller authentication. Accepts two formats:
   *  - Plaintext comma-separated: "key1,key2" (each key must be ≥8 chars)
   *  - Structured JSON array: [{"id":"...","label":"...","value":"...","status":"active",...}]
   * Required. */
  AIRLOCK_GATEWAY_API_KEYS: z.string().min(1),

  /** Model groups for key policy access control. JSON object mapping group names to arrays of external model names.
   * Example: {"premium":["gpt-4.1-mini","claude-sonnet-4-5"]}. Optional. */
  AIRLOCK_MODEL_GROUPS: z.string().min(1).optional(),

  /** Model alias routing configuration. JSON array mapping external model names to provider targets.
   * Example: [{"external":"gpt-4","target":{"provider":"openai","model":"gpt-4.1-mini"}}]. Optional. */
  AIRLOCK_MODEL_ALIASES: z.string().min(1).optional(),

  /** Model fallback targets. JSON array defining fallback providers for each external model. Optional. */
  AIRLOCK_MODEL_FALLBACKS: z.string().min(1).optional(),

  /** Target selection strategy configuration. JSON array defining weighted/cost/health-based selection per route. Optional. */
  AIRLOCK_MODEL_TARGET_SELECTION: z.string().min(1).optional(),

  /** Per-key access policy configuration. JSON array mapping key IDs to tier/tags/model-group restrictions. Optional. */
  AIRLOCK_MODEL_KEY_POLICY: z.string().min(1).optional(),

  /** Per-route outbound request shaping (headers, query params, JSON body injection). JSON format. Optional. */
  AIRLOCK_MODEL_SHAPING: z.string().min(1).optional(),

  /** HMAC-SHA256 request signing secrets. JSON object mapping key IDs to hex-encoded secret values. Optional. */
  AIRLOCK_REQUEST_SIGNING_SECRETS: z.string().min(1).optional(),

  /** Timeout in milliseconds for upstream provider requests (buffered and streaming). Default: 30000. */
  AIRLOCK_PROVIDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),

  /** Maximum number of retry attempts per request across all providers. Default: 0 (no retries). */
  AIRLOCK_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).default(0),

  /** Base backoff delay in milliseconds between retry attempts. Default: 0. */
  AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).default(0),

  /** Timeout in milliseconds for receiving data during streaming responses. Default: 15000. */
  AIRLOCK_PROVIDER_STREAM_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),

  /** Maximum allowed request body size in bytes. Requests exceeding this are rejected with 400. Default: 10485760 (10MB). */
  AIRLOCK_MAX_REQUEST_BODY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10_485_760),

  /** Number of consecutive failures before opening the circuit breaker for a provider target. Default: 3. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(3),

  /** Duration in milliseconds to keep a circuit open before allowing half-open probes. Default: 30000. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(30_000),

  /** Sliding window duration for error-rate-based circuit breaking (ms). Optional; enables SLO-driven breaking. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),

  /** Error rate threshold (0–1) within the sliding window to trigger circuit open. Requires error rate window. Optional. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .optional(),

  /** Minimum number of attempts in the error rate window before the threshold is evaluated. Optional. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_MIN_ATTEMPTS_IN_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .optional(),

  /** Number of successful half-open probes required to close the circuit. Optional. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESSES: z.coerce
    .number()
    .int()
    .positive()
    .optional(),

  /** Success rate (0–1) required during half-open to close the circuit. Optional. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_SUCCESS_RATE: z.coerce
    .number()
    .min(0)
    .max(1)
    .optional(),

  /** Duration window (ms) for evaluating half-open promotion success rate. Optional. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_HALF_OPEN_PROMOTION_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .optional(),

  /** Use Durable Object persistent storage for circuit breaker state instead of in-memory. Default: false. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: z.coerce
    .boolean()
    .default(false),

  /** Freshness window for latency-based routing health (ms). Default: 30000. */
  AIRLOCK_ROUTING_LATENCY_FRESHNESS_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),

  /** Freshness window for cost-based routing health (ms). Default: 30000. */
  AIRLOCK_ROUTING_COST_FRESHNESS_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),

  /** Freshness window for failure-based routing health (ms). Default: 30000. */
  AIRLOCK_ROUTING_FAILURE_FRESHNESS_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),

  /** Recovery window for half-open circuit health scoring (ms). Default: 30000. */
  AIRLOCK_ROUTING_RECOVERY_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),

  /** Anthropic API key. Required if any route targets the "anthropic" provider. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /** Anthropic API base URL. Required if any route targets the "anthropic" provider. */
  ANTHROPIC_BASE_URL: z.url().optional(),

  /** Default max_tokens for Anthropic requests. Required if any route targets the "anthropic" provider. */
  ANTHROPIC_DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().optional(),

  /** Google Gemini API key. Required if any route targets the "gemini" provider. */
  GEMINI_API_KEY: z.string().min(1).optional(),

  /** Google Gemini API base URL. Required if any route targets the "gemini" provider. */
  GEMINI_BASE_URL: z.url().optional(),

  /** OpenAI API key. Always required. */
  OPENAI_API_KEY: z.string().min(1),

  /** OpenAI API base URL. Always required. */
  OPENAI_BASE_URL: z.url(),

  /** OpenAI default model for routing fallback. Always required. */
  OPENAI_DEFAULT_MODEL: z.string().min(1),

  /** Cloudflare Queue binding for telemetry event emission. Optional; telemetry disabled if not set. */
  AIRLOCK_TELEMETRY: z
    .custom<{
      send(message: unknown): Promise<void>;
    }>()
    .optional(),

  /** Cloudflare Analytics Engine binding for telemetry data storage. Optional. */
  AIRLOCK_TELEMETRY_DATASET: z
    .custom<{
      writeDataPoint(dataPoint: {
        indexes: string[];
        blobs: string[];
        doubles: number[];
      }): void;
    }>()
    .optional(),

  /** Durable Object binding for per-key request quota enforcement. Optional. */
  AIRLOCK_GATEWAY_KEY_QUOTA: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** Durable Object binding for per-key concurrency lease management. Optional. */
  AIRLOCK_GATEWAY_KEY_CONCURRENCY: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** Durable Object binding for per-key token quota (reservation/reconciliation). Optional. */
  AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** Allowed CORS origin(s) for /v1/* endpoints. "*" for wildcard, or comma-separated origins. Optional. */
  AIRLOCK_CORS_ORIGINS: z.string().min(1).optional(),

  /** Enable structured request logging to console. Default: false. */
  AIRLOCK_REQUEST_LOGGING: z.coerce.boolean().default(false),

  /** Enable dynamic gateway key registry (Durable Object-backed key lifecycle management). Default: false. */
  AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: z.coerce.boolean().default(false),

  /** Static admin token for /_airlock/* endpoints. At least one admin auth mechanism is required for admin access. Optional. */
  AIRLOCK_INTERNAL_ADMIN_TOKEN: z.string().min(1).optional(),

  /** Structured admin credentials (JSON array with hashed tokens and scopes). Optional. */
  AIRLOCK_INTERNAL_ADMIN_CREDENTIALS: z.string().min(1).optional(),

  /** HTTP header name for admin actor attribution. Optional. */
  AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER: z.string().min(1).optional(),

  /** Require admin actor header for all admin operations. Default: false. */
  AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: z.coerce.boolean().default(false),

  /** Durable Object binding for dynamic key registry storage. Required if registry is enabled. */
  AIRLOCK_GATEWAY_KEY_REGISTRY: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** Durable Object binding for key revocation overlay. Required if admin auth is configured. */
  AIRLOCK_GATEWAY_KEY_REVOCATION: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** Durable Object binding for persistent circuit breaker state. Required if persistent mode is enabled. */
  AIRLOCK_PROVIDER_CIRCUIT_BREAKER: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** Durable Object binding for IP-based rate limiting. Required if IP rate limit policy is configured. */
  AIRLOCK_IP_RATE_LIMIT: z
    .custom<{
      idFromName(name: string): unknown;
      get(id: unknown): {
        fetch(request: Request): Promise<Response>;
      };
    }>()
    .optional(),

  /** IP rate limit policy configuration (JSON). Defines per-IP request limits and windows. Optional. */
  AIRLOCK_IP_RATE_LIMIT_POLICY: z.string().min(1).optional()
});

export type GatewayBindings = z.infer<typeof gatewayEnvSchema>;
