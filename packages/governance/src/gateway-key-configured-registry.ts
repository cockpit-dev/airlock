import { GatewayError } from "@airlock/shared";

import {
  applyGatewayApiKeyMetadataOverride,
  parseGatewayApiKeyMetadataOverride,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";
import {
  createGatewayKeyAuditEvent,
  parseOptionalGatewayKeyAuditReason,
  type GatewayKeyAuditEvent,
  type GatewayKeyAuditActorContext
} from "./gateway-key-audit.js";
import { requireConfiguredGatewayApiKeyById } from "./gateway-key-identity.js";
import {
  parseGatewayKeyRegistryLifecycleActionRequest,
  gatewayKeyAuditActorContextFromRegistryRequest,
  toGatewayKeyAuditActorContextRecord,
  type GatewayKeyRegistryStoredOverride
} from "./gateway-key-registry.js";
import {
  getGatewayApiKeyStatusSnapshot,
  type GatewayKeyStatusSnapshotPort
} from "./gateway-key-status.js";

export interface ConfiguredGatewayApiKeyRuntimePort {
  readRegistryOverride(
    gatewayApiKey: GatewayApiKeyRecord
  ): Promise<GatewayKeyRegistryStoredOverride | null>;
}

export interface UpdateConfiguredGatewayKeyRegistryOverridePort {
  writeRegistryOverride(
    gatewayApiKey: GatewayApiKeyRecord,
    override: ReturnType<typeof parseGatewayApiKeyMetadataOverride>,
    audit?: {
      actorContext?: GatewayKeyAuditActorContext;
      reason?: string;
      operationId?: string;
    }
  ): Promise<{
    override: GatewayKeyRegistryStoredOverride;
    auditEvent?: GatewayKeyAuditEvent;
  }>;
}

export interface ClearConfiguredGatewayKeyRegistryOverridePort {
  clearRegistryOverride(
    gatewayApiKey: GatewayApiKeyRecord,
    audit?: {
      actorContext?: GatewayKeyAuditActorContext;
      reason?: string;
      operationId?: string;
    }
  ): Promise<{
    auditEvent?: GatewayKeyAuditEvent;
  }>;
}

export interface ConfiguredGatewayApiKeyStatusSnapshotPort
  extends GatewayKeyStatusSnapshotPort {
  gatewayApiKeys: readonly GatewayApiKeyRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createConfiguredKeyRegistryOverridePayloadError(cause?: unknown) {
  return new GatewayError("Gateway key registry override payload is invalid", {
    code: "config_invalid_gateway_api_keys",
    category: "configuration",
    httpStatus: 400,
    retryable: false,
    ...(cause ? { cause } : {})
  });
}

export function parseConfiguredGatewayKeyRegistryOverrideUpdatePayload(payload: unknown): {
  override: GatewayApiKeyMetadataOverride;
  reason?: string;
} {
  if (!isRecord(payload)) {
    throw createConfiguredKeyRegistryOverridePayloadError();
  }

  const allowedKeys = new Set([
    "label",
    "status",
    "notBefore",
    "expiresAt",
    "policy",
    "reason"
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      throw createConfiguredKeyRegistryOverridePayloadError(
        new Error(`Unsupported field: ${key}`)
      );
    }
  }

  const hasUpdateField =
    payload.label !== undefined ||
    payload.status !== undefined ||
    payload.notBefore !== undefined ||
    payload.expiresAt !== undefined ||
    payload.policy !== undefined;

  if (!hasUpdateField) {
    throw createConfiguredKeyRegistryOverridePayloadError(
      new Error("At least one mutable metadata field is required")
    );
  }

  try {
    const parsedReason =
      payload.reason !== undefined
        ? parseOptionalGatewayKeyAuditReason(payload.reason)
        : undefined;

    return {
      override: parseGatewayApiKeyMetadataOverride(payload),
      ...(parsedReason !== undefined ? { reason: parsedReason } : {})
    };
  } catch (cause) {
    throw createConfiguredKeyRegistryOverridePayloadError(cause);
  }
}

export function parseConfiguredGatewayKeyRegistryOverrideClearPayload(payload: unknown): {
  reason?: string;
} {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (!isRecord(payload)) {
    throw createConfiguredKeyRegistryOverridePayloadError();
  }

  const allowedKeys = new Set(["reason"]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      throw createConfiguredKeyRegistryOverridePayloadError(
        new Error(`Unsupported field: ${key}`)
      );
    }
  }

  try {
    const parsedReason =
      payload.reason !== undefined
        ? parseOptionalGatewayKeyAuditReason(payload.reason)
        : undefined;

    return parsedReason !== undefined ? { reason: parsedReason } : {};
  } catch (cause) {
    throw createConfiguredKeyRegistryOverridePayloadError(cause);
  }
}

export async function resolveConfiguredGatewayApiKeyRuntime(
  gatewayApiKey: GatewayApiKeyRecord,
  port: ConfiguredGatewayApiKeyRuntimePort
): Promise<{
  runtimeGatewayApiKey: GatewayApiKeyRecord;
  registryOverride: GatewayKeyRegistryStoredOverride | null;
}> {
  const registryOverride = await port.readRegistryOverride(gatewayApiKey);

  return {
    runtimeGatewayApiKey: applyGatewayApiKeyMetadataOverride(
      gatewayApiKey,
      registryOverride ?? undefined
    ),
    registryOverride
  };
}

export async function updateConfiguredGatewayKeyRegistryOverride(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  port: UpdateConfiguredGatewayKeyRegistryOverridePort,
  audit?: {
    actorContext?: GatewayKeyAuditActorContext;
    reason?: string;
    operationId?: string;
  }
): Promise<{
  keyId: string;
  override: GatewayKeyRegistryStoredOverride;
  auditEvent?: GatewayKeyAuditEvent;
}> {
  const gatewayApiKey = requireConfiguredGatewayApiKeyById(
    gatewayApiKeys,
    keyId,
    requestId
  );
  const parsedPayload = parseConfiguredGatewayKeyRegistryOverrideUpdatePayload(
    payload
  );
  const writeResult = await port.writeRegistryOverride(
    gatewayApiKey,
    parsedPayload.override,
    {
      ...(audit?.actorContext ? { actorContext: audit.actorContext } : {}),
      ...(parsedPayload.reason ? { reason: parsedPayload.reason } : {}),
      ...(audit?.reason ? { reason: audit.reason } : {}),
      ...(audit?.operationId ? { operationId: audit.operationId } : {})
    }
  );
  const auditEvent =
    writeResult.auditEvent ??
    createGatewayKeyAuditEvent({
      keyId: gatewayApiKey.id,
      kind: "override_updated",
      ownership: "configured",
      occurredAt: writeResult.override.updatedAt,
      ...(audit?.operationId ? { operationId: audit.operationId } : {}),
      ...(audit?.reason ? { reason: audit.reason } : {}),
      ...(audit?.actorContext
        ? {
            actor: audit.actorContext.actor,
            actorSource: audit.actorContext.actorSource
          }
        : {}),
      changes: [
        {
          field: "registryOverride",
          after: writeResult.override as unknown as Record<string, unknown>
        }
      ]
    });

  return {
    keyId: gatewayApiKey.id,
    override: writeResult.override,
    ...(auditEvent ? { auditEvent } : {})
  };
}

export async function clearConfiguredGatewayKeyRegistryOverride(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  port: ClearConfiguredGatewayKeyRegistryOverridePort,
  audit?: {
    actorContext?: GatewayKeyAuditActorContext;
    reason?: string;
    operationId?: string;
  }
): Promise<{
  keyId: string;
  override: null;
  auditEvent?: GatewayKeyAuditEvent;
}> {
  const gatewayApiKey = requireConfiguredGatewayApiKeyById(
    gatewayApiKeys,
    keyId,
    requestId
  );
  const parsedPayload = parseConfiguredGatewayKeyRegistryOverrideClearPayload(
    payload
  );

  const clearResult = await port.clearRegistryOverride(gatewayApiKey, {
    ...(audit?.actorContext ? { actorContext: audit.actorContext } : {}),
    ...(parsedPayload.reason ? { reason: parsedPayload.reason } : {}),
    ...(audit?.reason ? { reason: audit.reason } : {}),
    ...(audit?.operationId ? { operationId: audit.operationId } : {})
  });
  const auditEvent =
    clearResult.auditEvent ??
    createGatewayKeyAuditEvent({
      keyId: gatewayApiKey.id,
      kind: "override_cleared",
      ownership: "configured",
      occurredAt: new Date().toISOString(),
      ...(audit?.operationId ? { operationId: audit.operationId } : {}),
      ...(audit?.reason ? { reason: audit.reason } : {}),
      ...(audit?.actorContext
        ? {
            actor: audit.actorContext.actor,
            actorSource: audit.actorContext.actorSource
          }
        : {}),
      changes: [
        {
          field: "registryOverride",
          after: null
        }
      ]
    });

  return {
    keyId: gatewayApiKey.id,
    override: null,
    ...(auditEvent ? { auditEvent } : {})
  };
}

export async function getConfiguredGatewayApiKeyStatusSnapshot(
  keyId: string,
  requestId: string,
  port: ConfiguredGatewayApiKeyStatusSnapshotPort
) {
  return getGatewayApiKeyStatusSnapshot(
    requireConfiguredGatewayApiKeyById(port.gatewayApiKeys, keyId, requestId),
    "configured",
    port
  );
}

export interface GatewayKeyRegistryOverrideMutationRequest {
  override: GatewayApiKeyMetadataOverride;
  auditMetadata?: {
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  };
}

export function parseGatewayKeyRegistryOverrideAuditMetadata(value: unknown):
  | {
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    }
  | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = parseGatewayKeyRegistryLifecycleActionRequest(
    value,
    "Gateway configured key registry override payload is invalid"
  );
  const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(value);

  if (!parsed.reason && !actorContext) {
    return undefined;
  }

  return {
    ...(parsed.reason ? { reason: parsed.reason } : {}),
    ...(actorContext ? toGatewayKeyAuditActorContextRecord(actorContext) : {})
  };
}

