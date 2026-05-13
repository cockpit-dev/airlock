export type GatewayKeyAuditOwnership = "configured" | "registry";

export type GatewayKeyAuditEventKind =
  | "created"
  | "rotated"
  | "deleted"
  | "revoked"
  | "unrevoked";

export interface GatewayKeyAuditEvent {
  keyId: string;
  kind: GatewayKeyAuditEventKind;
  ownership: GatewayKeyAuditOwnership;
  occurredAt: string;
  reason?: string;
  actor?: string;
}

export interface GatewayKeyAuditEventsResponse {
  keyId: string;
  events: GatewayKeyAuditEvent[];
}

export const MAX_GATEWAY_KEY_AUDIT_EVENTS = 64;
export const MAX_GATEWAY_KEY_AUDIT_REASON_LENGTH = 280;
export const MAX_GATEWAY_KEY_AUDIT_ACTOR_LENGTH = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function createGatewayKeyAuditEvent(
  event: GatewayKeyAuditEvent
): GatewayKeyAuditEvent {
  return {
    keyId: event.keyId,
    kind: event.kind,
    ownership: event.ownership,
    occurredAt: event.occurredAt,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.actor ? { actor: event.actor } : {})
  };
}

export function parseGatewayKeyAuditEvent(value: unknown): GatewayKeyAuditEvent {
  if (!isRecord(value)) {
    throw new Error("Gateway key audit event must be an object");
  }

  const { keyId, kind, ownership, occurredAt, reason, actor } = value;

  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new Error("Gateway key audit event keyId must be a non-empty string");
  }

  if (
    kind !== "created" &&
    kind !== "rotated" &&
    kind !== "deleted" &&
    kind !== "revoked" &&
    kind !== "unrevoked"
  ) {
    throw new Error("Gateway key audit event kind is invalid");
  }

  if (ownership !== "configured" && ownership !== "registry") {
    throw new Error("Gateway key audit event ownership is invalid");
  }

  if (typeof occurredAt !== "string" || !isValidTimestamp(occurredAt)) {
    throw new Error("Gateway key audit event occurredAt is invalid");
  }

  const parsedReason = parseOptionalGatewayKeyAuditReason(reason);
  const parsedActor = parseOptionalGatewayKeyAuditActor(actor);

  return {
    keyId,
    kind,
    ownership,
    occurredAt,
    ...(parsedReason ? { reason: parsedReason } : {}),
    ...(parsedActor ? { actor: parsedActor } : {})
  };
}

export function parseGatewayKeyAuditEventsResponse(
  value: unknown
): GatewayKeyAuditEventsResponse {
  if (
    !isRecord(value) ||
    typeof value.keyId !== "string" ||
    !Array.isArray(value.events)
  ) {
    throw new Error("Gateway key audit events response is invalid");
  }

  const keyId = value.keyId;
  const events = value.events.map((event) => {
    const parsedEvent = parseGatewayKeyAuditEvent(event);

    if (parsedEvent.keyId !== keyId) {
      throw new Error("Gateway key audit event keyId does not match response");
    }

    return parsedEvent;
  });

  return {
    keyId,
    events
  };
}

export function sortGatewayKeyAuditEventsDescending(
  events: readonly GatewayKeyAuditEvent[]
): GatewayKeyAuditEvent[] {
  return [...events].sort((left, right) => {
    return right.occurredAt.localeCompare(left.occurredAt);
  });
}

export function parseOptionalGatewayKeyAuditReason(
  value: unknown
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("Gateway key audit reason must be a string");
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error("Gateway key audit reason must not be empty");
  }

  if (trimmed.length > MAX_GATEWAY_KEY_AUDIT_REASON_LENGTH) {
    throw new Error("Gateway key audit reason is too long");
  }

  return trimmed;
}

export function parseOptionalGatewayKeyAuditActor(
  value: unknown
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("Gateway key audit actor must be a string");
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error("Gateway key audit actor must not be empty");
  }

  if (trimmed.length > MAX_GATEWAY_KEY_AUDIT_ACTOR_LENGTH) {
    throw new Error("Gateway key audit actor is too long");
  }

  return trimmed;
}
