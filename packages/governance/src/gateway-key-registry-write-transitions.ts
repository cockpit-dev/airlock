import {
  createGatewayKeyAuditEvent,
  type GatewayKeyAuditEvent
} from "./gateway-key-audit.js";
import {
  createStoredGatewayRegistryDynamicKey,
  createStoredGatewayRegistryFieldDiffs,
  updateStoredGatewayRegistryDynamicKey,
  type GatewayKeyRegistryStoredDynamicKey
} from "./gateway-key-registry.js";
import type { GatewayApiKeyRecord } from "./gateway-auth.js";

export interface GatewayKeyRegistryWriteTransitionAuditMetadata {
  operationId?: string;
  reason?: string;
  actor?: string;
  actorSource?: "payload" | "trusted_header" | "credential";
}

export interface GatewayKeyRegistryWriteTransition {
  nextKey: GatewayKeyRegistryStoredDynamicKey;
  auditEvent: GatewayKeyAuditEvent;
}

function buildAuditMetadataFields(
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata
) {
  return {
    ...(metadata.operationId ? { operationId: metadata.operationId } : {}),
    ...(metadata.reason ? { reason: metadata.reason } : {}),
    ...(metadata.actor ? { actor: metadata.actor } : {}),
    ...(metadata.actor && metadata.actorSource
      ? { actorSource: metadata.actorSource }
      : {})
  };
}

function buildWriteTransitionAuditEvent(
  kind: "created" | "updated" | "rotated",
  nextKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  previousKey?: GatewayKeyRegistryStoredDynamicKey
) {
  return createGatewayKeyAuditEvent({
    keyId: nextKey.id,
    kind,
    ownership: "registry",
    occurredAt: kind === "created" ? nextKey.createdAt : nextKey.updatedAt,
    ...buildAuditMetadataFields(metadata),
    ...(previousKey
      ? { changes: createStoredGatewayRegistryFieldDiffs(previousKey, nextKey) }
      : {})
  });
}

export function buildCreateGatewayRegistryKeyTransition(
  gatewayApiKey: GatewayApiKeyRecord,
  metadata: Omit<
    GatewayKeyRegistryWriteTransitionAuditMetadata,
    "operationId" | "reason"
  >,
  now = new Date().toISOString()
): GatewayKeyRegistryWriteTransition {
  const nextKey = createStoredGatewayRegistryDynamicKey(gatewayApiKey, now);

  return {
    nextKey,
    auditEvent: buildWriteTransitionAuditEvent("created", nextKey, metadata)
  };
}

export function buildBulkCreateGatewayRegistryKeyTransitions(
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyRegistryWriteTransition[] {
  return gatewayApiKeys.map((gatewayApiKey) => {
    return buildCreateGatewayRegistryKeyTransition(
      gatewayApiKey,
      metadata,
      now
    );
  });
}

export function buildUpdateGatewayRegistryKeyTransition(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  nextGatewayApiKey: GatewayApiKeyRecord & {
    previousValueHash?: string;
    previousValueHashExpiresAt?: string;
  },
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  existingGatewayApiKeys: readonly GatewayKeyRegistryStoredDynamicKey[],
  now = new Date().toISOString()
): GatewayKeyRegistryWriteTransition {
  const nextKey = updateStoredGatewayRegistryDynamicKey(
    previousKey,
    nextGatewayApiKey,
    existingGatewayApiKeys,
    undefined,
    now
  );

  return {
    nextKey,
    auditEvent: buildWriteTransitionAuditEvent(
      "updated",
      nextKey,
      metadata,
      previousKey
    )
  };
}

export function buildBulkUpdateGatewayRegistryKeyTransitions(
  entries: readonly {
    previousKey: GatewayKeyRegistryStoredDynamicKey;
    nextKey: GatewayApiKeyRecord & {
      previousValueHash?: string;
      previousValueHashExpiresAt?: string;
    };
  }[],
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  existingGatewayApiKeys: readonly GatewayKeyRegistryStoredDynamicKey[],
  now = new Date().toISOString()
): GatewayKeyRegistryWriteTransition[] {
  return entries.map((entry) => {
    return buildUpdateGatewayRegistryKeyTransition(
      entry.previousKey,
      entry.nextKey,
      metadata,
      existingGatewayApiKeys,
      now
    );
  });
}

export function buildDeleteGatewayRegistryKeyAuditEvent(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyAuditEvent {
  return createGatewayKeyAuditEvent({
    keyId: previousKey.id,
    kind: "deleted",
    ownership: "registry",
    occurredAt: now,
    ...buildAuditMetadataFields(metadata)
  });
}

export function buildBulkDeleteGatewayRegistryKeyAuditEvents(
  previousKeys: readonly GatewayKeyRegistryStoredDynamicKey[],
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyAuditEvent[] {
  return previousKeys.map((previousKey) => {
    return buildDeleteGatewayRegistryKeyAuditEvent(previousKey, metadata, now);
  });
}

export function buildRotateGatewayRegistryKeyTransition(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  rotation: {
    valueHash: string;
    overlapSeconds?: number;
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  },
  existingGatewayApiKeys: readonly GatewayKeyRegistryStoredDynamicKey[],
  now = new Date().toISOString()
): GatewayKeyRegistryWriteTransition {
  const nextGatewayApiKey =
    rotation.overlapSeconds && rotation.overlapSeconds > 0
      ? {
          ...previousKey,
          valueHash: rotation.valueHash,
          previousValueHash: previousKey.valueHash,
          previousValueHashExpiresAt: new Date(
            Date.parse(now) + rotation.overlapSeconds * 1000
          ).toISOString()
        }
      : {
          ...previousKey,
          valueHash: rotation.valueHash
        };
  const nextKey = updateStoredGatewayRegistryDynamicKey(
    previousKey,
    nextGatewayApiKey,
    existingGatewayApiKeys,
    rotation.overlapSeconds && rotation.overlapSeconds > 0
      ? undefined
      : { clearPreviousValueHash: true },
    now
  );

  return {
    nextKey,
    auditEvent: buildWriteTransitionAuditEvent(
      "rotated",
      nextKey,
      rotation,
      previousKey
    )
  };
}

export function buildBulkRotateGatewayRegistryKeyTransitions(
  entries: readonly {
    previousKey: GatewayKeyRegistryStoredDynamicKey;
    valueHash: string;
    overlapSeconds?: number;
  }[],
  metadata: GatewayKeyRegistryWriteTransitionAuditMetadata,
  existingGatewayApiKeys: readonly GatewayKeyRegistryStoredDynamicKey[],
  now = new Date().toISOString()
): GatewayKeyRegistryWriteTransition[] {
  let simulatedKeys = [...existingGatewayApiKeys];

  return entries.map((entry) => {
    const transition = buildRotateGatewayRegistryKeyTransition(
      entry.previousKey,
      {
        valueHash: entry.valueHash,
        ...(entry.overlapSeconds !== undefined
          ? { overlapSeconds: entry.overlapSeconds }
          : {}),
        ...metadata
      },
      simulatedKeys,
      now
    );

    simulatedKeys = simulatedKeys.map((candidate) => {
      return candidate.id === entry.previousKey.id
        ? transition.nextKey
        : candidate;
    });

    return transition;
  });
}
