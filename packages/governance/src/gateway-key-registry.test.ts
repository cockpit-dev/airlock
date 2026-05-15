import { describe, expect, it } from "vitest";

import type { GatewayKeyRegistryStoredDynamicKey } from "./gateway-key-registry.js";
import {
  createStoredGatewayRegistryDynamicKey,
  createStoredGatewayRegistryFieldDiffs,
  parseGatewayKeyRegistryBulkArchiveRequest,
  parseGatewayKeyRegistryBulkRotationActionRequest,
  createGatewayKeyRegistryDynamicKeyView,
  updateStoredGatewayRegistryDynamicKey,
  parseGatewayKeyRegistryBulkCreateResponse,
  parseGatewayKeyRegistryBulkCreateRequest,
  parseGatewayKeyRegistryBulkDeleteRequest,
  parseGatewayKeyRegistryBulkDeleteResponse,
  parseGatewayKeyRegistryBulkRestoreRequest,
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
  toGatewayKeyAuditActorContextRecord,
  doesDynamicKeyMatchValueHash,
  findDynamicKeyByValueHash
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

  it("parses archived stored dynamic keys", () => {
    expect(
      parseGatewayKeyRegistryStoredDynamicKey({
        id: "key_dynamic",
        label: "Archived Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        status: "active",
        archivedAt: "2026-05-14T00:00:00.000Z",
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z"
      })
    ).toMatchObject({
      id: "key_dynamic",
      archivedAt: "2026-05-14T00:00:00.000Z"
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

    expect(() =>
      parseGatewayKeyRegistryStoredDynamicKey({
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash:
          "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
        status: "active",
        archivedAt: "not-a-date",
        createdAt: "2026-05-13T00:00:00.000Z",
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

describe("stored registry key transitions", () => {
  it("creates a stored dynamic key with stamped timestamps", () => {
    expect(
      createStoredGatewayRegistryDynamicKey(
        {
          id: "key_dynamic",
          label: "Dynamic Key",
          valueHash:
            "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
          status: "active"
        },
        "2026-05-14T00:00:00.000Z"
      )
    ).toEqual({
      id: "key_dynamic",
      label: "Dynamic Key",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      status: "active",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });
  });

  it("updates a stored dynamic key while preserving prior staged metadata when the value hash is unchanged", () => {
    const existing = parseGatewayKeyRegistryStoredDynamicKey({
      id: "key_dynamic",
      label: "Dynamic Key",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHash:
        "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHashExpiresAt: "2026-05-15T00:00:00.000Z",
      status: "active",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z"
    });

    expect(
      updateStoredGatewayRegistryDynamicKey(
        existing,
        {
          ...existing,
          label: "Renamed Key"
        },
        [],
        undefined,
        "2026-05-14T00:00:00.000Z"
      )
    ).toMatchObject({
      label: "Renamed Key",
      previousValueHash:
        "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHashExpiresAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });
  });

  it("can clear staged rotation fields and archive markers during an update transition", () => {
    const existing = parseGatewayKeyRegistryStoredDynamicKey({
      id: "key_dynamic",
      label: "Archived Key",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHash:
        "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      previousValueHashExpiresAt: "2026-05-15T00:00:00.000Z",
      archivedAt: "2026-05-14T01:00:00.000Z",
      status: "active",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z"
    });

    const next = updateStoredGatewayRegistryDynamicKey(
      existing,
      {
        ...existing,
        valueHash:
          "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
      },
      [],
      {
        clearPreviousValueHash: true,
        clearArchivedAt: true
      },
      "2026-05-14T02:00:00.000Z"
    );

    expect(next.previousValueHash).toBeUndefined();
    expect(next.previousValueHashExpiresAt).toBeUndefined();
    expect(next.archivedAt).toBeUndefined();
    expect(next.updatedAt).toBe("2026-05-14T02:00:00.000Z");
  });

  it("projects stable field-level diffs from stored state transitions", () => {
    const before = parseGatewayKeyRegistryStoredDynamicKey({
      id: "key_dynamic",
      label: "Dynamic Key",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      status: "active",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z"
    });
    const after = parseGatewayKeyRegistryStoredDynamicKey({
      id: "key_dynamic",
      label: "Dynamic Key",
      valueHash:
        "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
      status: "active",
      archivedAt: "2026-05-14T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    expect(createStoredGatewayRegistryFieldDiffs(before, after)).toEqual([
      {
        field: "archivedAt",
        before: null,
        after: "2026-05-14T00:00:00.000Z"
      }
    ]);
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
        operationId: "req_bulk_update_123",
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
    ).toEqual({
      operationId: "req_bulk_update_123",
      keys: [
        expect.objectContaining({
          keyId: "key_dynamic",
          ownership: "registry"
        })
      ]
    });

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
        operationId: "req_bulk_delete_123",
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
      operationId: "req_bulk_delete_123",
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

    expect(
      parseGatewayKeyRegistryBulkCreateResponse({
        operationId: "req_bulk_create_123",
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
    ).toEqual({
      operationId: "req_bulk_create_123",
      keys: [
        expect.objectContaining({
          keyId: "key_dynamic",
          ownership: "registry"
        })
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
      auditMetadata: {
        actor: "ops@example.com",
        actorSource: "payload"
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
      auditMetadata: {
        actor: "ops@example.com",
        actorSource: "credential"
      },
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

    expect(
      parseGatewayKeyRegistryBulkArchiveRequest({
        keyIds: ["key_dynamic_a", " key_dynamic_b "],
        reason: "tenant paused",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      })
    ).toEqual({
      keyIds: ["key_dynamic_a", "key_dynamic_b"],
      auditMetadata: {
        reason: "tenant paused",
        actor: "ops@example.com",
        actorSource: "trusted_header"
      }
    });

    expect(
      parseGatewayKeyRegistryBulkRestoreRequest({
        keyIds: ["key_dynamic_a", "key_dynamic_b"],
        reason: "tenant resumed",
        actor: "ops@example.com"
      })
    ).toEqual({
      keyIds: ["key_dynamic_a", "key_dynamic_b"],
      auditMetadata: {
        reason: "tenant resumed",
        actor: "ops@example.com",
        actorSource: "payload"
      }
    });

    expect(
      parseGatewayKeyRegistryBulkRotationActionRequest(
        {
          keyIds: ["key_dynamic_a", " key_dynamic_b "],
          reason: "rollout converged",
          actor: "ops@example.com",
          actorSource: "credential"
        },
        "bulk rotation action payload is invalid"
      )
    ).toEqual({
      keyIds: ["key_dynamic_a", "key_dynamic_b"],
      auditMetadata: {
        reason: "rollout converged",
        actor: "ops@example.com",
        actorSource: "credential"
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
      parseGatewayKeyRegistryBulkArchiveRequest({
        keyIds: ["key_dynamic_a", "key_dynamic_a"]
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkRestoreRequest({
        keyIds: ["key_dynamic_a", "key_dynamic_a"]
      })
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkRotationActionRequest(
        {
          keyIds: ["key_dynamic_a", "key_dynamic_a"]
        },
        "bulk rotation action payload is invalid"
      )
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
      parseGatewayKeyRegistryBulkRotationActionRequest(
        {
          keyIds: [],
          actor: "ops@example.com"
        },
        "bulk rotation action payload is invalid"
      )
    ).toThrow();

    expect(() =>
      parseGatewayKeyRegistryBulkRotationActionRequest(
        {
          keyIds: ["key_dynamic_a"],
          actorSource: "payload"
        },
        "bulk rotation action payload is invalid"
      )
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

describe("doesDynamicKeyMatchValueHash", () => {
  const baseKey: GatewayKeyRegistryStoredDynamicKey = {
    id: "key-1",
    label: "Test Key",
    status: "active",
    valueHash: "hash-abc",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z"
  };

  it("matches current valueHash for active key", () => {
    expect(doesDynamicKeyMatchValueHash(baseKey, "hash-abc", Date.now())).toBe(true);
  });

  it("does not match different valueHash", () => {
    expect(doesDynamicKeyMatchValueHash(baseKey, "hash-other", Date.now())).toBe(false);
  });

  it("does not match archived key", () => {
    const archived = { ...baseKey, archivedAt: "2026-01-02T00:00:00Z" };
    expect(doesDynamicKeyMatchValueHash(archived, "hash-abc", Date.now())).toBe(false);
  });

  it("matches previousValueHash within overlap window", () => {
    const now = 100_000;
    const rotated = {
      ...baseKey,
      valueHash: "hash-new",
      previousValueHash: "hash-abc",
      previousValueHashExpiresAt: new Date(200_000).toISOString()
    };
    expect(doesDynamicKeyMatchValueHash(rotated, "hash-abc", now)).toBe(true);
  });

  it("does not match previousValueHash after overlap expires", () => {
    const now = 300_000;
    const rotated = {
      ...baseKey,
      valueHash: "hash-new",
      previousValueHash: "hash-abc",
      previousValueHashExpiresAt: new Date(200_000).toISOString()
    };
    expect(doesDynamicKeyMatchValueHash(rotated, "hash-abc", now)).toBe(false);
  });

  it("does not match previousValueHash without expiry", () => {
    const rotated = {
      ...baseKey,
      valueHash: "hash-new",
      previousValueHash: "hash-abc"
    };
    expect(doesDynamicKeyMatchValueHash(rotated, "hash-abc", Date.now())).toBe(false);
  });
});

describe("findDynamicKeyByValueHash", () => {
  const keys: GatewayKeyRegistryStoredDynamicKey[] = [
    {
      id: "key-1",
      label: "Active Key",
      status: "active",
      valueHash: "hash-a",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z"
    },
    {
      id: "key-2",
      label: "Archived Key",
      status: "active",
      valueHash: "hash-b",
      archivedAt: "2026-01-02T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z"
    },
    {
      id: "key-3",
      label: "Rotated Key",
      status: "active",
      valueHash: "hash-c-new",
      previousValueHash: "hash-c-old",
      previousValueHashExpiresAt: new Date(200_000).toISOString(),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z"
    }
  ];

  it("finds key by current valueHash", () => {
    const found = findDynamicKeyByValueHash(keys, "hash-a", Date.now());
    expect(found?.id).toBe("key-1");
  });

  it("skips archived key even if hash matches", () => {
    const found = findDynamicKeyByValueHash(keys, "hash-b", Date.now());
    expect(found).toBeUndefined();
  });

  it("finds key by previousValueHash within overlap", () => {
    const found = findDynamicKeyByValueHash(keys, "hash-c-old", 100_000);
    expect(found?.id).toBe("key-3");
  });

  it("returns undefined when no key matches", () => {
    const found = findDynamicKeyByValueHash(keys, "hash-nonexistent", Date.now());
    expect(found).toBeUndefined();
  });
});
