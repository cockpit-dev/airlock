import { describe, expect, it } from "vitest";

import {
  createGatewayKeyOperationSummary,
  createGatewayKeyAuditEvent,
  parseGatewayKeyAuditEvent,
  parseGatewayKeyAuditEventsResponse,
  parseGatewayKeyOperationEventsResponse,
  parseOptionalGatewayKeyAuditActor,
  parseOptionalGatewayKeyAuditActorSource,
  parseOptionalGatewayKeyAuditReason,
  sortGatewayKeyAuditEventsDescending
} from "./gateway-key-audit.js";

describe("createGatewayKeyAuditEvent", () => {
  it("omits empty optional fields from the normalized event", () => {
    expect(
      createGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "created",
        ownership: "registry",
        occurredAt: "2026-05-13T00:00:00.000Z"
      })
    ).toEqual({
      keyId: "key_1",
      kind: "created",
      ownership: "registry",
      occurredAt: "2026-05-13T00:00:00.000Z"
    });
  });
});

describe("parseGatewayKeyAuditEvent", () => {
  it("parses a valid audit event", () => {
    expect(
      parseGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "rotation_finalized",
        ownership: "registry",
        occurredAt: "2026-05-13T00:00:00.000Z",
        operationId: "req_bulk_123",
        reason: "promoted new secret",
        actor: "platform@example.com",
        actorSource: "credential",
        changes: [
          {
            field: "previousValueHash",
            before:
              "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            after: null
          }
        ]
      })
    ).toEqual({
      keyId: "key_1",
      kind: "rotation_finalized",
      ownership: "registry",
      occurredAt: "2026-05-13T00:00:00.000Z",
      operationId: "req_bulk_123",
      reason: "promoted new secret",
      actor: "platform@example.com",
      actorSource: "credential",
      changes: [
        {
          field: "previousValueHash",
          before:
            "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          after: null
        }
      ]
    });
  });

  it("accepts archived and restored event kinds", () => {
    expect(
      parseGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "archived",
        ownership: "registry",
        occurredAt: "2026-05-14T00:00:00.000Z"
      })
    ).toMatchObject({
      keyId: "key_1",
      kind: "archived",
      ownership: "registry"
    });

    expect(
      parseGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "restored",
        ownership: "registry",
        occurredAt: "2026-05-14T01:00:00.000Z"
      })
    ).toMatchObject({
      keyId: "key_1",
      kind: "restored",
      ownership: "registry"
    });
  });

  it("rejects invalid event kinds", () => {
    expect(() =>
      parseGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "unknown",
        ownership: "registry",
        occurredAt: "2026-05-13T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("rejects actorSource without actor", () => {
    expect(() =>
      parseGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "created",
        ownership: "registry",
        occurredAt: "2026-05-13T00:00:00.000Z",
        actorSource: "payload"
      })
    ).toThrow();
  });

  it("rejects invalid diff fields", () => {
    expect(() =>
      parseGatewayKeyAuditEvent({
        keyId: "key_1",
        kind: "updated",
        ownership: "registry",
        occurredAt: "2026-05-13T00:00:00.000Z",
        changes: [
          {
            field: "unknown_field",
            before: "a",
            after: "b"
          }
        ]
      })
    ).toThrow();
  });
});

describe("parseGatewayKeyAuditEventsResponse", () => {
  it("parses a response with matching key ids", () => {
    expect(
      parseGatewayKeyAuditEventsResponse({
        keyId: "key_1",
        events: [
          {
            keyId: "key_1",
            kind: "created",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:00.000Z"
          }
        ]
      })
    ).toEqual({
      keyId: "key_1",
      events: [
        {
          keyId: "key_1",
          kind: "created",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:00.000Z"
        }
      ]
    });
  });

  it("rejects responses whose child events use a different keyId", () => {
    expect(() =>
      parseGatewayKeyAuditEventsResponse({
        keyId: "key_1",
        events: [
          {
            keyId: "key_2",
            kind: "created",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:00.000Z"
          }
        ]
      })
    ).toThrow();
  });
});

