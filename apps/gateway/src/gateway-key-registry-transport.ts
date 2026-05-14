import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

export const REGISTRY_OBJECT_NAME = "gateway-key-registry";

export function isGatewayKeyRegistryEnabled(env: GatewayBindings): boolean {
  return (
    env.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED === true ||
    (env.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED as unknown) === "true"
  );
}

export function createGatewayKeyRegistryUnavailableError(
  requestId: string,
  cause?: unknown
): GatewayError {
  return new GatewayError("Gateway key registry subsystem is unavailable", {
    code: "gateway_key_registry_unavailable",
    category: "governance",
    httpStatus: 503,
    retryable: true,
    requestId,
    ...(cause ? { cause } : {})
  });
}

export function createGatewayKeyRegistryInvalidResponseError(
  requestId: string,
  cause?: unknown
): GatewayError {
  return new GatewayError(
    "Gateway key registry subsystem returned an invalid response",
    {
      code: "gateway_key_registry_invalid_response",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      ...(cause ? { cause } : {})
    }
  );
}

export function buildRegistryRequest(
  requestId: string,
  kind: string,
  init: RequestInit & {
    keyId?: string;
  }
): Request {
  const url = new URL("https://airlock.internal/gateway-key-registry");
  url.searchParams.set("kind", kind);

  if (init.keyId) {
    url.searchParams.set("keyId", init.keyId);
  }

  return new Request(url, {
    ...init,
    headers: {
      "x-airlock-request-id": requestId,
      ...(init.headers ?? {})
    }
  });
}

export function requireGatewayKeyRegistryNamespace(
  env: GatewayBindings,
  requestId: string
) {
  const namespace = env.AIRLOCK_GATEWAY_KEY_REGISTRY;

  if (!namespace) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  return namespace;
}

export function requireDynamicGatewayKeyRegistryNamespace(
  env: GatewayBindings,
  requestId: string
) {
  if (!isGatewayKeyRegistryEnabled(env)) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  return requireGatewayKeyRegistryNamespace(env, requestId);
}

export async function fetchParsedRegistryResponse<T>(
  getStub: () => Promise<{
    fetch(request: Request): Promise<Response>;
  }> | {
    fetch(request: Request): Promise<Response>;
  },
  request: Request,
  requestId: string,
  options: {
    parse(value: unknown): T;
    handleStatus?: (response: Response) => Promise<T | undefined> | T | undefined;
  }
): Promise<T> {
  let response: Response;

  try {
    response = await (await getStub()).fetch(request);
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    const handled = options.handleStatus
      ? await options.handleStatus(response)
      : undefined;

    if (handled !== undefined) {
      return handled;
    }

    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    return options.parse(await response.json());
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}
