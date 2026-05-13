import { GatewayError } from "@airlock/shared";

import type {
  GatewayApiKeyLifecycleStatus,
  GatewayApiKeyRecord,
  GatewayApiKeyRegistrySnapshot
} from "./gateway-auth.js";
import {
  createGatewayKeyOperationSummary,
  sortGatewayKeyAuditEventsDescending,
  type GatewayKeyAuditEvent
} from "./gateway-key-audit.js";
import type {
  GatewayKeyRegistryDynamicKeyView
} from "./gateway-key-registry.js";

export interface GatewayAdminKeyInventoryFilters {
  acceptedNow?: boolean;
  effectiveStatus?: GatewayApiKeyLifecycleStatus;
  includeArchived?: boolean;
}

export interface GatewayAdminKeyReadPort {
  listKeySnapshots(filters: GatewayAdminKeyInventoryFilters): Promise<
    GatewayApiKeyRegistrySnapshot[]
  >;
}

export interface GatewayAdminRegistryKeyReadPort {
  getRegistryKey(keyId: string): Promise<GatewayKeyRegistryDynamicKeyView | null>;
}

export interface GatewayAdminKeyRevocationReadPort {
  getKeyRevocationStatus(keyId: string): Promise<{
    keyId: string;
    revoked: boolean;
    updatedAt: string;
  }>;
}

export interface GatewayAdminKeyStatusReadPort {
  getKeyStatusSnapshot(keyId: string): Promise<GatewayApiKeyRegistrySnapshot>;
}

export interface GatewayAdminKeyEventsReadPort {
  getRegistryEvents(keyId: string): Promise<GatewayKeyAuditEvent[]>;
  getRevocationEvents(keyId: string): Promise<GatewayKeyAuditEvent[]>;
  assertKeyExists(keyId: string): Promise<void>;
}

export interface GatewayAdminKeyOperationEventsReadPort {
  getOperationEvents(operationId: string): Promise<GatewayKeyAuditEvent[]>;
}

export interface GatewayAdminConfiguredKeyRegistryViewPort {
  getConfiguredKeyStatusSnapshot(
    keyId: string
  ): Promise<GatewayApiKeyRegistrySnapshot>;
}

function createGatewayKeyNotFoundError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key not found", {
    code: "gateway_key_not_found",
    category: "governance",
    httpStatus: 404,
    retryable: false,
    requestId
  });
}

export function parseGatewayAdminKeyInventoryFilters(
  query: URLSearchParams
): GatewayAdminKeyInventoryFilters {
  const acceptedNowParam = query.get("acceptedNow");
  const effectiveStatusParam = query.get("effectiveStatus");
  const includeArchivedParam = query.get("includeArchived");
  const acceptedNow =
    acceptedNowParam === null
      ? undefined
      : acceptedNowParam === "true"
        ? true
        : acceptedNowParam === "false"
          ? false
          : undefined;
  const effectiveStatus =
    effectiveStatusParam === "active" ||
    effectiveStatusParam === "revoked" ||
    effectiveStatusParam === "not_yet_active" ||
    effectiveStatusParam === "expired" ||
    effectiveStatusParam === "archived"
      ? effectiveStatusParam
      : undefined;
  const includeArchived =
    includeArchivedParam === null
      ? undefined
      : includeArchivedParam === "true"
        ? true
        : includeArchivedParam === "false"
          ? false
          : undefined;

  return {
    ...(acceptedNow !== undefined ? { acceptedNow } : {}),
    ...(effectiveStatus !== undefined ? { effectiveStatus } : {}),
    ...(includeArchived !== undefined ? { includeArchived } : {})
  };
}

export async function listGatewayAdminKeys(
  query: URLSearchParams,
  port: GatewayAdminKeyReadPort
): Promise<{
  keys: GatewayApiKeyRegistrySnapshot[];
}> {
  return {
    keys: await port.listKeySnapshots(parseGatewayAdminKeyInventoryFilters(query))
  };
}

export async function getGatewayAdminKey(
  keyId: string,
  requestId: string,
  port: GatewayAdminRegistryKeyReadPort
): Promise<GatewayKeyRegistryDynamicKeyView> {
  const key = await port.getRegistryKey(keyId);

  if (!key) {
    throw createGatewayKeyNotFoundError(requestId);
  }

  return key;
}

export async function getGatewayAdminKeyRevocationStatus(
  keyId: string,
  port: GatewayAdminKeyRevocationReadPort
): Promise<{
  keyId: string;
  revoked: boolean;
  updatedAt: string;
}> {
  return port.getKeyRevocationStatus(keyId);
}

export async function getGatewayAdminKeyStatus(
  keyId: string,
  port: GatewayAdminKeyStatusReadPort
): Promise<GatewayApiKeyRegistrySnapshot> {
  return port.getKeyStatusSnapshot(keyId);
}

