import { GatewayError } from "@airlock/shared";

import type { GatewayKeyAuditActorContext } from "./gateway-key-audit.js";
import {
  parseInternalAdminCredentials,
  resolveInternalAdminAuthorization
} from "./gateway-auth.js";
import { parseOptionalGatewayKeyAuditActor } from "./gateway-key-audit.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ResolveAdminActorContextInput {
  credentialActor: string | undefined;
  trustedHeaderActor: string | undefined;
  payloadActor: string | undefined;
  actorRequired: boolean;
  requestId: string;
}

export interface BuildAdminMutationActorCommandInput extends ResolveAdminActorContextInput {
  payload: unknown;
}

export interface ResolveAdminMutationActorCommandInput {
  request: Request;
  payload: unknown;
  requestId: string;
  invalidPayloadMessage: string;
  actorRequired: boolean;
  trustedActorHeaderName: string | undefined;
  adminToken: string | undefined;
  structuredCredentialsConfig: string | undefined;
}

function createAdminActorRequiredError(requestId: string): GatewayError {
  return new GatewayError("Admin actor metadata is required", {
    code: "auth_admin_actor_required",
    category: "authentication",
    httpStatus: 400,
    retryable: false,
    requestId
  });
}

function createInvalidAdminActorHeaderError(
  requestId: string,
  cause: unknown
): GatewayError {
  return new GatewayError("Admin actor header is invalid", {
    code: "auth_invalid_admin_actor",
    category: "authentication",
    httpStatus: 400,
    retryable: false,
    requestId,
    cause
  });
}

function createInvalidAdminActorPayloadError(
  message: string,
  cause: unknown
): GatewayError {
  return new GatewayError(message, {
    code: "gateway_key_invalid_actor_payload",
    category: "governance",
    httpStatus: 400,
    retryable: false,
    cause
  });
}

function normalizeHeaderName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseOptionalPayloadActor(
  payload: unknown,
  message: string
): string | undefined {
  if (payload === undefined || payload === null) {
    return undefined;
  }

  if (!isRecord(payload) || !("actor" in payload)) {
    return undefined;
  }

  try {
    return parseOptionalGatewayKeyAuditActor(payload.actor);
  } catch (cause) {
    throw createInvalidAdminActorPayloadError(message, cause);
  }
}

export async function resolveAdminMutationActorCommand(
  input: ResolveAdminMutationActorCommandInput
): Promise<{
  actorContext?: GatewayKeyAuditActorContext;
  payload: unknown;
}> {
  const payloadActor = parseOptionalPayloadActor(
    input.payload,
    input.invalidPayloadMessage
  );
  const adminAuthorization = await authorizeStructuredAdminCredential(input);
  const trustedHeaderName = normalizeHeaderName(input.trustedActorHeaderName);
  let trustedHeaderActor: string | undefined;

  try {
    trustedHeaderActor = trustedHeaderName
      ? parseOptionalGatewayKeyAuditActor(
          input.request.headers.get(trustedHeaderName) ?? undefined
        )
      : undefined;
  } catch (cause) {
    throw createInvalidAdminActorHeaderError(input.requestId, cause);
  }

  return buildAdminMutationActorCommand({
    payload: input.payload,
    credentialActor: adminAuthorization?.actor,
    trustedHeaderActor,
    payloadActor,
    actorRequired: input.actorRequired,
    requestId: input.requestId
  });
}

async function authorizeStructuredAdminCredential(
  input: ResolveAdminMutationActorCommandInput
): Promise<{ credentialId: string; actor: string } | undefined> {
  return resolveInternalAdminAuthorization({
    authorization: input.request.headers.get("authorization") ?? undefined,
    adminToken: input.adminToken,
    adminCredentials: parseInternalAdminCredentials(
      input.structuredCredentialsConfig
    ),
    structuredCredentialsConfig: input.structuredCredentialsConfig,
    requestId: input.requestId
  });
}

export function resolveAdminActorContextFromInputs(
  input: ResolveAdminActorContextInput
): GatewayKeyAuditActorContext | undefined {
  if (input.credentialActor) {
    return {
      actor: input.credentialActor,
      actorSource: "credential"
    };
  }

  if (input.trustedHeaderActor) {
    return {
      actor: input.trustedHeaderActor,
      actorSource: "trusted_header"
    };
  }

  if (input.payloadActor) {
    return {
      actor: input.payloadActor,
      actorSource: "payload"
    };
  }

  if (input.actorRequired) {
    throw createAdminActorRequiredError(input.requestId);
  }

  return undefined;
}

export function buildAdminMutationPayload(
  payload: unknown,
  actorContext: GatewayKeyAuditActorContext | undefined
): unknown {
  if (!actorContext || !isRecord(payload)) {
    return payload;
  }

  const nextPayload = { ...payload };
  delete nextPayload.actor;
  delete nextPayload.actorSource;
  return nextPayload;
}

export function buildAdminMutationActorCommand(
  input: BuildAdminMutationActorCommandInput
): {
  actorContext?: GatewayKeyAuditActorContext;
  payload: unknown;
} {
  const actorContext = resolveAdminActorContextFromInputs(input);
  const payload = buildAdminMutationPayload(input.payload, actorContext);

  return {
    ...(actorContext ? { actorContext } : {}),
    payload
  };
}
