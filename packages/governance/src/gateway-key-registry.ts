import { GatewayError } from "@airlock/shared";

import {
  parseGatewayApiKeyMetadataOverride,
  parseGatewayDynamicApiKeyRecord,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyRecord
} from "./gateway-auth.js";
import {
  parseOptionalGatewayKeyAuditActor,
  parseOptionalGatewayKeyAuditActorSource,
  parseOptionalGatewayKeyAuditReason,
  type GatewayKeyAuditActorContext,
  type GatewayKeyAuditActorSource
} from "./gateway-key-audit.js";

export interface GatewayKeyRegistryStoredOverride
  extends GatewayApiKeyMetadataOverride {
  updatedAt: string;
}

export interface GatewayKeyRegistryDynamicKeyView {
  keyId: string;
  ownership: "registry";
  key: GatewayApiKeyRecord;
  previousValueHash?: string;
  previousValueHashExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayKeyRegistryStoredDynamicKey extends GatewayApiKeyRecord {
  valueHash: string;
  previousValueHash?: string;
  previousValueHashExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayKeyRegistryRecordResponse {
  keyId: string;
  override: GatewayKeyRegistryStoredOverride | null;
}

export interface GatewayKeyRegistryDynamicKeyResponse {
  key: GatewayKeyRegistryDynamicKeyView | null;
}

export interface GatewayKeyRegistryDynamicKeyListResponse {
  keys: GatewayKeyRegistryDynamicKeyView[];
}

export interface GatewayKeyRegistryDeleteResponse {
  keyId: string;
  deleted: boolean;
}

export interface GatewayKeyRegistryCreateRequest extends GatewayApiKeyRecord {
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

export interface GatewayKeyRegistryRotateRequest {
  valueHash: string;
  overlapSeconds?: number;
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

export interface GatewayKeyRegistryRotationActionRequest {
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

export interface GatewayKeyRegistryDeleteRequest {
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

export interface GatewayKeyRegistryUpdateAuditMetadata {
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

export interface GatewayKeyRegistryUpdateRequest {
  update: GatewayApiKeyMetadataOverride;
  auditMetadata: GatewayKeyRegistryUpdateAuditMetadata;
}

export interface GatewayKeyRegistryBulkUpdateItem {
  keyId: string;
  update: GatewayApiKeyMetadataOverride;
}

export interface GatewayKeyRegistryBulkUpdateRequest {
  updates: GatewayKeyRegistryBulkUpdateItem[];
  auditMetadata: GatewayKeyRegistryUpdateAuditMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function parseRequiredGatewayKeyRegistryReason(
  value: unknown,
  message: string
): string {
  try {
    const reason = parseOptionalGatewayKeyAuditReason(value);

    if (!reason) {
      throw new Error("Reason is missing");
    }

    return reason;
  } catch (cause) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false,
      cause
    });
  }
}

function parseRequiredGatewayKeyRegistryActorContext(
  value: unknown,
  actorSource: unknown,
  message: string
): GatewayKeyAuditActorContext {
  try {
    const actor = parseOptionalGatewayKeyAuditActor(value);

    if (!actor) {
      throw new Error("Actor is missing");
    }

    return {
      actor,
      actorSource:
        parseOptionalGatewayKeyAuditActorSource(actorSource) ?? "payload"
    };
  } catch (cause) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false,
      cause
    });
  }
}

function createGatewayKeyRegistryPayloadError(
  message: string,
  cause?: unknown
): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_gateway_api_keys",
    category: "configuration",
    httpStatus: 400,
    retryable: false,
    ...(cause ? { cause } : {})
  });
}

export function parseGatewayKeyRegistryStoredOverride(
  value: unknown
): GatewayKeyRegistryStoredOverride {
  if (!isRecord(value)) {
    throw new Error("Registry override must be an object");
  }

  const { updatedAt, ...overrideValue } = value;

  if (typeof updatedAt !== "string" || !isValidTimestamp(updatedAt)) {
    throw new Error("Registry override updatedAt must be a valid timestamp");
  }

  return {
    ...parseGatewayApiKeyMetadataOverride(overrideValue),
    updatedAt
  };
}