export async function getGatewayAdminKeyEvents(
  keyId: string,
  port: GatewayAdminKeyEventsReadPort
): Promise<{
  keyId: string;
  events: GatewayKeyAuditEvent[];
}> {
  const [registryEvents, revocationEvents] = await Promise.all([
    port.getRegistryEvents(keyId),
    port.getRevocationEvents(keyId)
  ]);

  if (registryEvents.length === 0 && revocationEvents.length === 0) {
    await port.assertKeyExists(keyId);
  }

  return {
    keyId,
    events: sortGatewayKeyAuditEventsDescending([
      ...registryEvents,
      ...revocationEvents
    ])
  };
}

export async function getGatewayAdminKeyOperationEvents(
  operationId: string,
  requestId: string,
  port: GatewayAdminKeyOperationEventsReadPort
): Promise<{
  operationId: string;
  summary: ReturnType<typeof createGatewayKeyOperationSummary>;
  events: GatewayKeyAuditEvent[];
}> {
  const events = await port.getOperationEvents(operationId);

  if (events.length === 0) {
    throw createGatewayKeyNotFoundError(requestId);
  }

  const sortedEvents = sortGatewayKeyAuditEventsDescending(events);

  return {
    operationId,
    summary: createGatewayKeyOperationSummary(operationId, events),
    events: sortedEvents
  };
}

export function createGatewayAdminKeyRegistryView(
  snapshot: GatewayApiKeyRegistrySnapshot
): {
  keyId: string;
  configured: GatewayApiKeyRegistrySnapshot["configured"];
  runtime: GatewayApiKeyRegistrySnapshot["runtime"];
  override: GatewayApiKeyRegistrySnapshot["registryOverride"];
  registryOverrideApplied: boolean;
  registryUpdatedAt?: string;
} {
  return {
    keyId: snapshot.keyId,
    configured: snapshot.configured,
    runtime: snapshot.runtime,
    override: snapshot.registryOverride,
    registryOverrideApplied: snapshot.registryOverrideApplied,
    ...(snapshot.registryUpdatedAt
      ? { registryUpdatedAt: snapshot.registryUpdatedAt }
      : {})
  };
}

export async function getGatewayAdminKeyRegistryView(
  keyId: string,
  port: GatewayAdminConfiguredKeyRegistryViewPort
): Promise<ReturnType<typeof createGatewayAdminKeyRegistryView>> {
  return createGatewayAdminKeyRegistryView(
    await port.getConfiguredKeyStatusSnapshot(keyId)
  );
}

export function toGatewayAdminConfiguredKeyRegistryViewPort(
  getConfiguredKeyStatusSnapshot: (
    keyId: string
  ) => Promise<GatewayApiKeyRegistrySnapshot>
): GatewayAdminConfiguredKeyRegistryViewPort {
  return {
    getConfiguredKeyStatusSnapshot
  };
}

export function toGatewayAdminKeyStatusReadPort(
  getKeyStatusSnapshot: (
    keyId: string
  ) => Promise<GatewayApiKeyRegistrySnapshot>
): GatewayAdminKeyStatusReadPort {
  return {
    getKeyStatusSnapshot
  };
}

export function toGatewayAdminKeyRevocationReadPort(
  getKeyRevocationStatus: (
    keyId: string
  ) => Promise<{
    keyId: string;
    revoked: boolean;
    updatedAt: string;
  }>
): GatewayAdminKeyRevocationReadPort {
  return {
    getKeyRevocationStatus
  };
}

export function toGatewayAdminRegistryKeyReadPort(
  getRegistryKey: (
    keyId: string
  ) => Promise<GatewayKeyRegistryDynamicKeyView | null>
): GatewayAdminRegistryKeyReadPort {
  return {
    getRegistryKey
  };
}

export function toGatewayAdminKeyReadPort(
  listKeySnapshots: (
    filters: GatewayAdminKeyInventoryFilters
  ) => Promise<GatewayApiKeyRegistrySnapshot[]>
): GatewayAdminKeyReadPort {
  return {
    listKeySnapshots
  };
}

export function toGatewayAdminKeyEventsReadPort(
  getRegistryEvents: (keyId: string) => Promise<GatewayKeyAuditEvent[]>,
  getRevocationEvents: (keyId: string) => Promise<GatewayKeyAuditEvent[]>,
  assertKeyExists: (keyId: string) => Promise<void>
): GatewayAdminKeyEventsReadPort {
  return {
    getRegistryEvents,
    getRevocationEvents,
    assertKeyExists
  };
}

export function assertGatewayAdminKeyExists(
  key: GatewayApiKeyRecord | GatewayKeyRegistryDynamicKeyView | null,
  requestId: string
): asserts key is GatewayApiKeyRecord | GatewayKeyRegistryDynamicKeyView {
  if (!key) {
    throw createGatewayKeyNotFoundError(requestId);
  }
}
