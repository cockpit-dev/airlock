import { GatewayError } from "@airlock/shared";

import {
  createGatewayKeyAuditEvent,
  parseOptionalGatewayKeyAuditActor,
  parseOptionalGatewayKeyAuditActorSource,
  parseOptionalGatewayKeyAuditReason,
  type GatewayKeyAuditActorContext,
  type GatewayKeyAuditActorSource,
  type GatewayKeyAuditEvent,
  type GatewayKeyAuditOwnership
} from "./gateway-key-audit.js";
import type {
  GatewayApiKeyRecord,
  GatewayApiKeyOwnership
} from "./gateway-auth.js";

export interface GatewayKeyRevocationState {
  revoked: boolean;
  updatedAt: string;
}

export interface GatewayKeyRevocationWriteRequest {
  keyId?: string;
  recordEvent?: boolean;
  operationId?: string;
  ownership?: GatewayKeyAuditOwnership;
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

export const DEFAULT_GATEWAY_KEY_REVOCATION_STATE: GatewayKeyRevocationState = {
  revoked: false,
  updatedAt: new Date(0).toISOString()
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseGatewayKeyRevocationState(
  value: unknown
): GatewayKeyRevocationState {
  if (!isRecord(value)) {
    throw new Error("Revocation state must be an object");
  }

  const { revoked, updatedAt } = value;

  if (
    typeof revoked !== "boolean" ||
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error("Revocation state is invalid");
  }

  return {
    revoked,
    updatedAt
  };
}

export function parseGatewayKeyRevocationWriteRequest(
  body: unknown
): GatewayKeyRevocationWriteRequest {
  if (!isRecord(body)) {
    throw new Error("Revocation write request must be an object");
  }

  const { keyId, recordEvent, operationId, ownership } = body;
  let reason: string | undefined;
  let actor: string | undefined;
  let actorSource: GatewayKeyAuditActorSource | undefined;

  if (
    keyId !== undefined &&
    (typeof keyId !== "string" || keyId.length === 0)
  ) {
    throw new Error("Revocation write request keyId is invalid");
  }

  if (recordEvent !== undefined && typeof recordEvent !== "boolean") {
    throw new Error("Revocation write request recordEvent is invalid");
  }

  if (
    operationId !== undefined &&
    (typeof operationId !== "string" || operationId.trim().length === 0)
  ) {
    throw new Error("Revocation write request operationId is invalid");
  }

  if (
    ownership !== undefined &&
    ownership !== "configured" &&
    ownership !== "registry"
  ) {
    throw new Error("Revocation write request ownership is invalid");
  }

  if ("reason" in body) {
    reason = parseOptionalGatewayKeyAuditReason(body.reason);
  }

  if ("actor" in body) {
    actor = parseOptionalGatewayKeyAuditActor(body.actor);
  }

  if ("actorSource" in body) {
    actorSource = parseOptionalGatewayKeyAuditActorSource(body.actorSource);
  }

  return {
    ...(keyId !== undefined ? { keyId } : {}),
    ...(recordEvent !== undefined ? { recordEvent } : {}),
    ...(typeof operationId === "string"
      ? { operationId: operationId.trim() }
      : {}),
    ...(ownership !== undefined ? { ownership } : {}),
    ...(reason ? { reason } : {}),
    ...(actor ? { actor } : {}),
    ...(actor && actorSource ? { actorSource } : {})
  };
}

export function requestKeyIdFromGatewayKeyRevocationWriteRequest(
  request: GatewayKeyRevocationWriteRequest
): string {
  const keyId = (
    request as GatewayKeyRevocationWriteRequest & { keyId?: unknown }
  ).keyId;

  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new Error("Revocation write request keyId is invalid");
  }

  return keyId;
}

export function parseExplicitGatewayKeyRevocationMetadataPayload(
  payload: unknown,
  message: string
): {
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
} {
  if (payload === undefined || payload === null) {
    return {};
  }

  if (!isRecord(payload)) {
    throw new GatewayError(message, {
      code: "gateway_key_revocation_invalid_payload",
      category: "governance",
      httpStatus: 400,
      retryable: false
    });
  }

  try {
    const reason =
      "reason" in payload
        ? parseOptionalGatewayKeyAuditReason(payload.reason)
        : undefined;
    const actor =
      "actor" in payload
        ? parseOptionalGatewayKeyAuditActor(payload.actor)
        : undefined;
    const actorSource =
      "actorSource" in payload
        ? parseOptionalGatewayKeyAuditActorSource(payload.actorSource)
        : undefined;

    return {
      ...(reason ? { reason } : {}),
      ...(actor ? { actor } : {}),
      ...(actor && actorSource ? { actorSource } : {})
    };
  } catch (cause) {
    throw new GatewayError(message, {
      code: "gateway_key_revocation_invalid_payload",
      category: "governance",
      httpStatus: 400,
      retryable: false,
      cause
    });
  }
}

export function toGatewayKeyRevocationActorContextRecord(
  actorContext: GatewayKeyAuditActorContext
): { actor: string; actorSource: GatewayKeyAuditActorSource } {
  return {
    actor: actorContext.actor,
    actorSource: actorContext.actorSource
  };
}

export interface GatewayKeyRevocationByIdPort {
  resolveKeyById(keyId: string): Promise<{
    gatewayApiKey: GatewayApiKeyRecord;
    ownership: GatewayApiKeyOwnership;
  }>;
  writeKeyRevocationState(
    gatewayApiKey: GatewayApiKeyRecord,
    revoked: boolean,
    request: GatewayKeyRevocationWriteRequest
  ): Promise<GatewayKeyRevocationState>;
}

export interface GatewayKeyRevocationRuntimeWritePort {
  writeKeyRevocationState(
    gatewayApiKey: GatewayApiKeyRecord,
    revoked: boolean,
    request: GatewayKeyRevocationWriteRequest
  ): Promise<GatewayKeyRevocationState>;
  appendOperationEvent(event: GatewayKeyAuditEvent): Promise<void>;
  resolveOwnership(
    gatewayApiKey: GatewayApiKeyRecord
  ): Promise<GatewayApiKeyOwnership>;
}

function buildGatewayKeyRevocationWriteRequestFromPayload(
  keyId: string,
  ownership: GatewayApiKeyOwnership,
  payload: unknown,
  message: string,
  actorContext?: GatewayKeyAuditActorContext
): GatewayKeyRevocationWriteRequest {
  return {
    keyId,
    ownership,
    ...(actorContext
      ? toGatewayKeyRevocationActorContextRecord(actorContext)
      : {}),
    ...parseExplicitGatewayKeyRevocationMetadataPayload(payload, message)
  };
}

async function writeGatewayKeyRevocationById(
  keyId: string,
  revoked: boolean,
  payload: unknown,
  message: string,
  actorContext: GatewayKeyAuditActorContext | undefined,
  port: GatewayKeyRevocationByIdPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const { gatewayApiKey, ownership } = await port.resolveKeyById(keyId);
  const state = await port.writeKeyRevocationState(
    gatewayApiKey,
    revoked,
    buildGatewayKeyRevocationWriteRequestFromPayload(
      keyId,
      ownership,
      payload,
      message,
      actorContext
    )
  );

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

async function writeGatewayKeyRevocationRuntime(
  gatewayApiKey: GatewayApiKeyRecord,
  revoked: boolean,
  requestId: string,
  request: GatewayKeyRevocationWriteRequest | undefined,
  port: GatewayKeyRevocationRuntimeWritePort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  const recordEvent = request?.recordEvent ?? true;
  const ownership = recordEvent
    ? (request?.ownership ?? (await port.resolveOwnership(gatewayApiKey)))
    : undefined;
  const operationId = recordEvent
    ? (request?.operationId ?? requestId)
    : undefined;
  const nextRequest: GatewayKeyRevocationWriteRequest = {
    keyId: gatewayApiKey.id,
    ...(request?.recordEvent === false ? { recordEvent: false } : {}),
    ...(ownership ? { ownership } : {}),
    ...(operationId ? { operationId } : {}),
    ...(request?.reason ? { reason: request.reason } : {}),
    ...(request?.actor ? { actor: request.actor } : {}),
    ...(request?.actorSource ? { actorSource: request.actorSource } : {})
  };

  const state = await port.writeKeyRevocationState(
    gatewayApiKey,
    revoked,
    nextRequest
  );

  if (recordEvent && ownership && operationId) {
    await port.appendOperationEvent(
      createGatewayKeyAuditEvent({
        keyId: gatewayApiKey.id,
        kind: revoked ? "revoked" : "unrevoked",
        ownership,
        occurredAt: state.updatedAt,
        operationId,
        ...(request?.reason ? { reason: request.reason } : {}),
        ...(request?.actor ? { actor: request.actor } : {}),
        ...(request?.actorSource ? { actorSource: request.actorSource } : {})
      })
    );
  }

  return {
    keyId: gatewayApiKey.id,
    revoked: state.revoked,
    updatedAt: state.updatedAt
  };
}

export async function revokeGatewayKeyById(
  keyId: string,
  payload: unknown,
  message: string,
  actorContext: GatewayKeyAuditActorContext | undefined,
  port: GatewayKeyRevocationByIdPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return writeGatewayKeyRevocationById(
    keyId,
    true,
    payload,
    message,
    actorContext,
    port
  );
}

export async function clearGatewayKeyRevocationById(
  keyId: string,
  payload: unknown,
  message: string,
  actorContext: GatewayKeyAuditActorContext | undefined,
  port: GatewayKeyRevocationByIdPort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return writeGatewayKeyRevocationById(
    keyId,
    false,
    payload,
    message,
    actorContext,
    port
  );
}

export async function revokeGatewayKeyRuntime(
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  request: GatewayKeyRevocationWriteRequest | undefined,
  port: GatewayKeyRevocationRuntimeWritePort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return writeGatewayKeyRevocationRuntime(
    gatewayApiKey,
    true,
    requestId,
    request,
    port
  );
}

export async function clearGatewayKeyRevocationRuntime(
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  request: GatewayKeyRevocationWriteRequest | undefined,
  port: GatewayKeyRevocationRuntimeWritePort
): Promise<{ keyId: string; revoked: boolean; updatedAt: string }> {
  return writeGatewayKeyRevocationRuntime(
    gatewayApiKey,
    false,
    requestId,
    request,
    port
  );
}

export async function clearGatewayKeyRevocationOverlayState(
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  port: GatewayKeyRevocationRuntimeWritePort
): Promise<void> {
  await writeGatewayKeyRevocationRuntime(
    gatewayApiKey,
    false,
    requestId,
    {
      keyId: gatewayApiKey.id,
      recordEvent: false
    },
    port
  );
}

export function buildGatewayKeyRevocationStateTransition(
  revoked: boolean,
  request: GatewayKeyRevocationWriteRequest = {},
  now = new Date().toISOString()
): {
  nextState: GatewayKeyRevocationState;
  auditEvent?: GatewayKeyAuditEvent;
} {
  const nextState: GatewayKeyRevocationState = {
    revoked,
    updatedAt: now
  };

  if (request.recordEvent === false) {
    return { nextState };
  }

  return {
    nextState,
    auditEvent: createGatewayKeyAuditEvent({
      keyId: requestKeyIdFromGatewayKeyRevocationWriteRequest(request),
      kind: revoked ? "revoked" : "unrevoked",
      ownership: request.ownership ?? "configured",
      occurredAt: now,
      ...(request.operationId ? { operationId: request.operationId } : {}),
      ...(request.reason ? { reason: request.reason } : {}),
      ...(request.actor ? { actor: request.actor } : {}),
      ...(request.actorSource ? { actorSource: request.actorSource } : {})
    })
  };
}
