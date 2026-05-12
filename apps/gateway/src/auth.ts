import type { Context } from "hono";

import {
  requireGatewayAuthorization as requireAuthorization,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError, type ProviderId } from "@airlock/shared";

import type { GatewayConfig } from "./config.js";

export function requireGatewayAuthorization(
  context: Context,
  config: GatewayConfig,
  requestId: string
) {
  return requireAuthorization(
    context.req.header("authorization"),
    config.gatewayApiKeys,
    requestId
  );
}

export function assertGatewayKeyAllowsModel(
  gatewayApiKey: GatewayApiKeyRecord,
  externalModel: string,
  requestId: string
) {
  const allowedExternalModels = gatewayApiKey.policy?.allowedExternalModels;

  if (!allowedExternalModels) {
    return;
  }

  if (!allowedExternalModels.includes(externalModel)) {
    throw new GatewayError("Gateway API key is not allowed to access this model", {
      code: "auth_model_not_allowed",
      category: "authorization",
      httpStatus: 403,
      retryable: false,
      requestId
    });
  }
}

export function assertGatewayKeyAllowsProvider(
  gatewayApiKey: GatewayApiKeyRecord,
  provider: ProviderId,
  requestId: string
) {
  const allowedProviders = gatewayApiKey.policy?.allowedProviders;

  if (!allowedProviders) {
    return;
  }

  if (!allowedProviders.includes(provider)) {
    throw new GatewayError("Gateway API key is not allowed to access this provider", {
      code: "auth_provider_not_allowed",
      category: "authorization",
      httpStatus: 403,
      retryable: false,
      requestId
    });
  }
}
