import {
  parseInternalAdminCredentials,
  parseOptionalPayloadActor as parseOptionalPayloadActorFromGovernance,
  type GatewayKeyAuditActorContext,
  resolveAdminMutationActorCommand as resolveAdminMutationActorCommandFromGovernance,
  resolveInternalAdminAuthorization
} from "@airlock/governance";

import type { GatewayBindings } from "./env.js";

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
  return parseOptionalPayloadActorFromGovernance(payload, message);
}

export async function resolveAdminActorContext(
  request: Request,
  env: GatewayBindings,
  payloadActor: string | undefined,
  requestId: string
): Promise<GatewayKeyAuditActorContext | undefined> {
  const command = await resolveAdminMutationActorCommandFromGovernance({
    request,
    payload: payloadActor ? { actor: payloadActor } : {},
    requestId,
    invalidPayloadMessage: "Gateway key actor payload is invalid",
    actorRequired: env.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED,
    trustedActorHeaderName: normalizeHeaderName(
      env.AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER
    ),
    adminToken: undefined,
    structuredCredentialsConfig: env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
  });

  return command.actorContext;
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
  return resolveAdminMutationActorCommandFromGovernance({
    request,
    payload,
    requestId,
    invalidPayloadMessage: message,
    actorRequired: env.AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED,
    trustedActorHeaderName: normalizeHeaderName(
      env.AIRLOCK_INTERNAL_ADMIN_ACTOR_HEADER
    ),
    adminToken: undefined,
    structuredCredentialsConfig: env.AIRLOCK_INTERNAL_ADMIN_CREDENTIALS
  });
}
