/**
 * Structured request debug logging for incident debugging.
 *
 * On Cloudflare Workers, console.log output goes to `wrangler tail`
 * and the Workers dashboard real-time logs. This module produces
 * one JSON-structured log line per request with key fields for
 * incident correlation and debugging.
 *
 * Logging is opt-in via AIRLOCK_REQUEST_LOGGING env var.
 */

export interface RequestLogEntry {
  msg: "gateway_request";
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  model?: string;
  provider?: string;
  stream?: boolean;
  error?: string;
}

export function logRequest(entry: RequestLogEntry): void {
  console.log(JSON.stringify(entry));
}
