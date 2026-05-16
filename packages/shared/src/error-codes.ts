/**
 * Centralized error code registry for the Airlock Gateway.
 *
 * Every GatewayError code should be defined here as a constant.
 * This prevents typos, enables grep-ability, and makes it easy to
 * audit the full error taxonomy.
 *
 * Categories: authentication | authorization | configuration | governance |
 *             provider | rate_limit | request | routing
 */
export const ErrorCodes = {
  // Authentication
  AUTH_INVALID_API_KEY: "auth_invalid_api_key",
  AUTH_INVALID_ADMIN_TOKEN: "auth_invalid_admin_token",
  AUTH_API_KEY_NOT_YET_ACTIVE: "auth_api_key_not_yet_active",
  AUTH_API_KEY_EXPIRED: "auth_api_key_expired",
  AUTH_ADMIN_ACTOR_REQUIRED: "auth_admin_actor_required",
  AUTH_INVALID_ADMIN_ACTOR: "auth_invalid_admin_actor",
  AUTH_ADMIN_SCOPE_DENIED: "auth_admin_scope_denied",

  // Authorization
  AUTH_MODEL_NOT_ALLOWED: "auth_model_not_allowed",
  AUTH_ROUTE_POLICY_NOT_ALLOWED: "auth_route_policy_not_allowed",
  AUTH_PROVIDER_NOT_ALLOWED: "auth_provider_not_allowed",

  // Configuration
  CONFIG_INVALID_GATEWAY_API_KEYS: "config_invalid_gateway_api_keys",
  CONFIG_INVALID_MODEL_ALIASES: "config_invalid_model_aliases",
  CONFIG_INVALID_MODEL_FALLBACKS: "config_invalid_model_fallbacks",
  CONFIG_INVALID_MODEL_TARGET_SELECTION:
    "config_invalid_model_target_selection",
  CONFIG_INVALID_MODEL_KEY_POLICY: "config_invalid_model_key_policy",
  CONFIG_INVALID_MODEL_GROUPS: "config_invalid_model_groups",
  CONFIG_INVALID_REQUEST_SHAPING: "config_invalid_request_shaping",
  CONFIG_INVALID_AUTH_STRATEGY: "config_invalid_auth_strategy",
  CONFIG_INVALID_SIGNING_STRATEGY: "config_invalid_signing_strategy",
  CONFIG_INVALID_REQUEST_SIGNING_SECRETS:
    "config_invalid_request_signing_secrets",
  CONFIG_INVALID_IP_RATE_LIMIT_POLICY: "config_invalid_ip_rate_limit_policy",
  CONFIG_MISSING_INTERNAL_ADMIN_TOKEN: "config_missing_internal_admin_token",
  CONFIG_MISSING_GATEWAY_KEY_QUOTA: "config_missing_gateway_key_quota",
  CONFIG_MISSING_GATEWAY_KEY_TOKEN_QUOTA:
    "config_missing_gateway_key_token_quota",
  CONFIG_MISSING_GATEWAY_KEY_CONCURRENCY:
    "config_missing_gateway_key_concurrency",
  CONFIG_MISSING_GATEWAY_KEY_REGISTRY: "config_missing_gateway_key_registry",
  CONFIG_MISSING_GATEWAY_KEY_REVOCATION:
    "config_missing_gateway_key_revocation",
  CONFIG_MISSING_PROVIDER_CIRCUIT_BREAKER:
    "config_missing_provider_circuit_breaker",
  CONFIG_MISSING_IP_RATE_LIMIT_BINDING:
    "config_missing_ip_rate_limit_binding",
  CONFIG_MISSING_ANTHROPIC: "config_missing_anthropic",
  CONFIG_MISSING_GEMINI: "config_missing_gemini",
  PROVIDER_NOT_SUPPORTED: "provider_not_supported",

  // Governance
  GATEWAY_KEY_ALREADY_EXISTS: "gateway_key_already_exists",
  GATEWAY_KEY_NOT_REGISTRY_OWNED: "gateway_key_not_registry_owned",
  GATEWAY_KEY_NOT_FOUND: "gateway_key_not_found",
  GATEWAY_KEY_ROTATION_NOT_STAGED: "gateway_key_rotation_not_staged",
  GATEWAY_KEY_ROTATION_NOT_CANCELABLE:
    "gateway_key_rotation_not_cancelable",
  GATEWAY_KEY_ALREADY_ARCHIVED: "gateway_key_already_archived",
  GATEWAY_KEY_NOT_ARCHIVED: "gateway_key_not_archived",
  GATEWAY_KEY_REVOCATION_INVALID_PAYLOAD:
    "gateway_key_revocation_invalid_payload",
  GATEWAY_KEY_INVALID_ACTOR_PAYLOAD: "gateway_key_invalid_actor_payload",
  GATEWAY_KEY_TOKEN_QUOTA_USAGE_UNAVAILABLE:
    "gateway_key_token_quota_usage_unavailable",
  GATEWAY_KEY_REGISTRY_UNAVAILABLE: "gateway_key_registry_unavailable",
  GATEWAY_KEY_REGISTRY_INVALID_RESPONSE:
    "gateway_key_registry_invalid_response",
  GATEWAY_KEY_REVOCATION_UNAVAILABLE:
    "gateway_key_revocation_unavailable",
  GATEWAY_KEY_REVOCATION_INVALID_RESPONSE:
    "gateway_key_revocation_invalid_response",
  GATEWAY_KEY_QUOTA_UNAVAILABLE: "gateway_key_quota_unavailable",
  GATEWAY_KEY_QUOTA_INVALID_RESPONSE:
    "gateway_key_quota_invalid_response",
  GATEWAY_KEY_TOKEN_QUOTA_UNAVAILABLE:
    "gateway_key_token_quota_unavailable",
  GATEWAY_KEY_TOKEN_QUOTA_INVALID_RESPONSE:
    "gateway_key_token_quota_invalid_response",
  GATEWAY_KEY_TOKEN_QUOTA_INVALID_USAGE:
    "gateway_key_token_quota_invalid_usage",
  GATEWAY_KEY_CONCURRENCY_UNAVAILABLE:
    "gateway_key_concurrency_unavailable",
  GATEWAY_KEY_CONCURRENCY_INVALID_RESPONSE:
    "gateway_key_concurrency_invalid_response",
  IP_RATE_LIMIT_UNAVAILABLE: "ip_rate_limit_unavailable",
  IP_RATE_LIMIT_INVALID_RESPONSE: "ip_rate_limit_invalid_response",

  // Provider
  PROVIDER_TIMEOUT: "provider_timeout",
  PROVIDER_UPSTREAM_ERROR: "provider_upstream_error",

  // Rate limit
  QUOTA_REQUESTS_EXCEEDED: "quota_requests_exceeded",
  QUOTA_TOKENS_EXCEEDED: "quota_tokens_exceeded",
  QUOTA_CONCURRENCY_EXCEEDED: "quota_concurrency_exceeded",
  IP_RATE_LIMIT_EXCEEDED: "ip_rate_limit_exceeded",

  // Request
  REQUEST_INVALID_CONTENT_TYPE: "request_invalid_content_type",
  REQUEST_BODY_TOO_LARGE: "request_body_too_large",
  REQUEST_INVALID_JSON: "request_invalid_json",
  REQUEST_MISSING_MODEL: "request_missing_model",
  REQUEST_INVALID_TOOL_ARGUMENTS: "request_invalid_tool_arguments",
  REQUEST_UNSUPPORTED_OPENAI_SEMANTICS:
    "request_unsupported_openai_semantics",
  REQUEST_INVALID_OPENAI_PAYLOAD: "request_invalid_openai_payload",
  REQUEST_UNSUPPORTED_ANTHROPIC_SEMANTICS:
    "request_unsupported_anthropic_semantics",
  REQUEST_INVALID_ANTHROPIC_PAYLOAD: "request_invalid_anthropic_payload",
  REQUEST_INVALID_REQUEST_SHAPING: "request_invalid_request_shaping",

  // Routing
  MODEL_NOT_FOUND: "model_not_found",
  PROVIDER_CAPABILITY_NOT_SUPPORTED: "provider_capability_not_supported",
  PROVIDER_CIRCUIT_OPEN: "provider_circuit_open",
  ADMIN_RATE_LIMIT_EXCEEDED: "admin_rate_limit_exceeded"
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ErrorCategories = {
  AUTHENTICATION: "authentication",
  AUTHORIZATION: "authorization",
  CONFIGURATION: "configuration",
  GOVERNANCE: "governance",
  PROVIDER: "provider",
  RATE_LIMIT: "rate_limit",
  REQUEST: "request",
  ROUTING: "routing"
} as const;

export type ErrorCategory =
  (typeof ErrorCategories)[keyof typeof ErrorCategories];
