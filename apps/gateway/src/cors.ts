/**
 * CORS handling for public AI API endpoints and browser-based admin surfaces.
 *
 * Browser clients need CORS headers to call the gateway directly.
 * This module provides:
 * - Preflight (OPTIONS) response generation
 * - CORS header injection on actual responses
 * - Configurable allowed origins via AIRLOCK_CORS_ORIGINS env var
 */

const PUBLIC_ALLOWED_METHODS = "GET, POST, OPTIONS";
const ADMIN_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS =
  "Content-Type, Authorization, X-Api-Key, X-Request-ID, Accept, Accept-Encoding";
const MAX_AGE = 86400; // 24 hours — browsers cache preflight results

export interface CorsConfig {
  /**
   * Comma-separated origin list, or "*" for wildcard.
   * When undefined, browser requests (with Origin header) are still allowed via echo-back.
   */
  allowedOrigins: string | undefined;
}

export function parseCorsOrigins(raw: string | undefined): CorsConfig {
  if (!raw || raw.trim() === "") {
    return { allowedOrigins: undefined };
  }
  const trimmed = raw.trim();
  if (trimmed === "*") {
    return { allowedOrigins: "*" };
  }
  return { allowedOrigins: trimmed };
}

function resolveAllowOrigin(
  requestOrigin: string | undefined,
  config: CorsConfig
): string | undefined {
  if (config.allowedOrigins === "*") {
    return "*";
  }
  if (config.allowedOrigins) {
    if (!requestOrigin) return undefined;
    const allowed = config.allowedOrigins.split(",").map((s) => s.trim());
    return allowed.includes(requestOrigin) ? requestOrigin : undefined;
  }
  // No explicit config — echo-back browser Origin to allow dashboard usage
  return requestOrigin ?? undefined;
}

export function corsHeaders(
  requestOrigin: string | undefined,
  config: CorsConfig,
  options?: { allowAdminMethods?: boolean }
): Record<string, string> {
  const allowOrigin = resolveAllowOrigin(requestOrigin, config);
  if (!allowOrigin) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": options?.allowAdminMethods
      ? ADMIN_ALLOWED_METHODS
      : PUBLIC_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": String(MAX_AGE),
    "Access-Control-Expose-Headers":
      "X-Request-ID, Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After"
  };
}

export function isPreflightRequest(request: Request): boolean {
  return request.method === "OPTIONS";
}

export function createPreflightResponse(
  requestOrigin: string | undefined,
  config: CorsConfig,
  options?: { allowAdminMethods?: boolean }
): Response {
  const headers = corsHeaders(requestOrigin, config, options);
  if (!headers["Access-Control-Allow-Origin"]) {
    // Origin not allowed — return 403 with no CORS headers
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers
  });
}
