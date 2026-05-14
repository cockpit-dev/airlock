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
  signing?: OutboundSigningStrategy;
}

export interface TargetScopedRouteShapingProfile {
  defaults?: RequestShapingProfile;
  targets: Record<string, RequestShapingProfile>;
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

export type HmacSha256SigningComponent =
  | "method"
  | "path"
  | "query"
  | "body_sha256"
  | `header:${string}`;

export interface HmacSha256HeaderSigningStrategy {
  type: "hmac_sha256_header";
  headerName: string;
  secret: SecretRef;
  components: HmacSha256SigningComponent[];
  prefix?: string;
}

export type OutboundAuthStrategy =
  | HeaderBearerAuthStrategy
  | HeaderValueAuthStrategy;

export type OutboundSigningStrategy = HmacSha256HeaderSigningStrategy;

export type RouteRequestShapingProfile =
  | RequestShapingProfile
  | TargetScopedRouteShapingProfile;

export type RouteRequestShapingMap = Record<string, RouteRequestShapingProfile>;

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

function createInvalidSigningStrategyError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_signing_strategy",
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

function assertNoSigningHeaderCollision(
  headers: Record<string, string> | undefined,
  signing: OutboundSigningStrategy | undefined,
  createError: (message: string) => GatewayError
) {
  if (!headers || !signing) {
    return;
  }

  const normalizedSigningHeader = signing.headerName.toLowerCase();

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedSigningHeader) {
      throw createError(
        `Request shaping cannot override signing output header: ${key}`
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

function validateSecretRef(
  value: unknown,
  createError: (message: string) => GatewayError
): SecretRef {
  if (!isRecord(value)) {
    throw createError("Secret ref must be an object");
  }

  if (typeof value.secretRef !== "string" || value.secretRef.trim().length === 0) {
    throw createError("Secret ref must define a non-empty secretRef string");
  }

  return {
    secretRef: value.secretRef.trim()
  };
}

function validateSigningComponent(
  value: unknown,
  createError: (message: string) => GatewayError
): HmacSha256SigningComponent {
  if (typeof value !== "string") {
    throw createError("Signing strategy components must be strings");
  }

  if (
    value === "method" ||
    value === "path" ||
    value === "query" ||
    value === "body_sha256"
  ) {
    return value;
  }

  if (value.startsWith("header:")) {
    const headerName = value.slice("header:".length).trim();

    if (headerName.length === 0) {
      throw createError(
        "Signing header components must reference a non-empty header name"
      );
    }

    return `header:${headerName}`;
  }

  throw createError(`Unsupported signing component: ${value}`);
}

function validateSigningStrategy(value: unknown): OutboundSigningStrategy {
  if (!isRecord(value)) {
    throw createInvalidSigningStrategyError("Signing strategy must be an object");
  }

  if (value.type !== "hmac_sha256_header") {
    throw createInvalidSigningStrategyError(
      "Signing strategy type must be hmac_sha256_header"
    );
  }

  if (typeof value.headerName !== "string" || value.headerName.trim().length === 0) {
    throw createInvalidSigningStrategyError(
      "Signing strategy headerName must be a non-empty string"
    );
  }

  if (RESERVED_HEADER_NAMES.has(value.headerName.trim().toLowerCase())) {
    throw createInvalidSigningStrategyError(
      `Signing strategy cannot target reserved header: ${value.headerName.trim()}`
    );
  }

  if (!Array.isArray(value.components) || value.components.length === 0) {
    throw createInvalidSigningStrategyError(
      "Signing strategy must define at least one component"
    );
  }

  if (value.prefix !== undefined && typeof value.prefix !== "string") {
    throw createInvalidSigningStrategyError(
      "Signing strategy prefix must be a string when provided"
    );
  }

  const headerName = value.headerName.trim();
  const components = value.components.map((component) => {
    return validateSigningComponent(
      component,
      createInvalidSigningStrategyError
    );
  });

  for (const component of components) {
    if (
      component.startsWith("header:") &&
      component.slice("header:".length).trim().toLowerCase() ===
        headerName.toLowerCase()
    ) {
      throw createInvalidSigningStrategyError(
        `Signing strategy cannot reference its own output header: ${headerName}`
      );
    }
  }

  return {
    type: "hmac_sha256_header",
    headerName,
    secret: validateSecretRef(value.secret, createInvalidSigningStrategyError),
    components,
    ...(value.prefix !== undefined ? { prefix: value.prefix } : {})
  };
}

function validateRequestShapingProfileWithErrorFactory(
  value: unknown,
  createError: (message: string) => GatewayError,
  allowSigning = false
): RequestShapingProfile {
  if (!isRecord(value)) {
    throw createError("Request shaping profile must be an object");
  }

  const profile: RequestShapingProfile = {};

  for (const key of Object.keys(value)) {
    if (
      key !== "headers" &&
      key !== "query" &&
      key !== "jsonBody" &&
      !(allowSigning && key === "signing")
    ) {
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

  if (allowSigning && value.signing !== undefined) {
    profile.signing = validateSigningStrategy(value.signing);
  }

  assertNoSigningHeaderCollision(profile.headers, profile.signing, createError);

  return profile;
}

export function validateRequestShapingProfile(
  value: unknown
): RequestShapingProfile {
  return validateRequestShapingProfileWithErrorFactory(
    value,
    createInvalidShapingError,
    true
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
    if (
      isRecord(profile) &&
      "targets" in profile &&
      profile.targets !== undefined
    ) {
      for (const key of Object.keys(profile)) {
        if (key !== "targets" && key !== "defaults") {
          throw createInvalidShapingError(
            `Request shaping profile contains unsupported field: ${key}`
          );
        }
      }

      if (!isRecord(profile.targets)) {
        throw createInvalidShapingError(
          'Request shaping "targets" field must be an object'
        );
      }

      const targets: Record<string, RequestShapingProfile> = {};
      const defaults =
        profile.defaults !== undefined
          ? validateRequestShapingProfile(profile.defaults)
          : undefined;

      for (const [targetKey, targetProfile] of Object.entries(profile.targets)) {
        if (targetKey.trim().length === 0) {
          throw createInvalidShapingError(
            "Target-scoped request shaping keys must be non-empty strings"
          );
        }

        targets[targetKey.trim()] = validateRequestShapingProfile(targetProfile);
      }

      if (Object.keys(targets).length === 0) {
        throw createInvalidShapingError(
          'Target-scoped request shaping must define at least one target profile'
        );
      }

      shapingByRoute[externalModel] = {
        ...(defaults ? { defaults } : {}),
        targets
      };
      continue;
    }

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
  const resolvedSigning = override?.signing ?? base?.signing;

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
      : {}),
    ...(resolvedSigning
      ? {
          signing: resolvedSigning
        }
      : {})
  };
}

export function isTargetScopedRouteShapingProfile(
  value: RouteRequestShapingProfile | undefined
): value is TargetScopedRouteShapingProfile {
  return isRecord(value) && "targets" in value;
}

export function resolveRouteRequestShapingForTarget(
  shaping: RouteRequestShapingProfile | undefined,
  primaryTargetKey: string,
  activeTargetKey: string
): RequestShapingProfile | undefined {
  if (!shaping) {
    return undefined;
  }

  if (isTargetScopedRouteShapingProfile(shaping)) {
    const activeTargetShaping = shaping.targets[activeTargetKey];

    if (activeTargetShaping) {
      return mergeRequestShapingProfiles(shaping.defaults, activeTargetShaping);
    }

    const primaryProvider = primaryTargetKey.split(":")[0];
    const activeProvider = activeTargetKey.split(":")[0];

    if (primaryProvider === activeProvider) {
      return shaping.defaults;
    }

    return undefined;
  }

  const primaryProvider = primaryTargetKey.split(":")[0];
  const activeProvider = activeTargetKey.split(":")[0];

  return primaryProvider === activeProvider ? shaping : undefined;
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

function resolveHeaderValue(
  headers: Record<string, string>,
  headerName: string
): string {
  const normalizedHeaderName = headerName.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }

  throw createInvalidSigningStrategyError(
    `Signing strategy references a missing header component: ${headerName}`
  );
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
}

function serializeSortedQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      return `${key}=${query[key] ?? ""}`;
    })
    .join("&");
}

async function resolveSigningComponentValue(
  request: OutboundRequestShape,
  component: HmacSha256SigningComponent
): Promise<string> {
  if (component === "method") {
    return request.method;
  }

  if (component === "path") {
    return request.path;
  }

  if (component === "query") {
    return serializeSortedQuery(request.query);
  }

  if (component === "body_sha256") {
    return sha256Hex(JSON.stringify(request.jsonBody));
  }

  if (component.startsWith("header:")) {
    const headerName = component.slice("header:".length).trim();

    if (headerName.length === 0) {
      throw createInvalidSigningStrategyError(
        "Signing header components must reference a non-empty header name"
      );
    }

    return resolveHeaderValue(request.headers, headerName);
  }

  throw createInvalidSigningStrategyError(
    `Unsupported signing component: ${component}`
  );
}

export async function applySigningStrategy(
  request: OutboundRequestShape,
  strategy: OutboundSigningStrategy,
  secrets: Record<string, string>
): Promise<OutboundRequestShape> {
  if (RESERVED_HEADER_NAMES.has(strategy.headerName.trim().toLowerCase())) {
    throw createInvalidSigningStrategyError(
      `Signing strategy cannot target reserved header: ${strategy.headerName.trim()}`
    );
  }

  assertNoSigningHeaderCollision(
    request.headers,
    strategy,
    createInvalidSigningStrategyError
  );

  const secretValue = secrets[strategy.secret.secretRef];

  if (!secretValue) {
    throw createInvalidSigningStrategyError(
      `Signing strategy references an unknown secret ref: ${strategy.secret.secretRef}`
    );
  }

  if (strategy.headerName.trim().length === 0) {
    throw createInvalidSigningStrategyError(
      "Signing strategy headerName must be a non-empty string"
    );
  }

  if (strategy.components.length === 0) {
    throw createInvalidSigningStrategyError(
      "Signing strategy must define at least one component"
    );
  }

  const payload = (
    await Promise.all(
      strategy.components.map(async (component) => {
        return resolveSigningComponentValue(request, component);
      })
    )
  ).join("\n");
  const digest = await hmacSha256Hex(secretValue, payload);

  return {
    ...request,
    headers: {
      ...request.headers,
      [strategy.headerName]:
        strategy.prefix !== undefined ? `${strategy.prefix}${digest}` : digest
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
