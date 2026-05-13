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
import type { GatewayApiKeyRecord, GatewayApiKeyOwnership } from "./gateway-auth.js";

export interface GatewayKeyRevocationState {
  revoked: boolean;
  updatedAt: string;
}

export interface GatewayKeyRevocationWriteRequest {
  keyId?: string;
  recordEvent?: boolean;
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

  const { keyId, recordEvent, ownership } = body;
  let reason: string | undefined;
  let actor: string | undefined;
  let actorSource: GatewayKeyAuditActorSource | undefined;

  if (keyId !== undefined && (typeof keyId !== "string" || keyId.length === 0)) {
    throw new Error("Revocation write request keyId is invalid");
  }

  if (recordEvent !== undefined && typeof recordEvent !== "boolean") {
    throw new Error("Revocation write request recordEvent is invalid");
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
    ...(ownership !== undefined ? { ownership } : {}),
    ...(reason ? { reason } : {}),
    ...(actor ? { actor } : {}),
    ...(actor && actorSource ? { actorSource } : {})
  };
}

export function requestKeyIdFromGatewayKeyRevocationWriteRequest(
  request: GatewayKeyRevocationWriteRequest
): string {
  const keyId = (request as GatewayKeyRevocationWriteRequest & { keyId?: unknown })
    .keyId;

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
      ...(request.reason ? { reason: request.reason } : {}),
      ...(request.actor ? { actor: request.actor } : {}),
      ...(request.actorSource ? { actorSource: request.actorSource } : {})
    })
  };
}
