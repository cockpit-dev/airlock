import { GatewayError } from "@airlock/shared";

import type { GatewayKeyAuditActorContext } from "./gateway-key-audit.js";

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

export interface BuildAdminMutationActorCommandInput
  extends ResolveAdminActorContextInput {
  payload: unknown;
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
