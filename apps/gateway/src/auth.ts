import type { Context } from "hono";

import {
  requireGatewayAuthorization as requireAuthorization,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError, type ProviderId } from "@airlock/shared";
import type { ModelRoute } from "@airlock/routing";

import type { GatewayConfig } from "./config.js";
import type { GatewayBindings } from "./env.js";
import { assertGatewayKeyNotRevoked } from "./gateway-key-revocation.js";

export async function requireGatewayAuthorization(
  context: Context<{
    Bindings: GatewayBindings;
  }>,
  config: GatewayConfig,
  requestId: string
) {
  const gatewayApiKey = await requireAuthorization(
    context.req.header("authorization"),
    config.gatewayApiKeys,
    requestId
  );

  await assertGatewayKeyNotRevoked(context.env, gatewayApiKey, requestId);

  return gatewayApiKey;
}

export function assertGatewayKeyAllowsModel(
  gatewayApiKey: GatewayApiKeyRecord,
  externalModel: string,
  requestId: string,
  modelGroups: Record<string, string[]>
) {
  const allowedExternalModels = gatewayApiKey.policy?.allowedExternalModels;
  const allowedModelGroups = gatewayApiKey.policy?.allowedModelGroups;

  if (!allowedExternalModels && !allowedModelGroups) {
    return;
  }

  const isExplicitlyAllowed = allowedExternalModels?.includes(externalModel);
  const isAllowedByGroup = allowedModelGroups?.some((groupName) => {
    return modelGroups[groupName]?.includes(externalModel);
  });

  if (!isExplicitlyAllowed && !isAllowedByGroup) {
    throw new GatewayError("Gateway API key is not allowed to access this model", {
      code: "auth_model_not_allowed",
      category: "authorization",
      httpStatus: 403,
      retryable: false,
      requestId
    });
  }
}

export function assertGatewayKeyAllowsRoute(
  gatewayApiKey: GatewayApiKeyRecord,
  route: ModelRoute,
  requestId: string
) {
  const requiredKeyTier = route.requiredKeyTier;
  const requiredKeyTags = route.requiredKeyTags;

  if (!requiredKeyTier && !requiredKeyTags) {
    return;
  }

  const keyTier = gatewayApiKey.policy?.tier;
  const keyTags = gatewayApiKey.policy?.tags ?? [];
  const satisfiesTier =
    requiredKeyTier === undefined || keyTier === requiredKeyTier;
  const satisfiesTags =
    requiredKeyTags === undefined ||
    requiredKeyTags.every((requiredTag) => {
      return keyTags.includes(requiredTag);
    });

  if (!satisfiesTier || !satisfiesTags) {
    throw new GatewayError("Gateway API key is not allowed to access this route", {
      code: "auth_route_policy_not_allowed",
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
