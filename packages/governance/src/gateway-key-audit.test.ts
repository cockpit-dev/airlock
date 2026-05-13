import { describe, expect, it } from "vitest";

import {
  createGatewayKeyAuditEvent,
  parseGatewayKeyAuditEvent,
  parseGatewayKeyAuditEventsResponse,
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
        reason: "promoted new secret",
        actor: "platform@example.com",
        actorSource: "credential"
      })
    ).toEqual({
      keyId: "key_1",
      kind: "rotation_finalized",
      ownership: "registry",
      occurredAt: "2026-05-13T00:00:00.000Z",
      reason: "promoted new secret",
      actor: "platform@example.com",
      actorSource: "credential"
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
