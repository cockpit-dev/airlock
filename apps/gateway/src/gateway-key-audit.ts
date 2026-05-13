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
}

export interface GatewayKeyAuditEventsResponse {
  keyId: string;
  events: GatewayKeyAuditEvent[];
}

export const MAX_GATEWAY_KEY_AUDIT_EVENTS = 64;

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
    occurredAt: event.occurredAt
  };
}

export function parseGatewayKeyAuditEvent(value: unknown): GatewayKeyAuditEvent {
  if (!isRecord(value)) {
    throw new Error("Gateway key audit event must be an object");
  }

  const { keyId, kind, ownership, occurredAt } = value;

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

  return {
    keyId,
    kind,
    ownership,
    occurredAt
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
