import { GatewayError } from "@airlock/shared";

import type { GatewayApiKeyRecord } from "./gateway-auth.js";

export interface GatewayApiKeyRuntimeDependencyAvailability {
  gatewayKeyQuota: boolean;
  gatewayKeyTokenQuota: boolean;
  gatewayKeyConcurrency: boolean;
}

function createMissingGatewayKeyQuotaError(requestId?: string): GatewayError {
  return new GatewayError("Gateway key quota binding is required", {
    code: "config_missing_gateway_key_quota",
    category: "configuration",
    httpStatus: 500,
    retryable: false,
    ...(requestId ? { requestId } : {})
  });
}

function createMissingGatewayKeyTokenQuotaError(
  requestId?: string
): GatewayError {
  return new GatewayError("Gateway key token quota binding is required", {
    code: "config_missing_gateway_key_token_quota",
    category: "configuration",
    httpStatus: 500,
    retryable: false,
    ...(requestId ? { requestId } : {})
  });
}

function createMissingGatewayKeyConcurrencyError(
  requestId?: string
): GatewayError {
  return new GatewayError("Gateway key concurrency binding is required", {
    code: "config_missing_gateway_key_concurrency",
    category: "configuration",
    httpStatus: 500,
    retryable: false,
    ...(requestId ? { requestId } : {})
  });
}

export function assertGatewayApiKeyRuntimeDependencies(
  gatewayApiKey: GatewayApiKeyRecord,
  availability: GatewayApiKeyRuntimeDependencyAvailability,
  requestId?: string
) {
  if (
    gatewayApiKey.policy?.requestQuota !== undefined &&
    !availability.gatewayKeyQuota
  ) {
    throw createMissingGatewayKeyQuotaError(requestId);
  }

  if (
    gatewayApiKey.policy?.tokenQuota !== undefined &&
    !availability.gatewayKeyTokenQuota
  ) {
    throw createMissingGatewayKeyTokenQuotaError(requestId);
  }

  if (
    gatewayApiKey.policy?.concurrencyQuota !== undefined &&
    !availability.gatewayKeyConcurrency
  ) {
    throw createMissingGatewayKeyConcurrencyError(requestId);
  }
}

export function assertGatewayApiKeysRuntimeDependencies(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  availability: GatewayApiKeyRuntimeDependencyAvailability,
  requestId?: string
) {
  const requestQuotaKeys = gatewayApiKeys.filter((gatewayApiKey) => {
    return gatewayApiKey.policy?.requestQuota !== undefined;
  });
  const tokenQuotaKeys = gatewayApiKeys.filter((gatewayApiKey) => {
    return gatewayApiKey.policy?.tokenQuota !== undefined;
  });
  const concurrencyKeys = gatewayApiKeys.filter((gatewayApiKey) => {
    return gatewayApiKey.policy?.concurrencyQuota !== undefined;
  });

  for (const gatewayApiKey of requestQuotaKeys) {
    assertGatewayApiKeyRuntimeDependencies(
      gatewayApiKey,
      availability,
      requestId
    );
  }

  for (const gatewayApiKey of tokenQuotaKeys) {
    assertGatewayApiKeyRuntimeDependencies(
      gatewayApiKey,
      availability,
      requestId
    );
  }

  for (const gatewayApiKey of concurrencyKeys) {
    assertGatewayApiKeyRuntimeDependencies(
      gatewayApiKey,
      availability,
      requestId
    );
  }
}
