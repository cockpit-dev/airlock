export type GatewayKeyAuditOwnership = "configured" | "registry";
export type GatewayKeyAuditActorSource =
  | "payload"
  | "trusted_header"
  | "credential";

export type GatewayKeyAuditEventKind =
  | "created"
  | "updated"
  | "override_updated"
  | "override_cleared"
  | "archived"
  | "restored"
  | "rotated"
  | "rotation_finalized"
  | "rotation_canceled"
  | "deleted"
  | "revoked"
  | "unrevoked";

export type GatewayKeyAuditDiffField =
  | "label"
  | "status"
  | "notBefore"
  | "expiresAt"
  | "policy"
  | "registryOverride"
  | "valueHash"
  | "previousValueHash"
  | "previousValueHashExpiresAt"
  | "archivedAt";

export type GatewayKeyAuditDiffValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>;

export interface GatewayKeyAuditFieldChange {
  field: GatewayKeyAuditDiffField;
  before?: GatewayKeyAuditDiffValue;
  after?: GatewayKeyAuditDiffValue;
}

export interface GatewayKeyAuditEvent {
  keyId: string;
  kind: GatewayKeyAuditEventKind;
  ownership: GatewayKeyAuditOwnership;
  occurredAt: string;
  operationId?: string;
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
  changes?: GatewayKeyAuditFieldChange[];
}

export interface GatewayKeyAuditActorContext {
  actor: string;
  actorSource: GatewayKeyAuditActorSource;
}

export interface GatewayKeyAuditEventsResponse {
  keyId: string;
  events: GatewayKeyAuditEvent[];
}

export interface GatewayKeyOperationEventsResponse {
  operationId: string;
  summary?: GatewayKeyOperationSummary;
  events: GatewayKeyAuditEvent[];
}

export interface GatewayKeyOperationSummary {
  operationId: string;
  keyIds: string[];
  keyCount: number;
  eventCount: number;
  eventKinds: GatewayKeyAuditEventKind[];
  ownerships: GatewayKeyAuditOwnership[];
  firstOccurredAt: string;
  lastOccurredAt: string;
  reason?: string;
  actor?: string;
  actorSource?: GatewayKeyAuditActorSource;
}

function isGatewayKeyAuditEventKind(
  value: unknown
): value is GatewayKeyAuditEventKind {
  return (
    value === "created" ||
    value === "updated" ||
    value === "override_updated" ||
    value === "override_cleared" ||
    value === "archived" ||
    value === "restored" ||
    value === "rotated" ||
    value === "rotation_finalized" ||
    value === "rotation_canceled" ||
    value === "deleted" ||
    value === "revoked" ||
    value === "unrevoked"
  );
}

function isGatewayKeyAuditOwnership(
  value: unknown
): value is GatewayKeyAuditOwnership {
  return value === "configured" || value === "registry";
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
    ...(event.operationId ? { operationId: event.operationId } : {}),
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.actor && event.actorSource
      ? { actorSource: event.actorSource }
      : {}),
    ...(event.changes && event.changes.length > 0
      ? {
          changes: event.changes.map((change) => {
            return {
              field: change.field,
              ...(change.before !== undefined ? { before: change.before } : {}),
              ...(change.after !== undefined ? { after: change.after } : {})
            };
          })
        }
      : {})
  };
}

function isGatewayKeyAuditDiffField(value: unknown): value is GatewayKeyAuditDiffField {
  return (
    value === "label" ||
    value === "status" ||
    value === "notBefore" ||
    value === "expiresAt" ||
    value === "policy" ||
    value === "registryOverride" ||
    value === "valueHash" ||
    value === "previousValueHash" ||
    value === "previousValueHashExpiresAt" ||
    value === "archivedAt"
  );
}

function isGatewayKeyAuditDiffValue(
  value: unknown
): value is GatewayKeyAuditDiffValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    isRecord(value)
  );
}

function parseGatewayKeyAuditFieldChange(
  value: unknown
): GatewayKeyAuditFieldChange {
  if (!isRecord(value)) {
    throw new Error("Gateway key audit event change must be an object");
  }

  if (!isGatewayKeyAuditDiffField(value.field)) {
    throw new Error("Gateway key audit event change field is invalid");
  }

  if (value.before === undefined && value.after === undefined) {
    throw new Error(
      "Gateway key audit event change must include before or after"
    );
  }

  if (
    (value.before !== undefined && !isGatewayKeyAuditDiffValue(value.before)) ||
    (value.after !== undefined && !isGatewayKeyAuditDiffValue(value.after))
  ) {
    throw new Error("Gateway key audit event change value is invalid");
  }

  return {
    field: value.field,
    ...(value.before !== undefined ? { before: value.before } : {}),
    ...(value.after !== undefined ? { after: value.after } : {})
  };
}