export function parseGatewayKeyRegistryOverrideMutationRequest(
  value: unknown
): GatewayKeyRegistryOverrideMutationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const parsed =
      parseConfiguredGatewayKeyRegistryOverrideUpdatePayload(value);
    return {
      override: parsed.override,
      ...(parsed.reason ? { auditMetadata: { reason: parsed.reason } } : {})
    };
  }

  const record = value as Record<string, unknown>;

  if ("override" in record) {
    const parsedOverride =
      parseConfiguredGatewayKeyRegistryOverrideUpdatePayload(record.override);
    const parsedAuditMetadata =
      "auditMetadata" in record
        ? parseGatewayKeyRegistryOverrideAuditMetadata(record.auditMetadata)
        : undefined;

    return {
      override: parsedOverride.override,
      ...(parsedOverride.reason || parsedAuditMetadata
        ? {
            auditMetadata: {
              ...(parsedOverride.reason
                ? { reason: parsedOverride.reason }
                : {}),
              ...(parsedAuditMetadata ?? {})
            }
          }
        : {})
    };
  }

  const parsed = parseConfiguredGatewayKeyRegistryOverrideUpdatePayload(value);
  return {
    override: parsed.override,
    ...(parsed.reason ? { auditMetadata: { reason: parsed.reason } } : {})
  };
}

export function parseGatewayKeyRegistryOverrideClearRequest(value: unknown): {
  auditMetadata?: {
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  };
} {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "auditMetadata" in value
  ) {
    const record = value as Record<string, unknown>;
    const parsedBody = parseConfiguredGatewayKeyRegistryOverrideClearPayload(
      "reason" in record ? { reason: record.reason } : {}
    );
    const parsedAuditMetadata = parseGatewayKeyRegistryOverrideAuditMetadata(
      record.auditMetadata
    );

    return {
      ...(parsedBody.reason || parsedAuditMetadata
        ? {
            auditMetadata: {
              ...(parsedBody.reason ? { reason: parsedBody.reason } : {}),
              ...(parsedAuditMetadata ?? {})
            }
          }
        : {})
    };
  }

  const parsed = parseConfiguredGatewayKeyRegistryOverrideClearPayload(value);
  return {
    ...(parsed.reason ? { auditMetadata: { reason: parsed.reason } } : {})
  };
}

export type {
  GatewayApiKeyMetadataOverride
};