export function parseGatewayKeyRegistryStoredDynamicKey(
  value: unknown
): GatewayKeyRegistryStoredDynamicKey {
  if (!isRecord(value)) {
    throw new Error("Registry dynamic key must be an object");
  }

  const record = parseGatewayDynamicApiKeyRecord(value);
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  const previousValueHash =
    typeof value.previousValueHash === "string"
      ? value.previousValueHash.trim().toLowerCase()
      : undefined;
  const previousValueHashExpiresAt =
    typeof value.previousValueHashExpiresAt === "string"
      ? value.previousValueHashExpiresAt
      : undefined;

  if (
    typeof createdAt !== "string" ||
    !isValidTimestamp(createdAt) ||
    typeof updatedAt !== "string" ||
    !isValidTimestamp(updatedAt)
  ) {
    throw new Error("Registry dynamic key timestamps are invalid");
  }

  if (
    previousValueHash !== undefined &&
    previousValueHash.length > 0 &&
    !/^[a-f0-9]{64}$/.test(previousValueHash)
  ) {
    throw new Error("Registry dynamic key previousValueHash is invalid");
  }

  if (
    previousValueHashExpiresAt !== undefined &&
    !isValidTimestamp(previousValueHashExpiresAt)
  ) {
    throw new Error("Registry dynamic key previousValueHashExpiresAt is invalid");
  }

  return {
    ...record,
    valueHash: record.valueHash!,
    ...(previousValueHash ? { previousValueHash } : {}),
    ...(previousValueHashExpiresAt ? { previousValueHashExpiresAt } : {}),
    createdAt,
    updatedAt
  };
}

export function createGatewayKeyRegistryDynamicKeyView(
  key: GatewayKeyRegistryStoredDynamicKey
): GatewayKeyRegistryDynamicKeyView {
  return {
    keyId: key.id,
    ownership: "registry",
    key: {
      id: key.id,
      label: key.label,
      valueHash: key.valueHash,
      status: key.status,
      ...(key.notBefore ? { notBefore: key.notBefore } : {}),
      ...(key.expiresAt ? { expiresAt: key.expiresAt } : {}),
      ...(key.policy ? { policy: key.policy } : {})
    },
    ...(key.previousValueHash ? { previousValueHash: key.previousValueHash } : {}),
    ...(key.previousValueHashExpiresAt
      ? { previousValueHashExpiresAt: key.previousValueHashExpiresAt }
      : {}),
    createdAt: key.createdAt,
    updatedAt: key.updatedAt
  };
}

export function parseGatewayKeyRegistryDynamicKeyView(
  value: unknown
): GatewayKeyRegistryDynamicKeyView {
  if (!isRecord(value) || typeof value.keyId !== "string") {
    throw new Error("Registry dynamic key view must include keyId");
  }

  const key = parseGatewayDynamicApiKeyRecord(value.key);
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;

  if (
    typeof createdAt !== "string" ||
    !isValidTimestamp(createdAt) ||
    typeof updatedAt !== "string" ||
    !isValidTimestamp(updatedAt)
  ) {
    throw new Error("Registry dynamic key timestamps are invalid");
  }

  return {
    keyId: value.keyId,
    ownership: "registry",
    key,
    ...(typeof value.previousValueHash === "string"
      ? { previousValueHash: value.previousValueHash }
      : {}),
    ...(typeof value.previousValueHashExpiresAt === "string"
      ? { previousValueHashExpiresAt: value.previousValueHashExpiresAt }
      : {}),
    createdAt,
    updatedAt
  };
}

export function parseGatewayKeyRegistryRecordResponse(
  value: unknown
): GatewayKeyRegistryRecordResponse {
  if (!isRecord(value) || typeof value.keyId !== "string") {
    throw new Error("Registry response must include a key id");
  }

  if (value.override !== null && value.override !== undefined) {
    return {
      keyId: value.keyId,
      override: parseGatewayKeyRegistryStoredOverride(value.override)
    };
  }

  return {
    keyId: value.keyId,
    override: null
  };
}

export function parseGatewayKeyRegistryDynamicKeyResponse(
  value: unknown
): GatewayKeyRegistryDynamicKeyView | null {
  if (!isRecord(value) || !("key" in value)) {
    throw new Error("Registry dynamic key response must include key");
  }

  if (value.key === null) {
    return null;
  }

  return parseGatewayKeyRegistryDynamicKeyView(value.key);
}

export function parseGatewayKeyRegistryDynamicKeyListResponse(
  value: unknown
): GatewayKeyRegistryDynamicKeyView[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new Error("Registry dynamic key list response must include keys");
  }

  return value.keys.map((entry) => {
    return parseGatewayKeyRegistryDynamicKeyView(entry);
  });
}

