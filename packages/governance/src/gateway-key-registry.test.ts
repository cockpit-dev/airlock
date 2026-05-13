import { describe, expect, it } from "vitest";

import {
  createGatewayKeyRegistryDynamicKeyView,
  gatewayKeyAuditActorContextFromRegistryRequest,
  parseGatewayKeyRegistryCreateRequest,
  parseGatewayKeyRegistryDeleteRequest,
  parseGatewayKeyRegistryDeleteResponse,
  parseGatewayKeyRegistryDynamicKeyListResponse,
  parseGatewayKeyRegistryDynamicKeyResponse,
  parseGatewayKeyRegistryRecordResponse,
  parseGatewayKeyRegistryRotateRequest,
  parseGatewayKeyRegistryRotationActionRequest,
  parseGatewayKeyRegistryStoredDynamicKey,
  parseGatewayKeyRegistryStoredOverride,
  stripGatewayKeyAuditActorMetadata,
  toGatewayKeyAuditActorContextRecord
} from "./gateway-key-registry.js";

describe("parseGatewayKeyRegistryStoredOverride", () => {
  it("parses a stored override with updatedAt", () => {
    expect(
      parseGatewayKeyRegistryStoredOverride({
        label: "Rotated Key",
        status: "active",
        updatedAt: "2026-05-13T00:00:00.000Z"
      })
    ).toEqual({
      label: "Rotated Key",
      status: "active",
      updatedAt: "2026-05-13T00:00:00.000Z"
    });
  });
});

describe("parseGatewayKeyRegistryStoredDynamicKey", () => {
  it("parses a stored dynamic key with staged-rotation metadata", () => {
    expect(
      parseGatewayKeyRegistryStoredDynamicKey({
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        previousValueHash:
          "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        previousValueHashExpiresAt: "2026-05-14T00:00:00.000Z",
        status: "active",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T01:00:00.000Z"
      })
    ).toMatchObject({
      id: "key_dynamic",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHash:
        "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHashExpiresAt: "2026-05-14T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z"
    });
  });

  it("rejects malformed staged-rotation metadata", () => {
    expect(() =>
      parseGatewayKeyRegistryStoredDynamicKey({
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        previousValueHash: "bad-hash",
        status: "active",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T01:00:00.000Z"
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryStoredDynamicKey({
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        status: "active",
        createdAt: "not-a-date",
        updatedAt: "2026-05-13T01:00:00.000Z"
      })
    ).toThrow();
  });
});

describe("createGatewayKeyRegistryDynamicKeyView", () => {
  it("projects a stored dynamic key into a runtime view", () => {
    const storedKey = parseGatewayKeyRegistryStoredDynamicKey({
      id: "key_dynamic",
      label: "Dynamic Key",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      status: "active",
      notBefore: "2026-05-13T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z"
    });

    expect(createGatewayKeyRegistryDynamicKeyView(storedKey)).toEqual({
      keyId: "key_dynamic",
      ownership: "registry",
      key: {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        status: "active",
        notBefore: "2026-05-13T00:00:00.000Z"
      },
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z"
    });
  });
});

describe("registry response parsers", () => {
  it("parses record, dynamic-key, list, and delete responses", () => {
    expect(
      parseGatewayKeyRegistryRecordResponse({
        keyId: "key_dynamic",
        override: {
          label: "Dynamic Key",
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      })
    ).toEqual({
      keyId: "key_dynamic",
      override: {
        label: "Dynamic Key",
        updatedAt: "2026-05-13T00:00:00.000Z"
      }
    });

    expect(
      parseGatewayKeyRegistryDynamicKeyResponse({
        key: {
          keyId: "key_dynamic",
          ownership: "registry",
          key: {
            id: "key_dynamic",
            label: "Dynamic Key",
            valueHash:
              "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            status: "active"
          },
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T01:00:00.000Z"
        }
      })
    ).toMatchObject({
      keyId: "key_dynamic",
      ownership: "registry"
    });

    expect(
      parseGatewayKeyRegistryDynamicKeyListResponse({
        keys: [
          {
            keyId: "key_dynamic",
            ownership: "registry",
            key: {
              id: "key_dynamic",
              label: "Dynamic Key",
              valueHash:
                "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            },
            createdAt: "2026-05-13T00:00:00.000Z",
            updatedAt: "2026-05-13T01:00:00.000Z"
          }
        ]
      })
    ).toHaveLength(1);

    expect(
      parseGatewayKeyRegistryDeleteResponse({
        keyId: "key_dynamic",
        deleted: true
      })
    ).toEqual({
      keyId: "key_dynamic",
      deleted: true
    });
  });

  it("returns null for an empty dynamic-key response", () => {
    expect(
      parseGatewayKeyRegistryDynamicKeyResponse({
        key: null
      })
    ).toBeNull();
  });
});

describe("registry payload parsers", () => {
  it("parses create payloads and strips actor metadata from key material", () => {
    expect(
      parseGatewayKeyRegistryCreateRequest(
        {
          id: "key_dynamic",
          label: "Dynamic Key",
          valueHash:
            "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active",
          actor: "ops@example.com",
          actorSource: "payload"
        },
        []
      )
    ).toEqual({
      key: {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        status: "active"
      },
      actorContext: {
        actor: "ops@example.com",
        actorSource: "payload"
      }
    });
  });

  it("parses rotate, delete, and rotation-action payloads", () => {
    expect(
      parseGatewayKeyRegistryRotateRequest({
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        overlapSeconds: 120,
        reason: "scheduled rollover",
        actor: "ops@example.com",
        actorSource: "credential"
      })
    ).toEqual({
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      overlapSeconds: 120,
      reason: "scheduled rollover",
      actor: "ops@example.com",
      actorSource: "credential"
    });

    expect(
      parseGatewayKeyRegistryDeleteRequest({
        reason: "cleanup",
        actor: "ops@example.com"
      })
    ).toEqual({
      reason: "cleanup",
      actor: "ops@example.com",
      actorSource: "payload"
    });

    expect(
      parseGatewayKeyRegistryRotationActionRequest(
        {
          reason: "finalized",
          actor: "ops@example.com",
          actorSource: "trusted_header"
        },
        "rotation action payload is invalid"
      )
    ).toEqual({
      reason: "finalized",
      actor: "ops@example.com",
      actorSource: "trusted_header"
    });
  });

  it("rejects invalid overlapSeconds and actorSource values", () => {
    expect(() =>
      parseGatewayKeyRegistryRotateRequest({
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        overlapSeconds: 3601
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryRotationActionRequest(
        {
          actor: "ops@example.com",
          actorSource: "spoofed"
        },
        "rotation action payload is invalid"
      )
    ).toThrow();
  });
});

describe("registry actor metadata helpers", () => {
  it("normalizes, rehydrates, and strips actor metadata", () => {
    expect(
      toGatewayKeyAuditActorContextRecord({
        actor: "ops@example.com",
        actorSource: "credential"
      })
    ).toEqual({
      actor: "ops@example.com",
      actorSource: "credential"
    });

    expect(
      gatewayKeyAuditActorContextFromRegistryRequest({
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
      actor: "ops@example.com",
      actorSource: "trusted_header"
    });

    expect(
      stripGatewayKeyAuditActorMetadata({
        actor: "ops@example.com",
        actorSource: "payload",
        label: "Dynamic Key"
      })
    ).toEqual({
      label: "Dynamic Key"
    });
  });
});