describe("parseGatewayKeyOperationEventsResponse", () => {
  it("parses a response with matching operation ids", () => {
    expect(
      parseGatewayKeyOperationEventsResponse({
        operationId: "req_bulk_123",
        events: [
          {
            keyId: "key_1",
            kind: "updated",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:00.000Z",
            operationId: "req_bulk_123"
          },
          {
            keyId: "key_2",
            kind: "updated",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:01.000Z",
            operationId: "req_bulk_123"
          }
        ]
      })
    ).toEqual({
      operationId: "req_bulk_123",
      events: [
        {
          keyId: "key_1",
          kind: "updated",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:00.000Z",
          operationId: "req_bulk_123"
        },
        {
          keyId: "key_2",
          kind: "updated",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:01.000Z",
          operationId: "req_bulk_123"
        }
      ]
    });
  });

  it("rejects responses whose child events use a different operationId", () => {
    expect(() =>
      parseGatewayKeyOperationEventsResponse({
        operationId: "req_bulk_123",
        events: [
          {
            keyId: "key_1",
            kind: "updated",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:00.000Z",
            operationId: "req_other"
          }
        ]
      })
    ).toThrow();
  });
});

describe("createGatewayKeyOperationSummary", () => {
  it("aggregates counts, unique dimensions, time bounds, and uniform metadata", () => {
    expect(
      createGatewayKeyOperationSummary("req_bulk_123", [
        {
          keyId: "key_b",
          kind: "deleted",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:02.000Z",
          operationId: "req_bulk_123",
          reason: "tenant sunset",
          actor: "ops@example.com",
          actorSource: "credential"
        },
        {
          keyId: "key_a",
          kind: "deleted",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:01.000Z",
          operationId: "req_bulk_123",
          reason: "tenant sunset",
          actor: "ops@example.com",
          actorSource: "credential"
        },
        {
          keyId: "key_a",
          kind: "deleted",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:03.000Z",
          operationId: "req_bulk_123",
          reason: "tenant sunset",
          actor: "ops@example.com",
          actorSource: "credential"
        }
      ])
    ).toEqual({
      operationId: "req_bulk_123",
      keyIds: ["key_a", "key_b"],
      keyCount: 2,
      eventCount: 3,
      eventKinds: ["deleted"],
      ownerships: ["registry"],
      firstOccurredAt: "2026-05-13T00:00:01.000Z",
      lastOccurredAt: "2026-05-13T00:00:03.000Z",
      reason: "tenant sunset",
      actor: "ops@example.com",
      actorSource: "credential"
    });
  });

  it("drops non-uniform reason and actor metadata", () => {
    expect(
      createGatewayKeyOperationSummary("req_bulk_123", [
        {
          keyId: "key_a",
          kind: "updated",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:01.000Z",
          operationId: "req_bulk_123",
          reason: "phase 1",
          actor: "ops-a@example.com",
          actorSource: "credential"
        },
        {
          keyId: "key_b",
          kind: "deleted",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:02.000Z",
          operationId: "req_bulk_123",
          reason: "phase 2",
          actor: "ops-b@example.com",
          actorSource: "credential"
        }
      ])
    ).toEqual({
      operationId: "req_bulk_123",
      keyIds: ["key_a", "key_b"],
      keyCount: 2,
      eventCount: 2,
      eventKinds: ["deleted", "updated"],
      ownerships: ["registry"],
      firstOccurredAt: "2026-05-13T00:00:01.000Z",
      lastOccurredAt: "2026-05-13T00:00:02.000Z"
    });
  });
});

describe("sortGatewayKeyAuditEventsDescending", () => {
  it("sorts events newest-first by occurredAt", () => {
    expect(
      sortGatewayKeyAuditEventsDescending([
        {
          keyId: "key_1",
          kind: "created",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:00.000Z"
        },
        {
          keyId: "key_1",
          kind: "rotated",
          ownership: "registry",
          occurredAt: "2026-05-14T00:00:00.000Z"
        }
      ])
    ).toEqual([
      {
        keyId: "key_1",
        kind: "rotated",
        ownership: "registry",
        occurredAt: "2026-05-14T00:00:00.000Z"
      },
      {
        keyId: "key_1",
        kind: "created",
        ownership: "registry",
        occurredAt: "2026-05-13T00:00:00.000Z"
      }
    ]);
  });
});

describe("optional gateway key audit field parsers", () => {
  it("parses valid reason, actor, and actorSource values", () => {
    expect(parseOptionalGatewayKeyAuditReason("  maintenance window  ")).toBe(
      "maintenance window"
    );
    expect(parseOptionalGatewayKeyAuditActor("  sre@example.com  ")).toBe(
      "sre@example.com"
    );
    expect(parseOptionalGatewayKeyAuditActorSource("trusted_header")).toBe(
      "trusted_header"
    );
  });

  it("rejects invalid reason, actor, and actorSource values", () => {
    expect(() => parseOptionalGatewayKeyAuditReason("   ")).toThrow();
    expect(() => parseOptionalGatewayKeyAuditActor("   ")).toThrow();
    expect(() => parseOptionalGatewayKeyAuditActorSource("spoofed")).toThrow();
  });
});
