import { describe, expect, it } from "vitest";

import {
  buildBulkCreateGatewayRegistryKeyTransitions,
  buildBulkDeleteGatewayRegistryKeyAuditEvents,
  buildBulkRotateGatewayRegistryKeyTransitions,
  buildBulkUpdateGatewayRegistryKeyTransitions,
  buildCreateGatewayRegistryKeyTransition,
  buildDeleteGatewayRegistryKeyAuditEvent,
  buildRotateGatewayRegistryKeyTransition,
  buildUpdateGatewayRegistryKeyTransition
} from "./gateway-key-registry-write-transitions.js";
import {
  createStoredGatewayRegistryDynamicKey,
  type GatewayKeyRegistryStoredDynamicKey
} from "./gateway-key-registry.js";

const currentHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";
const nextHash =
  "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createStoredKey(
  id = "key_dynamic",
  overrides: Partial<GatewayKeyRegistryStoredDynamicKey> = {}
): GatewayKeyRegistryStoredDynamicKey {
  return {
    ...createStoredGatewayRegistryDynamicKey(
      {
        id,
        label: id === "key_dynamic" ? "Dynamic Key" : `Key ${id}`,
        valueHash: currentHash,
        status: "active"
      },
      "2026-05-14T00:00:00.000Z"
    ),
    ...overrides
  };
}

describe("buildCreateGatewayRegistryKeyTransition", () => {
  it("stamps timestamps and emits a created audit event", () => {
    const { nextKey, auditEvent } = buildCreateGatewayRegistryKeyTransition(
      {
        id: "key_dynamic",
        label: "Dynamic Key",
        valueHash: currentHash,
        status: "active"
      },
      {
        actor: "ops@example.com",
        actorSource: "payload"
      },
      "2026-05-14T01:00:00.000Z"
    );

    expect(nextKey.createdAt).toBe("2026-05-14T01:00:00.000Z");
    expect(nextKey.updatedAt).toBe("2026-05-14T01:00:00.000Z");
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "created",
      ownership: "registry",
      occurredAt: "2026-05-14T01:00:00.000Z",
      actor: "ops@example.com",
      actorSource: "payload"
    });
  });
});

describe("buildUpdateGatewayRegistryKeyTransition", () => {
  it("applies a metadata update and emits diff-backed updated audit event", () => {
    const previousKey = createStoredKey();
    const { nextKey, auditEvent } = buildUpdateGatewayRegistryKeyTransition(
      previousKey,
      {
        ...previousKey,
        label: "Dynamic Key (Paused)",
        status: "revoked"
      },
      {
        reason: "maintenance"
      },
      [previousKey],
      "2026-05-14T01:00:00.000Z"
    );

    expect(nextKey.label).toBe("Dynamic Key (Paused)");
    expect(nextKey.status).toBe("revoked");
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "updated",
      reason: "maintenance"
    });
    expect(auditEvent.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "label",
          before: "Dynamic Key",
          after: "Dynamic Key (Paused)"
        }),
        expect.objectContaining({
          field: "status",
          before: "active",
          after: "revoked"
        })
      ])
    );
  });
});

describe("buildDeleteGatewayRegistryKeyAuditEvent", () => {
  it("emits a deleted audit event with optional operation metadata", () => {
    const auditEvent = buildDeleteGatewayRegistryKeyAuditEvent(
      createStoredKey(),
      {
        operationId: "req_bulk_delete_123",
        reason: "offboarding"
      },
      "2026-05-14T01:00:00.000Z"
    );

    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "deleted",
      ownership: "registry",
      occurredAt: "2026-05-14T01:00:00.000Z",
      operationId: "req_bulk_delete_123",
      reason: "offboarding"
    });
  });
});

describe("buildRotateGatewayRegistryKeyTransition", () => {
  it("stages previous value hash when overlap is present and emits a rotated audit event", () => {
    const previousKey = createStoredKey();
    const { nextKey, auditEvent } = buildRotateGatewayRegistryKeyTransition(
      previousKey,
      {
        valueHash: nextHash,
        overlapSeconds: 120,
        reason: "rollover"
      },
      [previousKey],
      "2026-05-14T01:00:00.000Z"
    );

    expect(nextKey.valueHash).toBe(nextHash);
    expect(nextKey.previousValueHash).toBe(currentHash);
    expect(nextKey.previousValueHashExpiresAt).toBe("2026-05-14T01:02:00.000Z");
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "rotated",
      reason: "rollover"
    });
  });

  it("clears staged rotation fields when overlap is absent", () => {
    const previousKey = createStoredKey("key_dynamic", {
      previousValueHash: currentHash,
      previousValueHashExpiresAt: "2026-05-14T00:30:00.000Z",
      valueHash: nextHash
    });

    const { nextKey } = buildRotateGatewayRegistryKeyTransition(
      previousKey,
      {
        valueHash: currentHash
      },
      [previousKey],
      "2026-05-14T01:00:00.000Z"
    );

    expect(nextKey.previousValueHash).toBeUndefined();
    expect(nextKey.previousValueHashExpiresAt).toBeUndefined();
  });
});

describe("bulk write transition builders", () => {
  it("preserves request order and attaches operation metadata", () => {
    const keyA = createStoredKey("key_dynamic_a");
    const keyB = createStoredKey("key_dynamic_b", {
      valueHash:
        "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
    });
    const metadata = {
      operationId: "req_bulk_123",
      reason: "fleet mutation"
    };

    const createTransitions = buildBulkCreateGatewayRegistryKeyTransitions(
      [
        {
          id: "key_dynamic_a",
          label: "Key A",
          valueHash: currentHash,
          status: "active"
        },
        {
          id: "key_dynamic_b",
          label: "Key B",
          valueHash: nextHash,
          status: "revoked"
        }
      ],
      metadata,
      "2026-05-14T01:00:00.000Z"
    );
    const updateTransitions = buildBulkUpdateGatewayRegistryKeyTransitions(
      [
        {
          previousKey: keyA,
          nextKey: {
            ...keyA,
            label: "Key A+"
          }
        },
        {
          previousKey: keyB,
          nextKey: {
            ...keyB,
            status: "revoked"
          }
        }
      ],
      metadata,
      [keyA, keyB],
      "2026-05-14T01:00:00.000Z"
    );
    const rotateTransitions = buildBulkRotateGatewayRegistryKeyTransitions(
      [
        {
          previousKey: keyA,
          valueHash: nextHash,
          overlapSeconds: 60
        },
        {
          previousKey: keyB,
          valueHash:
            "3e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6"
        }
      ],
      metadata,
      [keyA, keyB],
      "2026-05-14T01:00:00.000Z"
    );
    const deleteEvents = buildBulkDeleteGatewayRegistryKeyAuditEvents(
      [keyA, keyB],
      metadata,
      "2026-05-14T01:00:00.000Z"
    );

    expect(createTransitions.map((entry) => entry.nextKey.id)).toEqual([
      "key_dynamic_a",
      "key_dynamic_b"
    ]);
    expect(updateTransitions.map((entry) => entry.nextKey.id)).toEqual([
      "key_dynamic_a",
      "key_dynamic_b"
    ]);
    expect(rotateTransitions.map((entry) => entry.nextKey.id)).toEqual([
      "key_dynamic_a",
      "key_dynamic_b"
    ]);
    expect(deleteEvents.map((entry) => entry.keyId)).toEqual([
      "key_dynamic_a",
      "key_dynamic_b"
    ]);
    expect(rotateTransitions[0]?.auditEvent.operationId).toBe("req_bulk_123");
    expect(deleteEvents[1]?.operationId).toBe("req_bulk_123");
  });
});
