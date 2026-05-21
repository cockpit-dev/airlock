import {
  parseRequestRequestShaping,
  type RequestShapingProfile
} from "@airlock/request-shaping";

const GATEWAY_RESERVED_HEADERS = new Set([
  "authorization",
  "content-type",
  "content-length",
  "host",
  "connection",
  "accept",
  "accept-encoding",
  "accept-language",
  "cookie",
  "origin",
  "referer",
  "x-request-id",
  "request-id",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
  "transfer-encoding",
  "upgrade"
]);

export function extractForwardedHeaders(
  headers: Headers
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!GATEWAY_RESERVED_HEADERS.has(key.toLowerCase()) && !key.startsWith("cf-") && !key.startsWith("sec-")) {
      result[key] = value;
    }
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

export function extractForwardedQuery(
  url: string
): Record<string, string> | undefined {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return undefined;
  const searchParams = new URLSearchParams(url.slice(queryIndex + 1));
  const result: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    result[key] = value;
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseRequestShapingExtension(
  input: unknown
): RequestShapingProfile | undefined {
  if (input === undefined) {
    return undefined;
  }

  return parseRequestRequestShaping(input);
}