export function parseGatewayKeyRegistryDeleteResponse(
  value: unknown
): GatewayKeyRegistryDeleteResponse {
  if (
    !isRecord(value) ||
    typeof value.keyId !== "string" ||
    typeof value.deleted !== "boolean"
  ) {
    throw new Error("Registry delete response is invalid");
  }

  return {
    keyId: value.keyId,
    deleted: value.deleted
  };
}

export function parseGatewayKeyRegistryRotateRequest(
  value: unknown
): GatewayKeyRegistryRotateRequest {
  if (!isRecord(value) || typeof value.valueHash !== "string") {
    throw new GatewayError("Gateway dynamic key rotation payload is invalid", {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  const record = parseGatewayDynamicApiKeyRecord({
    id: "rotation_payload",
    label: "Rotation Payload",
    valueHash: value.valueHash,
    status: "active"
  });

  return {
    valueHash: record.valueHash!,
    ...(value.overlapSeconds !== undefined
      ? {
          overlapSeconds: parseGatewayKeyRegistryOverlapSeconds(
            value.overlapSeconds,
            "Gateway dynamic key rotation payload is invalid"
          )
        }
      : {}),
    ...(value.reason !== undefined
      ? {
          reason: parseRequiredGatewayKeyRegistryReason(
            value.reason,
            "Gateway dynamic key rotation payload is invalid"
          )
        }
      : {}),
    ...(value.actor !== undefined
      ? {
          ...toGatewayKeyAuditActorContextRecord(
            parseRequiredGatewayKeyRegistryActorContext(
              value.actor,
              "actorSource" in value ? value.actorSource : undefined,
              "Gateway dynamic key rotation payload is invalid"
            )
          )
        }
      : {})
  };
}

export function parseGatewayKeyRegistryCreateRequest(
  value: unknown,
  existingGatewayApiKeys: readonly GatewayApiKeyRecord[]
): {
  key: GatewayApiKeyRecord;
  actorContext?: GatewayKeyAuditActorContext;
} {
  const key = parseGatewayDynamicApiKeyRecord(
    stripGatewayKeyAuditActorMetadata(value),
    existingGatewayApiKeys
  );

  if (!isRecord(value) || value.actor === undefined) {
    return { key };
  }

  return {
    key,
    actorContext: parseRequiredGatewayKeyRegistryActorContext(
      value.actor,
      "actorSource" in value ? value.actorSource : undefined,
      "Gateway dynamic key create payload is invalid"
    )
  };
}

export function parseGatewayKeyRegistryDeleteRequest(
  value: unknown
): GatewayKeyRegistryDeleteRequest {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new GatewayError("Gateway dynamic key delete payload is invalid", {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  return {
    ...(value.reason !== undefined
      ? {
          reason: parseRequiredGatewayKeyRegistryReason(
            value.reason,
            "Gateway dynamic key delete payload is invalid"
          )
        }
      : {}),
    ...(value.actor !== undefined
      ? {
          ...toGatewayKeyAuditActorContextRecord(
            parseRequiredGatewayKeyRegistryActorContext(
              value.actor,
              "actorSource" in value ? value.actorSource : undefined,
              "Gateway dynamic key delete payload is invalid"
            )
          )
        }
      : {})
  };
}

export function parseGatewayKeyRegistryUpdateRequest(
  value: unknown
): GatewayKeyRegistryUpdateRequest {
  const message = "Gateway dynamic key update payload is invalid";

  if (!isRecord(value)) {
    throw createGatewayKeyRegistryPayloadError(message);
  }

  const allowedKeys = new Set([
    "label",
    "status",
    "notBefore",
    "expiresAt",
    "policy",
    "reason",
    "actor",
    "actorSource"
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw createGatewayKeyRegistryPayloadError(
        message,
        new Error(`Unsupported field: ${key}`)
      );
    }
  }

  if (value.actorSource !== undefined && value.actor === undefined) {
    throw createGatewayKeyRegistryPayloadError(
      message,
      new Error("actorSource requires actor")
    );
  }

  const hasUpdateField =
    value.label !== undefined ||
    value.status !== undefined ||
    value.notBefore !== undefined ||
    value.expiresAt !== undefined ||
    value.policy !== undefined;

  if (!hasUpdateField) {
    throw createGatewayKeyRegistryPayloadError(
      message,
      new Error("At least one mutable metadata field is required")
    );
  }

  let update: GatewayApiKeyMetadataOverride;

  try {
    update = parseGatewayApiKeyMetadataOverride(value);
  } catch (cause) {
    throw createGatewayKeyRegistryPayloadError(message, cause);
  }

  return {
    update,
    auditMetadata: {
      ...(value.reason !== undefined
        ? {
            reason: parseRequiredGatewayKeyRegistryReason(value.reason, message)
          }
        : {}),
      ...(value.actor !== undefined
        ? {
            ...toGatewayKeyAuditActorContextRecord(
              parseRequiredGatewayKeyRegistryActorContext(
                value.actor,
                "actorSource" in value ? value.actorSource : undefined,
                message
              )
            )
          }
        : {})
    }
  };
}

export function parseGatewayKeyRegistryBulkUpdateRequest(
  value: unknown
): GatewayKeyRegistryBulkUpdateRequest {
  const message = "Gateway dynamic key bulk update payload is invalid";

  if (!isRecord(value) || !Array.isArray(value.updates)) {
    throw createGatewayKeyRegistryPayloadError(message);
  }

  if (value.updates.length === 0) {
    throw createGatewayKeyRegistryPayloadError(
      message,
      new Error("updates must be a non-empty array")
    );
  }

  if (value.actorSource !== undefined && value.actor === undefined) {
    throw createGatewayKeyRegistryPayloadError(
      message,
      new Error("actorSource requires actor")
    );
  }

  const seenKeyIds = new Set<string>();
  const updates = value.updates.map((entry) => {
    if (!isRecord(entry)) {
      throw createGatewayKeyRegistryPayloadError(message);
    }

    const keyId = typeof entry.keyId === "string" ? entry.keyId.trim() : "";

    if (keyId.length === 0) {
      throw createGatewayKeyRegistryPayloadError(
        message,
        new Error("Each update must include a non-empty keyId")
      );
    }

    if (seenKeyIds.has(keyId)) {
      throw createGatewayKeyRegistryPayloadError(
        message,
        new Error("Duplicate keyId values are not allowed")
      );
    }

    seenKeyIds.add(keyId);

    const updateCandidate = Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "keyId")
    );
    const parsedUpdate = parseGatewayKeyRegistryUpdateRequest(updateCandidate);

    return {
      keyId,
      update: parsedUpdate.update
    };
  });

  return {
    updates,
    auditMetadata: {
      ...(value.reason !== undefined
        ? {
            reason: parseRequiredGatewayKeyRegistryReason(value.reason, message)
          }
        : {}),
      ...(value.actor !== undefined
        ? {
            ...toGatewayKeyAuditActorContextRecord(
              parseRequiredGatewayKeyRegistryActorContext(
                value.actor,
                "actorSource" in value ? value.actorSource : undefined,
                message
              )
            )
          }
        : {})
    }
  };
}

export function parseGatewayKeyRegistryRotationActionRequest(
  value: unknown,
  message: string
): GatewayKeyRegistryRotationActionRequest {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  return {
    ...(value.reason !== undefined
      ? {
          reason: parseRequiredGatewayKeyRegistryReason(value.reason, message)
        }
      : {}),
    ...(value.actor !== undefined
      ? {
          ...toGatewayKeyAuditActorContextRecord(
            parseRequiredGatewayKeyRegistryActorContext(
              value.actor,
              "actorSource" in value ? value.actorSource : undefined,
              message
            )
          )
        }
      : {})
  };
}

export function toGatewayKeyAuditActorContextRecord(
  actorContext: GatewayKeyAuditActorContext
): { actor: string; actorSource: GatewayKeyAuditActorSource } {
  return {
    actor: actorContext.actor,
    actorSource: actorContext.actorSource
  };
}

export function gatewayKeyAuditActorContextFromRegistryRequest(
  request:
    | GatewayKeyRegistryCreateRequest
    | GatewayKeyRegistryRotateRequest
    | GatewayKeyRegistryRotationActionRequest
    | GatewayKeyRegistryDeleteRequest
    | GatewayKeyRegistryUpdateAuditMetadata
): GatewayKeyAuditActorContext | undefined {
  if (!request.actor) {
    return undefined;
  }

  return {
    actor: request.actor,
    actorSource: request.actorSource ?? "payload"
  };
}

export function stripGatewayKeyAuditActorMetadata(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const rest = { ...value };
  delete rest.actor;
  delete rest.actorSource;
  return rest;
}

function parseGatewayKeyRegistryOverlapSeconds(
  value: unknown,
  message: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3600
  ) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  return value;
}
