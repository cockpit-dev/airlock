import { describe, expect, it, vi } from "vitest";

import {
  buildGatewayKeyRevocationStateTransition,
  DEFAULT_GATEWAY_KEY_REVOCATION_STATE,
  clearGatewayKeyRevocationById,
  parseExplicitGatewayKeyRevocationMetadataPayload,
  parseGatewayKeyRevocationState,
  parseGatewayKeyRevocationWriteRequest,
  revokeGatewayKeyById,
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
        operationId: "req_123",
        ownership: "registry",
        reason: "incident containment",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
        keyId: "gak_1",
        recordEvent: true,
        operationId: "req_123",
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
        operationId: "req_123",
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
        operationId: "req_123",
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

describe("revokeGatewayKeyById", () => {
  it("merges ownership, explicit metadata, and actor context before delegating to the write port", async () => {
    const resolveKeyById = vi.fn().mockResolvedValue({
      gatewayApiKey: {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash: "hash",
        status: "active" as const
      },
      ownership: "registry" as const
    });
    const writeKeyRevocationState = vi.fn().mockResolvedValue({
      revoked: true,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      revokeGatewayKeyById(
        "key_dynamic",
        {
          reason: "incident containment"
        },
        "Gateway key revocation payload is invalid",
        {
          actor: "ops@example.com",
          actorSource: "credential"
        },
        {
          resolveKeyById,
          writeKeyRevocationState
        }
      )
    ).resolves.toEqual({
      keyId: "key_dynamic",
      revoked: true,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    expect(writeKeyRevocationState).toHaveBeenCalledWith(
      {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash: "hash",
        status: "active"
      },
      true,
      {
        keyId: "key_dynamic",
        ownership: "registry",
        reason: "incident containment",
        actor: "ops@example.com",
        actorSource: "credential"
      }
    );
  });

  it("continues to reject invalid explicit metadata payloads", async () => {
    await expect(
      revokeGatewayKeyById(
        "key_dynamic",
        {
          reason: ""
        },
        "Gateway key revocation payload is invalid",
        undefined,
        {
          resolveKeyById: vi.fn().mockResolvedValue({
            gatewayApiKey: {
              id: "key_dynamic",
              label: "Dynamic Key",
              valueHash: "hash",
              status: "active"
            },
            ownership: "registry"
          }),
          writeKeyRevocationState: vi.fn()
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_revocation_invalid_payload"
    });
  });
});

describe("clearGatewayKeyRevocationById", () => {
  it("produces a stable unrevoke response and writes revoked=false", async () => {
    const writeKeyRevocationState = vi.fn().mockResolvedValue({
      revoked: false,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    await expect(
      clearGatewayKeyRevocationById(
        "key_configured",
        undefined,
        "Gateway key revocation payload is invalid",
        undefined,
        {
          resolveKeyById: vi.fn().mockResolvedValue({
            gatewayApiKey: {
              id: "key_configured",
              label: "Configured Key",
              valueHash: "hash",
              status: "active"
            },
            ownership: "configured"
          }),
          writeKeyRevocationState
        }
      )
    ).resolves.toEqual({
      keyId: "key_configured",
      revoked: false,
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    expect(writeKeyRevocationState).toHaveBeenCalledWith(
      {
        id: "key_configured",
        label: "Configured Key",
        valueHash: "hash",
        status: "active"
      },
      false,
      {
        keyId: "key_configured",
        ownership: "configured"
      }
    );
  });
});
