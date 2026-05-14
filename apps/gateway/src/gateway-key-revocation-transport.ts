import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

export const REVOCATION_OPERATION_LOG_OBJECT_NAME =
  "gateway-key-revocation-operations";

export function isGatewayKeyRevocationEnabled(env: GatewayBindings): boolean {
  return Boolean(env.AIRLOCK_GATEWAY_KEY_REVOCATION);
}

export function createGatewayKeyRevocationUnavailableError(
  requestId: string,
  cause?: unknown
): GatewayError {
  return new GatewayError("Gateway key revocation subsystem is unavailable", {
    code: "gateway_key_revocation_unavailable",
    category: "governance",
    httpStatus: 503,
    retryable: true,
    requestId,
    ...(cause ? { cause } : {})
  });
}

export function createGatewayKeyRevocationInvalidResponseError(
  requestId: string,
  cause?: unknown
): GatewayError {
  return new GatewayError(
    "Gateway key revocation subsystem returned an invalid response",
    {
      code: "gateway_key_revocation_invalid_response",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      ...(cause ? { cause } : {})
    }
  );
}

export function requireGatewayKeyRevocationNamespace(
  env: GatewayBindings,
  requestId: string
) {
  const namespace = env.AIRLOCK_GATEWAY_KEY_REVOCATION;

  if (!namespace) {
    throw createGatewayKeyRevocationUnavailableError(requestId);
  }

  return namespace;
}

export function buildGatewayKeyRevocationStateRequest(
  requestId: string,
  init: RequestInit
): Request {
  return new Request("https://airlock.internal/gateway-key-revocation", {
    ...init,
    headers: {
      "x-airlock-request-id": requestId,
      ...(init.headers ?? {})
    }
  });
}

export function buildGatewayKeyRevocationEventsRequest(
  requestId: string,
  keyId: string
): Request {
  const url = new URL("https://airlock.internal/gateway-key-revocation");
  url.searchParams.set("kind", "events");
  url.searchParams.set("keyId", keyId);

  return new Request(url, {
    method: "GET",
    headers: {
      "x-airlock-request-id": requestId
    }
  });
}

export function buildGatewayKeyRevocationOperationEventsRequest(
  requestId: string,
  operationId: string
): Request {
  const url = new URL("https://airlock.internal/gateway-key-revocation");
  url.searchParams.set("kind", "operation_events");
  url.searchParams.set("operationId", operationId);

  return new Request(url, {
    method: "GET",
    headers: {
      "x-airlock-request-id": requestId
    }
  });
}

export function buildGatewayKeyRevocationOperationEventAppendRequest(
  requestId: string,
  event: unknown
): Request {
  const url = new URL("https://airlock.internal/gateway-key-revocation");
  url.searchParams.set("kind", "operation_events");

  return new Request(url, {
    method: "POST",
    headers: {
      "x-airlock-request-id": requestId,
      "content-type": "application/json"
    },
    body: JSON.stringify(event)
  });
}

export async function fetchParsedRevocationResponse<T>(
  getStub: () => Promise<{
    fetch(request: Request): Promise<Response>;
  }> | {
    fetch(request: Request): Promise<Response>;
  },
  request: Request,
  requestId: string,
  options: {
    parse(response: Response): Promise<T> | T;
    handleStatus?: (response: Response) => Promise<T | undefined> | T | undefined;
  }
): Promise<T> {
  let response: Response;

  try {
    response = await (await getStub()).fetch(request);
  } catch (cause) {
    throw createGatewayKeyRevocationUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    const handled = options.handleStatus
      ? await options.handleStatus(response)
      : undefined;

    if (handled !== undefined) {
      return handled;
    }

    throw createGatewayKeyRevocationUnavailableError(requestId);
  }

  try {
    return await options.parse(response);
  } catch (cause) {
    throw createGatewayKeyRevocationInvalidResponseError(requestId, cause);
  }
}
