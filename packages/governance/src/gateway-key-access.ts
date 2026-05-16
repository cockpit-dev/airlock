import { GatewayError, type ProviderId } from "@airlock/shared";

import {
  assertGatewayApiKeyIsActive,
  createUnauthorizedError,
  extractBearerToken,
  matchGatewayApiKeyByToken,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";

export interface GatewayRouteAccessRequirements {
  requiredKeyTier?: string;
  requiredKeyTags?: string[];
}

export interface GatewayKeyAuthorizationPort {
  registryEnabled: boolean;
  resolveConfiguredRuntimeKey(
    gatewayApiKey: GatewayApiKeyRecord
  ): Promise<GatewayApiKeyRecord>;
  findRegistryKeyByToken(
    bearerToken: string
  ): Promise<GatewayApiKeyRecord | undefined>;
  assertNotRevoked(gatewayApiKey: GatewayApiKeyRecord): Promise<void>;
}

export async function authorizeGatewayKeyAccess(
  authorization: string | undefined,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId: string,
  port: GatewayKeyAuthorizationPort
): Promise<GatewayApiKeyRecord> {
  const bearerToken = extractBearerToken(authorization, requestId);
  const matchedGatewayApiKey = await matchGatewayApiKeyByToken(
    bearerToken,
    gatewayApiKeys
  );

  if (matchedGatewayApiKey) {
    const resolvedGatewayApiKey = port.registryEnabled
      ? await port.resolveConfiguredRuntimeKey(matchedGatewayApiKey)
      : matchedGatewayApiKey;
    const activeGatewayApiKey = assertGatewayApiKeyIsActive(
      resolvedGatewayApiKey,
      requestId
    );

    await port.assertNotRevoked(activeGatewayApiKey);

    return activeGatewayApiKey;
  }

  if (!port.registryEnabled) {
    throw createUnauthorizedError(requestId);
  }

  const registryGatewayApiKey = await port.findRegistryKeyByToken(bearerToken);

  if (!registryGatewayApiKey) {
    throw createUnauthorizedError(requestId);
  }

  const activeGatewayApiKey = assertGatewayApiKeyIsActive(
    registryGatewayApiKey,
    requestId
  );

  await port.assertNotRevoked(activeGatewayApiKey);

  return activeGatewayApiKey;
}

export function assertGatewayKeyAllowsModelAccess(
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

export function assertGatewayKeyAllowsRouteAccess(
  gatewayApiKey: GatewayApiKeyRecord,
  requirements: GatewayRouteAccessRequirements,
  requestId: string
) {
  const requiredKeyTier = requirements.requiredKeyTier;
  const requiredKeyTags = requirements.requiredKeyTags;

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

export function assertGatewayKeyAllowsProviderAccess(
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
