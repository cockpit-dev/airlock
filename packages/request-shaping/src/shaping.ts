import { GatewayError } from "@airlock/shared";

export interface OutboundRequestShape {
  path: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  query: Record<string, string>;
  jsonBody: Record<string, unknown>;
}

export interface RequestShapingProfile {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  jsonBody?: Record<string, unknown>;
}

export interface SecretRef {
  secretRef: string;
}

export interface HeaderBearerAuthStrategy {
  type: "header_bearer";
  headerName: string;
  credential: SecretRef;
}

export interface HeaderValueAuthStrategy {
  type: "header_value";
  headerName: string;
  credential: SecretRef;
}

export type OutboundAuthStrategy =
  | HeaderBearerAuthStrategy
  | HeaderValueAuthStrategy;

export type RouteRequestShapingMap = Record<string, RequestShapingProfile>;

const RESERVED_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "content-length",
  "host"
]);

function createInvalidShapingError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_request_shaping",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function createInvalidRequestShapingError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "request_invalid_request_shaping",
    category: "request",
    httpStatus: 400,
    retryable: false
  });
}

function createInvalidAuthStrategyError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_auth_strategy",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoReservedHeaders(
  headers: Record<string, string>,
  createError: (message: string) => GatewayError
) {
  for (const key of Object.keys(headers)) {
    if (RESERVED_HEADER_NAMES.has(key.toLowerCase())) {
      throw createError(
        `Request shaping cannot override reserved header: ${key}`
      );
    }
  }
}

function parseStringMap(
  value: unknown,
  fieldName: "headers" | "query",
  createError: (message: string) => GatewayError
): Record<string, string> {
  if (!isRecord(value)) {
    throw createError(
      `Request shaping field "${fieldName}" must be an object`
    );
  }

  const result: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      throw createError(
        `Request shaping field "${fieldName}" values must be strings`
      );
    }

    result[key] = entryValue;
  }

  return result;
}

function validateRequestShapingProfileWithErrorFactory(
  value: unknown,
  createError: (message: string) => GatewayError
): RequestShapingProfile {
  if (!isRecord(value)) {
    throw createError("Request shaping profile must be an object");
  }

  const profile: RequestShapingProfile = {};

  for (const key of Object.keys(value)) {
    if (key !== "headers" && key !== "query" && key !== "jsonBody") {
      throw createError(
        `Request shaping profile contains unsupported field: ${key}`
      );
    }
  }

  if (value.headers !== undefined) {
    profile.headers = parseStringMap(value.headers, "headers", createError);
    assertNoReservedHeaders(profile.headers, createError);
  }

  if (value.query !== undefined) {
    profile.query = parseStringMap(value.query, "query", createError);
  }

  if (value.jsonBody !== undefined) {
    if (!isRecord(value.jsonBody)) {
      throw createError(
        'Request shaping field "jsonBody" must be an object'
      );
    }

    profile.jsonBody = value.jsonBody;
  }

  return profile;
}

export function validateRequestShapingProfile(
  value: unknown
): RequestShapingProfile {
  return validateRequestShapingProfileWithErrorFactory(
    value,
    createInvalidShapingError
  );
}

export function parseRouteRequestShaping(
  value: string | undefined
): RouteRequestShapingMap {
  if (!value) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw createInvalidShapingError(
      "Request shaping config must be valid JSON"
    );
  }

  if (!isRecord(parsed)) {
    throw createInvalidShapingError(
      "Request shaping config must be a JSON object"
    );
  }

  const shapingByRoute: RouteRequestShapingMap = {};

  for (const [externalModel, profile] of Object.entries(parsed)) {
    shapingByRoute[externalModel] = validateRequestShapingProfile(profile);
  }

  return shapingByRoute;
}

export function parseRequestRequestShaping(
  value: unknown
): RequestShapingProfile {
  return validateRequestShapingProfileWithErrorFactory(
    value,
    createInvalidRequestShapingError
  );
}

export function mergeRequestShapingProfiles(
  base: RequestShapingProfile | undefined,
  override: RequestShapingProfile | undefined
): RequestShapingProfile {
  return {
    ...(base?.headers || override?.headers
      ? {
          headers: {
            ...(base?.headers ?? {}),
            ...(override?.headers ?? {})
          }
        }
      : {}),
    ...(base?.query || override?.query
      ? {
          query: {
            ...(base?.query ?? {}),
            ...(override?.query ?? {})
          }
        }
      : {}),
    ...(base?.jsonBody || override?.jsonBody
      ? {
          jsonBody: {
            ...(base?.jsonBody ?? {}),
            ...(override?.jsonBody ?? {})
          }
        }
      : {})
  };
}

export function applyRequestShaping(
  request: OutboundRequestShape,
  shaping: RequestShapingProfile
): OutboundRequestShape {
  const shapedHeaders = { ...request.headers };

  assertNoReservedHeaders(shaping.headers ?? {}, createInvalidShapingError);

  for (const [key, value] of Object.entries(shaping.headers ?? {})) {
    shapedHeaders[key] = value;
  }

  return {
    ...request,
    headers: shapedHeaders,
    query: {
      ...request.query,
      ...(shaping.query ?? {})
    },
    jsonBody: {
      ...request.jsonBody,
      ...(shaping.jsonBody ?? {})
    }
  };
}

export function applyAuthStrategy(
  request: OutboundRequestShape,
  strategy: OutboundAuthStrategy,
  secrets: Record<string, string>
): OutboundRequestShape {
  const secretValue = secrets[strategy.credential.secretRef];

  if (!secretValue) {
    throw createInvalidAuthStrategyError(
      `Auth strategy references an unknown secret ref: ${strategy.credential.secretRef}`
    );
  }

  const headerValue =
    strategy.type === "header_bearer"
      ? `Bearer ${secretValue}`
      : secretValue;

  return {
    ...request,
    headers: {
      ...request.headers,
      [strategy.headerName]: headerValue
    }
  };
}

export function buildRequestUrl(
  baseUrl: string,
  request: Pick<OutboundRequestShape, "path" | "query">
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedPath = request.path.startsWith("/")
    ? request.path
    : `/${request.path}`;
  const url = new URL(`${normalizedBaseUrl}${normalizedPath}`);

  for (const [key, value] of Object.entries(request.query)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}
