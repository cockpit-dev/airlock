import { describe, expect, it } from "vitest";

import {
  createGatewayKeyRegistryDynamicKeyView,
  parseGatewayKeyRegistryBulkCreateRequest,
  parseGatewayKeyRegistryBulkDeleteRequest,
  parseGatewayKeyRegistryBulkDeleteResponse,
  parseGatewayKeyRegistryBulkRotateRequest,
  gatewayKeyAuditActorContextFromRegistryRequest,
  parseGatewayKeyRegistryCreateRequest,
  parseGatewayKeyRegistryDeleteRequest,
  parseGatewayKeyRegistryDeleteResponse,
  parseGatewayKeyRegistryDynamicKeyListResponse,
  parseGatewayKeyRegistryDynamicKeyResponse,
  parseGatewayKeyRegistryRecordResponse,
  parseGatewayKeyRegistryRotateRequest,
  parseGatewayKeyRegistryRotationActionRequest,
  parseGatewayKeyRegistryBulkUpdateRequest,
  parseGatewayKeyRegistryUpdateRequest,
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

    expect(
      parseGatewayKeyRegistryBulkDeleteResponse({
        keys: [
          {
            keyId: "key_dynamic_a",
            deleted: true
          },
          {
            keyId: "key_dynamic_b",
            deleted: true
          }
        ]
      })
    ).toEqual({
      keys: [
        {
          keyId: "key_dynamic_a",
          deleted: true
        },
        {
          keyId: "key_dynamic_b",
          deleted: true
        }
      ]
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

    expect(
      parseGatewayKeyRegistryUpdateRequest({
        label: "Renamed Runtime Key",
        status: "revoked",
        notBefore: null,
        expiresAt: "2026-05-15T00:00:00.000Z",
        policy: null,
        reason: "temporary hold",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
      update: {
        label: "Renamed Runtime Key",
        status: "revoked",
        notBefore: null,
        expiresAt: "2026-05-15T00:00:00.000Z",
        policy: null
      },
      auditMetadata: {
        reason: "temporary hold",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });

    expect(
      parseGatewayKeyRegistryBulkUpdateRequest({
        updates: [
          {
            keyId: "key_dynamic_a",
            status: "revoked"
          },
          {
            keyId: "key_dynamic_b",
            label: "Tenant B Key",
            policy: {
              tier: "pro"
            }
          }
        ],
        reason: "maintenance window",
        actor: "ops@example.com",
        actorSource: "credential"
      })
    ).toEqual({
      updates: [
        {
          keyId: "key_dynamic_a",
          update: {
            status: "revoked"
          }
        },
        {
          keyId: "key_dynamic_b",
          update: {
            label: "Tenant B Key",
            policy: {
              tier: "pro"
            }
          }
        }
      ],
      auditMetadata: {
        reason: "maintenance window",
        actor: "ops@example.com",
        actorSource: "credential"
      }
    });

    expect(
      parseGatewayKeyRegistryBulkDeleteRequest({
        keyIds: ["key_dynamic_a", " key_dynamic_b "],
        reason: "tenant offboarding",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
      keyIds: ["key_dynamic_a", "key_dynamic_b"],
      auditMetadata: {
        reason: "tenant offboarding",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });

    expect(
      parseGatewayKeyRegistryBulkCreateRequest(
        {
          keys: [
            {
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            },
            {
              id: "key_dynamic_b",
              label: "Dynamic Key B",
              valueHash:
                "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "revoked"
            }
          ],
          actor: "ops@example.com",
          actorSource: "credential"
        },
        []
      )
    ).toEqual({
      keys: [
        {
          id: "key_dynamic_a",
          label: "Dynamic Key A",
          valueHash:
            "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active"
        },
        {
          id: "key_dynamic_b",
          label: "Dynamic Key B",
          valueHash:
            "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "revoked"
        }
      ],
      actorContext: {
        actor: "ops@example.com",
        actorSource: "credential"
      }
    });

    expect(
      parseGatewayKeyRegistryBulkRotateRequest({
        rotations: [
          {
            keyId: "key_dynamic_a",
            valueHash:
              "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            overlapSeconds: 60
          },
          {
            keyId: "key_dynamic_b",
            valueHash:
              "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
          }
        ],
        reason: "credential rollover",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
      rotations: [
        {
          keyId: "key_dynamic_a",
          valueHash:
            "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          overlapSeconds: 60
        },
        {
          keyId: "key_dynamic_b",
          valueHash:
            "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
        }
      ],
      auditMetadata: {
        reason: "credential rollover",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
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

    expect(() =>
      parseGatewayKeyRegistryUpdateRequest({
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryUpdateRequest({
        actorSource: "payload"
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkUpdateRequest({
        updates: []
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkDeleteRequest({
        keyIds: []
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkDeleteRequest({
        keyIds: ["key_dynamic_a", "key_dynamic_a"]
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkDeleteRequest({
        keyIds: ["key_dynamic_a"],
        actorSource: "payload"
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkCreateRequest(
        {
          keys: []
        },
        []
      )
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkCreateRequest(
        {
          keys: [
            {
              id: "key_dynamic_a",
              label: "Dynamic Key A",
              valueHash:
                "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            },
            {
              id: "key_dynamic_a",
              label: "Dynamic Key B",
              valueHash:
                "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
              status: "active"
            }
          ]
        },
        []
      )
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkRotateRequest({
        rotations: []
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkRotateRequest({
        rotations: [
          {
            keyId: "key_dynamic_a",
            valueHash:
              "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
          },
          {
            keyId: "key_dynamic_a",
            valueHash:
              "4e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
          }
        ]
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkRotateRequest({
        rotations: [
          {
            keyId: "key_dynamic_a",
            valueHash:
              "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
          }
        ],
        actorSource: "payload"
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkUpdateRequest({
        updates: [
          { keyId: "key_dynamic_a", status: "revoked" },
          { keyId: "key_dynamic_a", label: "Duplicate" }
        ]
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkUpdateRequest({
        updates: [
          {
            keyId: "key_dynamic_a",
            valueHash:
              "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
          }
        ]
      })
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
