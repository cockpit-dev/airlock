import { GatewayError } from "@airlock/shared";
import {
  extractBearerToken,
  parseInternalAdminCredentials,
  validateInternalAdminCredential
} from "@airlock/governance";

import type { GatewayBindings } from "./env.js";
import {
  parseOptionalGatewayKeyAuditActor,
  type GatewayKeyAuditActorContext
} from "./gateway-key-audit.js";

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

    if (adminAuthorization) {
      return {
        actor: adminAuthorization.actor,
        actorSource: "credential"
      };
    }

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

    if (trustedHeaderActor) {
      return {
        actor: trustedHeaderActor,
        actorSource: "trusted_header"
      };
    }

    if (payloadActor) {
      return {
        actor: payloadActor,
        actorSource: "payload"
      };
    }

    if (env.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED) {
      throw new GatewayError("Admin actor metadata is required", {
        code: "auth_admin_actor_required",
        category: "authentication",
        httpStatus: 400,
        retryable: false,
        requestId
      });
    }

    return undefined;
  })();
}

export async function resolveAdminAuthorizationContext(
  request: Request,
  env: GatewayBindings,
  requestId: string
): Promise<{ credentialId: string; actor: string } | undefined> {
  const internalAdminCredentials = parseInternalAdminCredentials(
    env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
  );

  if (internalAdminCredentials.length === 0) {
    return undefined;
  }

  const bearerToken = extractBearerToken(
    request.headers.get("authorization") ?? undefined,
    requestId
  );

  return validateInternalAdminCredential(
    bearerToken,
    internalAdminCredentials,
    requestId
  );
}

export function stripAdminActorPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const rest = { ...payload };
  delete rest.actor;
  delete rest.actorSource;
  return rest;
}
