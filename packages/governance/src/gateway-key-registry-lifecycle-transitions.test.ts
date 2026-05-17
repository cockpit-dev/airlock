import { describe, expect, it } from "vitest";

import {
  buildArchiveGatewayRegistryKeyTransition,
  buildBulkArchiveGatewayRegistryKeyTransitions,
  buildBulkCancelGatewayRegistryKeyRotationTransitions,
  buildBulkFinalizeGatewayRegistryKeyRotationTransitions,
  buildBulkRestoreGatewayRegistryKeyTransitions,
  buildCancelGatewayRegistryKeyRotationTransition,
  buildFinalizeGatewayRegistryKeyRotationTransition,
  buildRestoreGatewayRegistryKeyTransition
} from "./gateway-key-registry-lifecycle-transitions.js";
import { createStoredGatewayRegistryDynamicKey } from "./gateway-key-registry.js";

const currentHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";
const previousHash =
  "2e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createStoredKey(
  id = "key_dynamic",
  overrides: Record<string, unknown> = {}
) {
  return createStoredGatewayRegistryDynamicKey(
    {
      id,
      label: id === "key_dynamic" ? "Dynamic Key" : `Key ${id}`,
      valueHash: currentHash,
      status: "active",
      ...(overrides.key && typeof overrides.key === "object"
        ? overrides.key
        : {})
    },
    "2026-05-14T00:00:00.000Z"
  );
}

describe("buildArchiveGatewayRegistryKeyTransition", () => {
  it("stamps archivedAt and emits an archived audit event", () => {
    const { nextKey, auditEvent } = buildArchiveGatewayRegistryKeyTransition(
      createStoredKey(),
      {
        reason: "tenant paused",
        actor: "ops@example.com",
        actorSource: "payload"
      },
      "2026-05-14T01:00:00.000Z"
    );

    expect(nextKey.archivedAt).toBe("2026-05-14T01:00:00.000Z");
    expect(nextKey.updatedAt).toBe("2026-05-14T01:00:00.000Z");
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "archived",
      ownership: "registry",
      occurredAt: "2026-05-14T01:00:00.000Z",
      reason: "tenant paused",
      actor: "ops@example.com",
      actorSource: "payload"
    });
    expect(auditEvent.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "archivedAt",
          before: null,
          after: "2026-05-14T01:00:00.000Z"
        })
      ])
    );
  });
});

describe("buildRestoreGatewayRegistryKeyTransition", () => {
  it("clears archivedAt and emits a restored audit event", () => {
    const existingKey = {
      ...createStoredKey(),
      archivedAt: "2026-05-14T01:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    };

    const { nextKey, auditEvent } = buildRestoreGatewayRegistryKeyTransition(
      existingKey,
      {
        reason: "tenant resumed"
      },
      "2026-05-14T02:00:00.000Z"
    );

    expect("archivedAt" in nextKey).toBe(false);
    expect(nextKey.updatedAt).toBe("2026-05-14T02:00:00.000Z");
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "restored",
      occurredAt: "2026-05-14T02:00:00.000Z",
      reason: "tenant resumed"
    });
    expect(auditEvent.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "archivedAt",
          before: "2026-05-14T01:00:00.000Z",
          after: null
        })
      ])
    );
  });
});

describe("buildFinalizeGatewayRegistryKeyRotationTransition", () => {
  it("clears staged rotation fields and emits a finalized audit event", () => {
    const existingKey = {
      ...createStoredKey(),
      previousValueHash: previousHash,
      previousValueHashExpiresAt: "2026-05-14T03:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    };

    const { nextKey, auditEvent } =
      buildFinalizeGatewayRegistryKeyRotationTransition(
        existingKey,
        {
          reason: "rollover completed"
        },
        "2026-05-14T02:00:00.000Z"
      );

    expect(nextKey.previousValueHash).toBeUndefined();
    expect(nextKey.previousValueHashExpiresAt).toBeUndefined();
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "rotation_finalized",
      occurredAt: "2026-05-14T02:00:00.000Z",
      reason: "rollover completed"
    });
    expect(auditEvent.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "previousValueHash",
          before: previousHash,
          after: null
        })
      ])
    );
  });
});

describe("buildCancelGatewayRegistryKeyRotationTransition", () => {
  it("rolls back valueHash, clears staged fields, and emits a canceled audit event", () => {
    const existingKey = {
      ...createStoredKey("key_dynamic", {
        key: {
          valueHash: currentHash
        }
      }),
      valueHash: currentHash,
      previousValueHash: previousHash,
      previousValueHashExpiresAt: "2026-05-14T03:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z"
    };

    const { nextKey, auditEvent } =
      buildCancelGatewayRegistryKeyRotationTransition(
        existingKey,
        {
          reason: "rollback"
        },
        "2026-05-14T02:00:00.000Z"
      );

    expect(nextKey.valueHash).toBe(previousHash);
    expect(nextKey.previousValueHash).toBeUndefined();
    expect(nextKey.previousValueHashExpiresAt).toBeUndefined();
    expect(auditEvent).toMatchObject({
      keyId: "key_dynamic",
      kind: "rotation_canceled",
      occurredAt: "2026-05-14T02:00:00.000Z",
      reason: "rollback"
    });
    expect(auditEvent.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "valueHash",
          before: currentHash,
          after: previousHash
        }),
        expect.objectContaining({
          field: "previousValueHash",
          before: previousHash,
          after: null
        })
      ])
    );
  });
});

describe("bulk lifecycle transition builders", () => {
  it("preserves request order and propagates shared audit metadata including operationId", () => {
    const keys = [
      createStoredKey("key_dynamic_a"),
      {
        ...createStoredKey("key_dynamic_b"),
        archivedAt: "2026-05-14T01:00:00.000Z",
        updatedAt: "2026-05-14T01:00:00.000Z"
      },
      {
        ...createStoredKey("key_dynamic_c"),
        previousValueHash: previousHash,
        previousValueHashExpiresAt: "2026-05-14T03:00:00.000Z",
        updatedAt: "2026-05-14T01:00:00.000Z"
      }
    ];
    const metadata = {
      operationId: "req_bulk_123",
      reason: "fleet mutation",
      actor: "ops@example.com",
      actorSource: "credential" as const
    };

    const archived = buildBulkArchiveGatewayRegistryKeyTransitions(
      [keys[0]!],
      metadata,
      "2026-05-14T02:00:00.000Z"
    );
    const restored = buildBulkRestoreGatewayRegistryKeyTransitions(
      [keys[1]!],
      metadata,
      "2026-05-14T02:00:00.000Z"
    );
    const finalized = buildBulkFinalizeGatewayRegistryKeyRotationTransitions(
      [keys[2]!],
      metadata,
      "2026-05-14T02:00:00.000Z"
    );
    const canceled = buildBulkCancelGatewayRegistryKeyRotationTransitions(
      [keys[2]!],
      metadata,
      "2026-05-14T02:00:00.000Z"
    );

    expect(archived[0]?.auditEvent.operationId).toBe("req_bulk_123");
    expect(restored[0]?.auditEvent.operationId).toBe("req_bulk_123");
    expect(finalized[0]?.auditEvent.operationId).toBe("req_bulk_123");
    expect(canceled[0]?.auditEvent.operationId).toBe("req_bulk_123");
    expect(archived[0]?.nextKey.id).toBe("key_dynamic_a");
    expect(restored[0]?.nextKey.id).toBe("key_dynamic_b");
    expect(finalized[0]?.nextKey.id).toBe("key_dynamic_c");
    expect(canceled[0]?.nextKey.id).toBe("key_dynamic_c");
  });
});
