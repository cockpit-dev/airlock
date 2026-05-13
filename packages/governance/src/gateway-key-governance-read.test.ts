import { describe, expect, it, vi } from "vitest";

import {
  createGatewayApiKeyRegistrySnapshot,
  deriveGatewayApiKeyStatusView
} from "./gateway-auth.js";
import {
  createGatewayAdminKeyRegistryView,
  getGatewayAdminKey,
  getGatewayAdminKeyEvents,
  getGatewayAdminKeyOperationEvents,
  getGatewayAdminKeyRegistryView,
  getGatewayAdminKeyRevocationStatus,
  getGatewayAdminKeyStatus,
  listGatewayAdminKeys,
  parseGatewayAdminKeyInventoryFilters
} from "./gateway-key-governance-read.js";

const gatewaySecretHash =
  "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6";

function createConfiguredSnapshot() {
  const configuredKey = {
    id: "key_1",
    label: "Configured Key",
    valueHash: gatewaySecretHash,
    status: "active" as const
  };
  const runtimeKey = {
    ...configuredKey,
    label: "Runtime Key",
    status: "revoked" as const,
    expiresAt: "2026-06-01T00:00:00.000Z"
  };
  const configuredStatus = deriveGatewayApiKeyStatusView(configuredKey, {
    revoked: false,
    updatedAt: "2026-05-13T00:00:00.000Z"
  });
  const runtimeStatus = deriveGatewayApiKeyStatusView(runtimeKey, {
    revoked: false,
    updatedAt: "2026-05-13T00:00:00.000Z"
  });

  return createGatewayApiKeyRegistrySnapshot({
    ownership: "configured",
    configuredKey,
    configuredStatus,
    runtimeKey,
    runtimeStatus,
    registryOverride: {
      label: "Runtime Key",
      status: "revoked",
      updatedAt: "2026-05-13T01:00:00.000Z"
    }
  });
}

describe("parseGatewayAdminKeyInventoryFilters", () => {
  it("normalizes acceptedNow and effectiveStatus filters", () => {
    expect(
      parseGatewayAdminKeyInventoryFilters(
        new URLSearchParams(
          "acceptedNow=true&effectiveStatus=archived&includeArchived=true"
        )
      )
    ).toEqual({
      acceptedNow: true,
      effectiveStatus: "archived",
      includeArchived: true
    });
  });

  it("ignores unsupported filter values", () => {
    expect(
      parseGatewayAdminKeyInventoryFilters(
        new URLSearchParams("acceptedNow=maybe&effectiveStatus=unknown")
      )
    ).toEqual({});
  });
});

describe("listGatewayAdminKeys", () => {
  it("passes normalized filters to the read port and returns key snapshots", async () => {
    const snapshot = createConfiguredSnapshot();
    const listKeySnapshots = vi.fn().mockResolvedValue([snapshot]);

    await expect(
      listGatewayAdminKeys(
        new URLSearchParams("acceptedNow=false"),
        {
          listKeySnapshots
        }
      )
    ).resolves.toEqual({
      keys: [snapshot]
    });

    expect(listKeySnapshots).toHaveBeenCalledWith({
      acceptedNow: false
    });
  });
});

describe("getGatewayAdminKey", () => {
  it("throws a not-found governance error when the key is absent", async () => {
    await expect(
      getGatewayAdminKey(
        "missing-key",
        "req_123",
        {
          getRegistryKey: vi.fn().mockResolvedValue(null)
        }
      )
    ).rejects.toMatchObject({
      code: "gateway_key_not_found"
    });
  });
});

describe("getGatewayAdminKeyRevocationStatus", () => {
  it("delegates to the read port", async () => {
    const getKeyRevocationStatus = vi.fn().mockResolvedValue({
      keyId: "key_1",
      revoked: true,
      updatedAt: "2026-05-13T00:00:00.000Z"
    });

    await expect(
      getGatewayAdminKeyRevocationStatus("key_1", {
        getKeyRevocationStatus
      })
    ).resolves.toEqual({
      keyId: "key_1",
      revoked: true,
      updatedAt: "2026-05-13T00:00:00.000Z"
    });
  });
});

describe("getGatewayAdminKeyStatus", () => {
  it("delegates to the read port", async () => {
    const snapshot = createConfiguredSnapshot();
    const getKeyStatusSnapshot = vi.fn().mockResolvedValue(snapshot);

    await expect(
      getGatewayAdminKeyStatus("key_1", {
        getKeyStatusSnapshot
      })
    ).resolves.toEqual(snapshot);
  });
});