export function parseGatewayKeyAuditEvent(value: unknown): GatewayKeyAuditEvent {
  if (!isRecord(value)) {
    throw new Error("Gateway key audit event must be an object");
  }

  const {
    keyId,
    kind,
    ownership,
    occurredAt,
    operationId,
    reason,
    actor,
    actorSource,
    changes
  } = value;

  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new Error("Gateway key audit event keyId must be a non-empty string");
  }

  if (
    kind !== "created" &&
    kind !== "updated" &&
    kind !== "override_updated" &&
    kind !== "override_cleared" &&
    kind !== "archived" &&
    kind !== "restored" &&
    kind !== "rotated" &&
    kind !== "rotation_finalized" &&
    kind !== "rotation_canceled" &&
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

  if (
    operationId !== undefined &&
    (typeof operationId !== "string" || operationId.trim().length === 0)
  ) {
    throw new Error("Gateway key audit event operationId is invalid");
  }

  const parsedReason = parseOptionalGatewayKeyAuditReason(reason);
  const parsedActor = parseOptionalGatewayKeyAuditActor(actor);
  const parsedActorSource = parseOptionalGatewayKeyAuditActorSource(actorSource);
  const parsedChanges =
    changes === undefined
      ? undefined
      : Array.isArray(changes)
        ? changes.map((change) => {
            return parseGatewayKeyAuditFieldChange(change);
          })
        : (() => {
            throw new Error("Gateway key audit event changes are invalid");
          })();

  if (parsedActorSource && !parsedActor) {
    throw new Error(
      "Gateway key audit event actorSource requires a corresponding actor"
    );
  }

  return {
    keyId,
    kind,
    ownership,
    occurredAt,
    ...(typeof operationId === "string" ? { operationId: operationId.trim() } : {}),
    ...(parsedReason ? { reason: parsedReason } : {}),
    ...(parsedActor ? { actor: parsedActor } : {}),
    ...(parsedActor && parsedActorSource
      ? { actorSource: parsedActorSource }
      : {}),
    ...(parsedChanges && parsedChanges.length > 0
      ? { changes: parsedChanges }
      : {})
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

export function parseGatewayKeyOperationEventsResponse(
  value: unknown
): GatewayKeyOperationEventsResponse {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    value.operationId.trim().length === 0 ||
    !Array.isArray(value.events)
  ) {
    throw new Error("Gateway key operation events response is invalid");
  }

  const operationId = value.operationId.trim();
  const events = value.events.map((event) => {
    const parsedEvent = parseGatewayKeyAuditEvent(event);

    if (parsedEvent.operationId !== operationId) {
      throw new Error(
        "Gateway key audit event operationId does not match response"
      );
    }

    return parsedEvent;
  });

  return {
    operationId,
    ...(isRecord(value.summary)
      ? {
          summary: {
            operationId,
            keyIds: Array.isArray(value.summary.keyIds)
              ? value.summary.keyIds.filter((entry) => typeof entry === "string")
              : [],
            keyCount:
              typeof value.summary.keyCount === "number" ? value.summary.keyCount : 0,
            eventCount:
              typeof value.summary.eventCount === "number"
                ? value.summary.eventCount
                : events.length,
            eventKinds: Array.isArray(value.summary.eventKinds)
              ? value.summary.eventKinds.filter((entry) =>
                  isGatewayKeyAuditEventKind(entry)
                )
              : [],
            ownerships: Array.isArray(value.summary.ownerships)
              ? value.summary.ownerships.filter((entry) =>
                  isGatewayKeyAuditOwnership(entry)
                )
              : [],
            firstOccurredAt:
              typeof value.summary.firstOccurredAt === "string"
                ? value.summary.firstOccurredAt
                : events[events.length - 1]?.occurredAt ?? operationId,
            lastOccurredAt:
              typeof value.summary.lastOccurredAt === "string"
                ? value.summary.lastOccurredAt
                : events[0]?.occurredAt ?? operationId,
            ...(typeof value.summary.reason === "string"
              ? { reason: value.summary.reason }
              : {}),
            ...(typeof value.summary.actor === "string"
              ? { actor: value.summary.actor }
              : {}),
            ...(typeof value.summary.actorSource === "string"
              ? { actorSource: value.summary.actorSource as GatewayKeyAuditActorSource }
              : {})
          } satisfies GatewayKeyOperationSummary
        }
      : {}),
    events
  };
}

export function createGatewayKeyOperationSummary(
  operationId: string,
  events: readonly GatewayKeyAuditEvent[]
): GatewayKeyOperationSummary {
  const sortedKeyIds = [...new Set(events.map((event) => event.keyId))].sort();
  const sortedEventKinds = [...new Set(events.map((event) => event.kind))].sort(
    (left, right) => left.localeCompare(right)
  );
  const sortedOwnerships = [...new Set(events.map((event) => event.ownership))].sort(
    (left, right) => left.localeCompare(right)
  );
  const occurredAtValues = events.map((event) => event.occurredAt).sort();
  const reasons = [...new Set(events.map((event) => event.reason).filter(Boolean))];
  const actors = [...new Set(events.map((event) => event.actor).filter(Boolean))];
  const actorSources = [
    ...new Set(events.map((event) => event.actorSource).filter(Boolean))
  ];

  return {
    operationId,
    keyIds: sortedKeyIds,
    keyCount: sortedKeyIds.length,
    eventCount: events.length,
    eventKinds: sortedEventKinds,
    ownerships: sortedOwnerships,
    firstOccurredAt: occurredAtValues[0]!,
    lastOccurredAt: occurredAtValues[occurredAtValues.length - 1]!,
    ...(reasons.length === 1 ? { reason: reasons[0]! } : {}),
    ...(actors.length === 1 ? { actor: actors[0]! } : {}),
    ...(actors.length === 1 && actorSources.length === 1
      ? { actorSource: actorSources[0]! }
      : {})
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

export function parseOptionalGatewayKeyAuditActorSource(
  value: unknown
): GatewayKeyAuditActorSource | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value !== "payload" &&
    value !== "trusted_header" &&
    value !== "credential"
  ) {
    throw new Error("Gateway key audit actorSource is invalid");
  }

  return value;
}

export function toGatewayAuditRecord(
  value: object
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}
