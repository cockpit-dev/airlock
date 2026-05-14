import { createGatewayKeyAuditEvent, type GatewayKeyAuditEvent } from "./gateway-key-audit.js";
import {
  createStoredGatewayRegistryFieldDiffs,
  type GatewayKeyRegistryStoredDynamicKey
} from "./gateway-key-registry.js";

export interface GatewayKeyRegistryLifecycleTransitionAuditMetadata {
  operationId?: string;
  reason?: string;
  actor?: string;
  actorSource?: "payload" | "trusted_header" | "credential";
}

export interface GatewayKeyRegistryLifecycleTransition {
  nextKey: GatewayKeyRegistryStoredDynamicKey;
  auditEvent: GatewayKeyAuditEvent;
}

function buildGatewayRegistryLifecycleTransitionAuditEvent(
  kind: "archived" | "restored" | "rotation_finalized" | "rotation_canceled",
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  nextKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata
): GatewayKeyAuditEvent {
  return createGatewayKeyAuditEvent({
    keyId: nextKey.id,
    kind,
    ownership: "registry",
    occurredAt: nextKey.updatedAt,
    ...(metadata.operationId ? { operationId: metadata.operationId } : {}),
    ...(metadata.reason ? { reason: metadata.reason } : {}),
    ...(metadata.actor ? { actor: metadata.actor } : {}),
    ...(metadata.actor && metadata.actorSource
      ? { actorSource: metadata.actorSource }
      : {}),
    changes: createStoredGatewayRegistryFieldDiffs(previousKey, nextKey)
  });
}

function buildGatewayRegistryLifecycleTransition(
  kind: "archived" | "restored" | "rotation_finalized" | "rotation_canceled",
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  nextKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata
): GatewayKeyRegistryLifecycleTransition {
  return {
    nextKey,
    auditEvent: buildGatewayRegistryLifecycleTransitionAuditEvent(
      kind,
      previousKey,
      nextKey,
      metadata
    )
  };
}

export function buildArchiveGatewayRegistryKeyTransition(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: Omit<GatewayKeyRegistryLifecycleTransitionAuditMetadata, "operationId">,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition {
  const nextKey: GatewayKeyRegistryStoredDynamicKey = {
    ...previousKey,
    archivedAt: now,
    updatedAt: now
  };

  return buildGatewayRegistryLifecycleTransition(
    "archived",
    previousKey,
    nextKey,
    metadata
  );
}

export function buildRestoreGatewayRegistryKeyTransition(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: Omit<GatewayKeyRegistryLifecycleTransitionAuditMetadata, "operationId">,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition {
  const nextKey: GatewayKeyRegistryStoredDynamicKey = {
    ...previousKey,
    updatedAt: now
  };
  delete nextKey.archivedAt;

  return buildGatewayRegistryLifecycleTransition(
    "restored",
    previousKey,
    nextKey,
    metadata
  );
}

export function buildFinalizeGatewayRegistryKeyRotationTransition(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: Omit<GatewayKeyRegistryLifecycleTransitionAuditMetadata, "operationId">,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition {
  const nextKey: GatewayKeyRegistryStoredDynamicKey = {
    ...previousKey,
    updatedAt: now
  };
  delete nextKey.previousValueHash;
  delete nextKey.previousValueHashExpiresAt;

  return buildGatewayRegistryLifecycleTransition(
    "rotation_finalized",
    previousKey,
    nextKey,
    metadata
  );
}

export function buildCancelGatewayRegistryKeyRotationTransition(
  previousKey: GatewayKeyRegistryStoredDynamicKey,
  metadata: Omit<GatewayKeyRegistryLifecycleTransitionAuditMetadata, "operationId">,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition {
  const nextKey: GatewayKeyRegistryStoredDynamicKey = {
    ...previousKey,
    valueHash: previousKey.previousValueHash ?? previousKey.valueHash,
    updatedAt: now
  };
  delete nextKey.previousValueHash;
  delete nextKey.previousValueHashExpiresAt;

  return buildGatewayRegistryLifecycleTransition(
    "rotation_canceled",
    previousKey,
    nextKey,
    metadata
  );
}

function buildBulkGatewayRegistryKeyTransitions(
  keys: readonly GatewayKeyRegistryStoredDynamicKey[],
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata,
  now: string,
  build: (
    previousKey: GatewayKeyRegistryStoredDynamicKey,
    metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata,
    now: string
  ) => GatewayKeyRegistryLifecycleTransition
) {
  return keys.map((key) => {
    return build(key, metadata, now);
  });
}

export function buildBulkArchiveGatewayRegistryKeyTransitions(
  keys: readonly GatewayKeyRegistryStoredDynamicKey[],
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition[] {
  return buildBulkGatewayRegistryKeyTransitions(keys, metadata, now, (key, entry, occurredAt) => {
    return buildArchiveGatewayRegistryKeyTransition(key, entry, occurredAt);
  });
}

export function buildBulkRestoreGatewayRegistryKeyTransitions(
  keys: readonly GatewayKeyRegistryStoredDynamicKey[],
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition[] {
  return buildBulkGatewayRegistryKeyTransitions(keys, metadata, now, (key, entry, occurredAt) => {
    return buildRestoreGatewayRegistryKeyTransition(key, entry, occurredAt);
  });
}

export function buildBulkFinalizeGatewayRegistryKeyRotationTransitions(
  keys: readonly GatewayKeyRegistryStoredDynamicKey[],
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition[] {
  return buildBulkGatewayRegistryKeyTransitions(keys, metadata, now, (key, entry, occurredAt) => {
    return buildFinalizeGatewayRegistryKeyRotationTransition(key, entry, occurredAt);
  });
}

export function buildBulkCancelGatewayRegistryKeyRotationTransitions(
  keys: readonly GatewayKeyRegistryStoredDynamicKey[],
  metadata: GatewayKeyRegistryLifecycleTransitionAuditMetadata,
  now = new Date().toISOString()
): GatewayKeyRegistryLifecycleTransition[] {
  return buildBulkGatewayRegistryKeyTransitions(keys, metadata, now, (key, entry, occurredAt) => {
    return buildCancelGatewayRegistryKeyRotationTransition(key, entry, occurredAt);
  });
}