describe("getGatewayAdminKeyEvents", () => {
  it("merges and sorts registry and revocation events newest-first", async () => {
    const assertKeyExists = vi.fn().mockResolvedValue(undefined);

    await expect(
      getGatewayAdminKeyEvents("key_1", {
        getRegistryEvents: vi.fn().mockResolvedValue([
          {
            keyId: "key_1",
            kind: "created",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:00.000Z"
          }
        ]),
        getRevocationEvents: vi.fn().mockResolvedValue([
          {
            keyId: "key_1",
            kind: "revoked",
            ownership: "registry",
            occurredAt: "2026-05-14T00:00:00.000Z"
          }
        ]),
        assertKeyExists
      })
    ).resolves.toEqual({
      keyId: "key_1",
      events: [
        {
          keyId: "key_1",
          kind: "revoked",
          ownership: "registry",
          occurredAt: "2026-05-14T00:00:00.000Z"
        },
        {
          keyId: "key_1",
          kind: "created",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:00.000Z"
        }
      ]
    });

    expect(assertKeyExists).not.toHaveBeenCalled();
  });

  it("verifies key existence when no audit events are present", async () => {
    const assertKeyExists = vi.fn().mockResolvedValue(undefined);

    await expect(
      getGatewayAdminKeyEvents("key_1", {
        getRegistryEvents: vi.fn().mockResolvedValue([]),
        getRevocationEvents: vi.fn().mockResolvedValue([]),
        assertKeyExists
      })
    ).resolves.toEqual({
      keyId: "key_1",
      events: []
    });

    expect(assertKeyExists).toHaveBeenCalledWith("key_1");
  });
});

describe("getGatewayAdminKeyOperationEvents", () => {
  it("returns operation-correlated events newest-first", async () => {
    await expect(
      getGatewayAdminKeyOperationEvents("req_bulk_123", "req_read_123", {
        getOperationEvents: vi.fn().mockResolvedValue([
          {
            keyId: "key_1",
            kind: "updated",
            ownership: "registry",
            occurredAt: "2026-05-13T00:00:00.000Z",
            operationId: "req_bulk_123",
            actor: "ops@example.com",
            actorSource: "credential"
          },
          {
            keyId: "key_2",
            kind: "updated",
            ownership: "registry",
            occurredAt: "2026-05-14T00:00:00.000Z",
            operationId: "req_bulk_123",
            actor: "ops@example.com",
            actorSource: "credential"
          }
        ])
      })
    ).resolves.toEqual({
      operationId: "req_bulk_123",
      summary: {
        operationId: "req_bulk_123",
        keyIds: ["key_1", "key_2"],
        keyCount: 2,
        eventCount: 2,
        eventKinds: ["updated"],
        ownerships: ["registry"],
        firstOccurredAt: "2026-05-13T00:00:00.000Z",
        lastOccurredAt: "2026-05-14T00:00:00.000Z",
        actor: "ops@example.com",
        actorSource: "credential"
      },
      events: [
        {
          keyId: "key_2",
          kind: "updated",
          ownership: "registry",
          occurredAt: "2026-05-14T00:00:00.000Z",
          operationId: "req_bulk_123",
          actor: "ops@example.com",
          actorSource: "credential"
        },
        {
          keyId: "key_1",
          kind: "updated",
          ownership: "registry",
          occurredAt: "2026-05-13T00:00:00.000Z",
          operationId: "req_bulk_123",
          actor: "ops@example.com",
          actorSource: "credential"
        }
      ]
    });
  });

  it("rejects operation reads when the port returns no events", async () => {
    await expect(
      getGatewayAdminKeyOperationEvents("req_bulk_missing", "req_read_404", {
        getOperationEvents: vi.fn().mockResolvedValue([])
      })
    ).rejects.toMatchObject({
      code: "gateway_key_not_found"
    });
  });
});

describe("createGatewayAdminKeyRegistryView", () => {
  it("projects a status snapshot into the registry-view response shape", () => {
    expect(createGatewayAdminKeyRegistryView(createConfiguredSnapshot())).toEqual({
      keyId: "key_1",
      configured: {
        keyId: "key_1",
        label: "Configured Key",
        configuredStatus: "active",
        lifecycleStatus: "active",
        overlayRevoked: false,
        overlayUpdatedAt: "2026-05-13T00:00:00.000Z",
        effectiveStatus: "active",
        acceptedNow: true
      },
      runtime: {
        keyId: "key_1",
        label: "Runtime Key",
        configuredStatus: "revoked",
        expiresAt: "2026-06-01T00:00:00.000Z",
        lifecycleStatus: "revoked",
        overlayRevoked: false,
        overlayUpdatedAt: "2026-05-13T00:00:00.000Z",
        effectiveStatus: "revoked",
        acceptedNow: false
      },
      override: {
        label: "Runtime Key",
        status: "revoked",
        updatedAt: "2026-05-13T01:00:00.000Z"
      },
      registryOverrideApplied: true,
      registryUpdatedAt: "2026-05-13T01:00:00.000Z"
    });
  });
});

describe("getGatewayAdminKeyRegistryView", () => {
  it("builds the registry-view response from a configured-key snapshot", async () => {
    const snapshot = createConfiguredSnapshot();
    const getConfiguredKeyStatusSnapshot = vi.fn().mockResolvedValue(snapshot);

    await expect(
      getGatewayAdminKeyRegistryView("key_1", {
        getConfiguredKeyStatusSnapshot
      })
    ).resolves.toEqual(createGatewayAdminKeyRegistryView(snapshot));
  });
});
