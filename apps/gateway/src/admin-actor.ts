import { GatewayError } from "@airlock/shared";
import {
  buildAdminMutationActorCommand,
  parseInternalAdminCredentials,
  parseOptionalGatewayKeyAuditActor,
  type GatewayKeyAuditActorContext,
  resolveAdminActorContextFromInputs,
  resolveInternalAdminAuthorization
} from "@airlock/governance";

import type { GatewayBindings } from "./env.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new GatewayError(message, {
      code: "gateway_key_invalid_actor_payload",
      category: "governance",
      httpStatus: 400,
      retryable: false,
      cause
    });
  }
}

export function resolveAdminActorContext(
  request: Request,
  env: GatewayBindings,
  payloadActor: string | undefined,
  requestId: string
): Promise<GatewayKeyAuditActorContext | undefined> {
  return (async () => {
    const adminAuthorization = await resolveAdminAuthorizationContext(
      request,
      env,
      requestId
    );

    const trustedHeaderName = normalizeHeaderName(
      env.AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER
    );
    let trustedHeaderActor: string | undefined;

    try {
      trustedHeaderActor = trustedHeaderName
        ? parseOptionalGatewayKeyAuditActor(
            request.headers.get(trustedHeaderName) ?? undefined
          )
        : undefined;
    } catch (cause) {
      throw new GatewayError("Admin actor header is invalid", {
        code: "auth_invalid_admin_actor",
        category: "authentication",
        httpStatus: 400,
        retryable: false,
        requestId,
        cause
      });
    }

    return resolveAdminActorContextFromInputs({
      credentialActor: adminAuthorization?.actor,
      trustedHeaderActor,
      payloadActor,
      actorRequired: env.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED,
      requestId
    });
  })();
}

export async function resolveAdminAuthorizationContext(
  request: Request,
  env: GatewayBindings,
  requestId: string
): Promise<{ credentialId: string; actor: string } | undefined> {
  return resolveInternalAdminAuthorization({
    authorization: request.headers.get("authorization") ?? undefined,
    adminToken: undefined,
    adminCredentials: parseInternalAdminCredentials(
      env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
    ),
    structuredCredentialsConfig: env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS,
    requestId
  });
}

export async function resolveAdminMutationActorCommand(
  request: Request,
  env: GatewayBindings,
  payload: unknown,
  requestId: string,
  message: string
): Promise<{
  actorContext?: GatewayKeyAuditActorContext;
  payload: unknown;
}> {
  const payloadActor = parseOptionalPayloadActor(payload, message);
  const adminAuthorization = await resolveAdminAuthorizationContext(
    request,
    env,
    requestId
  );
  const trustedHeaderName = normalizeHeaderName(
    env.AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER
  );
  let trustedHeaderActor: string | undefined;

  try {
    trustedHeaderActor = trustedHeaderName
      ? parseOptionalGatewayKeyAuditActor(
          request.headers.get(trustedHeaderName) ?? undefined
        )
      : undefined;
  } catch (cause) {
    throw new GatewayError("Admin actor header is invalid", {
      code: "auth_invalid_admin_actor",
      category: "authentication",
      httpStatus: 400,
      retryable: false,
      requestId,
      cause
    });
  }

  return buildAdminMutationActorCommand({
    payload,
    credentialActor: adminAuthorization?.actor,
    trustedHeaderActor,
    payloadActor,
    actorRequired: env.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED,
    requestId
  });
}
