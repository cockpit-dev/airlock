import { describe, expect, it } from "vitest";

import {
  buildGatewayKeyRevocationStateTransition,
  DEFAULT_GATEWAY_KEY_REVOCATION_STATE,
  parseExplicitGatewayKeyRevocationMetadataPayload,
  parseGatewayKeyRevocationState,
  parseGatewayKeyRevocationWriteRequest,
  requestKeyIdFromGatewayKeyRevocationWriteRequest,
  toGatewayKeyRevocationActorContextRecord
} from "./gateway-key-revocation.js";

describe("parseGatewayKeyRevocationState", () => {
  it("parses a valid revocation state", () => {
    expect(
      parseGatewayKeyRevocationState({
        revoked: true,
        updatedAt: "2026-05-13T00:00:00.000Z"
      })
    ).toEqual({
      revoked: true,
      updatedAt: "2026-05-13T00:00:00.000Z"
    });
  });

  it("exposes the default revocation state", () => {
    expect(DEFAULT_GATEWAY_KEY_REVOCATION_STATE).toEqual({
      revoked: false,
      updatedAt: new Date(0).toISOString()
    });
  });
});

describe("parseGatewayKeyRevocationWriteRequest", () => {
  it("parses a valid write request", () => {
    expect(
      parseGatewayKeyRevocationWriteRequest({
        keyId: "gak_1",
        recordEvent: true,
        ownership: "registry",
        reason: "incident containment",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
      keyId: "gak_1",
      recordEvent: true,
      ownership: "registry",
      reason: "incident containment",
      actor: "ops@example.com",
      actorSource: "trusted_header"
    });
  });

  it("rejects invalid write-request fields", () => {
    expect(() =>
      parseGatewayKeyRevocationWriteRequest({
        keyId: "",
        recordEvent: "yes"
      })
    ).toThrow();
  });
});

describe("revocation metadata helpers", () => {
  it("parses explicit metadata and preserves actorSource only on that path", () => {
    expect(
      parseExplicitGatewayKeyRevocationMetadataPayload(
        {
          reason: "incident containment",
          actor: "ops@example.com",
          actorSource: "trusted_header"
        },
        "Gateway key revocation payload is invalid"
      )
    ).toEqual({
      reason: "incident containment",
      actor: "ops@example.com",
      actorSource: "trusted_header"
    });

    expect(
      toGatewayKeyRevocationActorContextRecord({
        actor: "ops@example.com",
        actorSource: "credential"
      })
    ).toEqual({
      actor: "ops@example.com",
      actorSource: "credential"
    });
  });

  it("extracts the required keyId for audit-event assembly", () => {
    expect(
      requestKeyIdFromGatewayKeyRevocationWriteRequest({
        keyId: "gak_1"
      })
    ).toBe("gak_1");
  });
});

describe("buildGatewayKeyRevocationStateTransition", () => {
  it("builds the next state and audit event when recording is enabled", () => {
    expect(
      buildGatewayKeyRevocationStateTransition(true, {
        keyId: "gak_1",
        ownership: "configured",
        reason: "incident containment",
        actor: "ops@example.com",
        actorSource: "payload"
      }, "2026-05-13T00:00:00.000Z")
    ).toEqual({
      nextState: {
        revoked: true,
        updatedAt: "2026-05-13T00:00:00.000Z"
      },
      auditEvent: {
        keyId: "gak_1",
        kind: "revoked",
        ownership: "configured",
        occurredAt: "2026-05-13T00:00:00.000Z",
        reason: "incident containment",
        actor: "ops@example.com",
        actorSource: "payload"
      }
    });
  });

  it("omits audit events when recordEvent is disabled", () => {
    expect(
      buildGatewayKeyRevocationStateTransition(false, {
        keyId: "gak_1",
        recordEvent: false
      }, "2026-05-13T00:00:00.000Z")
    ).toEqual({
      nextState: {
        revoked: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      }
    });
  });
});
