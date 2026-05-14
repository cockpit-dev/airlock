import {
  assertGatewayApiKeyRuntimeDependencies,
  applyGatewayApiKeyMetadataOverride,
  archiveGatewayRegistryKey as archiveGatewayRegistryKeyUseCase,
  bulkCreateGatewayRegistryKeys as bulkCreateGatewayRegistryKeysUseCase,
  bulkDeleteGatewayRegistryKeys as bulkDeleteGatewayRegistryKeysUseCase,
  bulkArchiveGatewayRegistryKeys as bulkArchiveGatewayRegistryKeysUseCase,
  bulkCancelGatewayRegistryKeyRotations as bulkCancelGatewayRegistryKeyRotationsUseCase,
  bulkFinalizeGatewayRegistryKeyRotations as bulkFinalizeGatewayRegistryKeyRotationsUseCase,
  bulkRestoreGatewayRegistryKeys as bulkRestoreGatewayRegistryKeysUseCase,
  bulkRotateGatewayRegistryKeys as bulkRotateGatewayRegistryKeysUseCase,
  bulkUpdateGatewayRegistryKeys as bulkUpdateGatewayRegistryKeysUseCase,
  cancelGatewayRegistryKeyRotation as cancelGatewayRegistryKeyRotationUseCase,
  createGatewayRegistryKey as createGatewayRegistryKeyUseCase,
  createStoredGatewayRegistryDynamicKey,
  createStoredGatewayRegistryFieldDiffs,
  createGatewayKeyRegistryDynamicKeyView,
  createGatewayKeyAuditEvent,
  deleteGatewayRegistryKey as deleteGatewayRegistryKeyUseCase,
  finalizeGatewayRegistryKeyRotation as finalizeGatewayRegistryKeyRotationUseCase,
  isConfiguredGatewayApiKeyId,
  gatewayKeyAuditActorContextFromRegistryRequest,
  parseGatewayKeyRegistryBulkCreateRequest,
  parseGatewayKeyRegistryBulkArchiveRequest,
  parseGatewayKeyRegistryBulkRotationActionRequest,
  parseGatewayKeyRegistryBulkCreateResponse,
  parseGatewayKeyRegistryBulkDeleteRequest,
  parseGatewayKeyRegistryBulkDeleteResponse,
  parseGatewayKeyOperationEventsResponse,
  parseGatewayKeyRegistryBulkRotateRequest,
  parseGatewayKeyRegistryBulkRestoreRequest,
  parseGatewayKeyRegistryCreateRequest,
  parseGatewayKeyRegistryBulkUpdateRequest,
  parseGatewayKeyRegistryDeleteRequest,
  parseGatewayKeyRegistryDeleteResponse,
  parseGatewayKeyRegistryDynamicKeyListResponse,
  parseGatewayKeyRegistryDynamicKeyResponse,
  parseGatewayKeyRegistryLifecycleActionRequest,
  parseGatewayKeyRegistryRecordResponse,
  parseGatewayKeyRegistryRotateRequest,
  parseGatewayKeyRegistryRotationActionRequest,
  parseGatewayKeyRegistryUpdateRequest,
  parseGatewayKeyRegistryStoredDynamicKey,
  restoreGatewayRegistryKey as restoreGatewayRegistryKeyUseCase,
  toGatewayKeyAuditActorContextRecord,
  rotateGatewayRegistryKey as rotateGatewayRegistryKeyUseCase,
  updateStoredGatewayRegistryDynamicKey,
  updateGatewayRegistryKey as updateGatewayRegistryKeyUseCase,
  validateGatewayRegistryRotatedKeyCandidate,
  MAX_GATEWAY_KEY_AUDIT_EVENTS,
  parseGatewayKeyAuditEventsResponse,
  parseGatewayApiKeyMetadataOverride,
  parseGatewayDynamicApiKeyRecord,
  resolveConfiguredGatewayApiKeyRuntime,
  type GatewayApiKeyMetadataOverride,
  type GatewayKeyAuditActorContext,
  type GatewayKeyAuditEvent,
  type GatewayKeyAuditEventsResponse,
  type GatewayApiKeyRecord,
  type GatewayKeyRegistryBulkCreateResponse,
  type GatewayKeyRegistryBulkDeleteResponse,
  type GatewayKeyOperationEventsResponse,
  type GatewayKeyRegistryCreateRequest,
  type GatewayKeyRegistryDeleteRequest,
  type GatewayKeyRegistryDeleteResponse,
  type GatewayKeyRegistryDynamicKeyListResponse,
  type GatewayKeyRegistryDynamicKeyResponse,
  type GatewayKeyRegistryDynamicKeyView,
  type GatewayKeyRegistryRecordResponse,
  type GatewayKeyRegistryRotateRequest,
  type GatewayKeyRegistryRotationActionRequest,
  type GatewayKeyRegistryStoredDynamicKey,
  type GatewayKeyRegistryStoredOverride,
  type GatewayKeyRegistryStoredDynamicKeyUpdateOptions
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import { clearGatewayKeyRevocationOverlayState } from "./gateway-key-revocation.js";

const REGISTRY_OBJECT_NAME = "gateway-key-registry";
const REGISTRY_KIND_OVERRIDE = "override";
const REGISTRY_KIND_DYNAMIC = "dynamic";
const REGISTRY_KIND_DYNAMIC_LIST = "dynamic_list";
const REGISTRY_KIND_DYNAMIC_LOOKUP = "dynamic_lookup";
const REGISTRY_KIND_DYNAMIC_BULK_CREATE = "dynamic_bulk_create";
const REGISTRY_KIND_DYNAMIC_BULK_UPDATE = "dynamic_bulk_update";
const REGISTRY_KIND_DYNAMIC_BULK_DELETE = "dynamic_bulk_delete";
const REGISTRY_KIND_DYNAMIC_BULK_ROTATE = "dynamic_bulk_rotate";
const REGISTRY_KIND_DYNAMIC_BULK_ROTATE_CANCEL = "dynamic_bulk_rotate_cancel";
const REGISTRY_KIND_DYNAMIC_BULK_ROTATE_FINALIZE = "dynamic_bulk_rotate_finalize";
const REGISTRY_KIND_DYNAMIC_BULK_ARCHIVE = "dynamic_bulk_archive";
const REGISTRY_KIND_DYNAMIC_BULK_RESTORE = "dynamic_bulk_restore";
const REGISTRY_KIND_DYNAMIC_ROTATE = "dynamic_rotate";
const REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE = "dynamic_rotate_finalize";
const REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL = "dynamic_rotate_cancel";
const REGISTRY_KIND_DYNAMIC_ARCHIVE = "dynamic_archive";
const REGISTRY_KIND_DYNAMIC_RESTORE = "dynamic_restore";
const REGISTRY_KIND_EVENTS = "events";
const REGISTRY_KIND_OPERATION_EVENTS = "operation_events";
const DYNAMIC_KEY_INDEX = "dynamic:index";
const DYNAMIC_KEY_AUDIT_EVENTS_PREFIX = "dynamic_events:";
const DYNAMIC_KEY_OPERATION_INDEX_PREFIX = "dynamic_operation:";

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean | void>;
  };
}

interface GatewayKeyRegistryLookupRequest {
  bearerToken: string;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      return typeof entry === "string" && entry.trim().length > 0;
    })
  );
}

function createGatewayKeyRegistryUnavailableError(
  requestId: string,
  cause?: unknown
): GatewayError {
  return new GatewayError("Gateway key registry subsystem is unavailable", {
    code: "gateway_key_registry_unavailable",
    category: "governance",
    httpStatus: 503,
    retryable: true,
    requestId,
    ...(cause ? { cause } : {})
  });
}

function createGatewayKeyRegistryInvalidResponseError(
  requestId: string,
  cause?: unknown
): GatewayError {
  return new GatewayError(
    "Gateway key registry subsystem returned an invalid response",
    {
      code: "gateway_key_registry_invalid_response",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      ...(cause ? { cause } : {})
    }
  );
}

function createGatewayKeyNotFoundError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key not found", {
    code: "gateway_key_not_found",
    category: "governance",
    httpStatus: 404,
    retryable: false,
    requestId
  });
}

function createGatewayKeyRotationNotStagedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key does not have an active staged rotation", {
    code: "gateway_key_rotation_not_staged",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

function createGatewayKeyRotationNotCancelableError(
  requestId: string
): GatewayError {
  return new GatewayError("Gateway API key staged rotation can no longer be canceled", {
    code: "gateway_key_rotation_not_cancelable",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

function createGatewayKeyAlreadyArchivedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is already archived", {
    code: "gateway_key_already_archived",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}

function createGatewayKeyNotArchivedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is not archived", {
    code: "gateway_key_not_archived",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
}


function buildRegistryRequest(
  requestId: string,
  kind: string,
  init: RequestInit & {
    keyId?: string;
  }
): Request {
  const url = new URL("https://airlock.internal/gateway-key-registry");
  url.searchParams.set("kind", kind);

  if (init.keyId) {
    url.searchParams.set("keyId", init.keyId);
  }

  return new Request(url, {
    ...init,
    headers: {
      "x-airlock-request-id": requestId,
      ...(init.headers ?? {})
    }
  });
}

function requireGatewayKeyRegistryNamespace(
  env: GatewayBindings,
  requestId: string
) {
  const namespace = env.AIRLOCK_GATEWAY_KEY_REGISTRY;

  if (!namespace) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  return namespace;
}

function requireDynamicGatewayKeyRegistryNamespace(
  env: GatewayBindings,
  requestId: string
) {
  if (!isGatewayKeyRegistryEnabled(env)) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  return requireGatewayKeyRegistryNamespace(env, requestId);
}

function assertGatewayKeyRuntimeDependencies(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
) {
  assertGatewayApiKeyRuntimeDependencies(
    gatewayApiKey,
    {
      gatewayKeyQuota: env.AIRLOCK_GATEWAY_KEY_QUOTA !== undefined,
      gatewayKeyTokenQuota: env.AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA !== undefined,
      gatewayKeyConcurrency: env.AIRLOCK_GATEWAY_KEY_CONCURRENCY !== undefined
    },
    requestId
  );
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
}

async function toDynamicUniquenessComparableGatewayApiKeys(
  gatewayApiKeys: readonly GatewayApiKeyRecord[]
): Promise<GatewayApiKeyRecord[]> {
  return Promise.all(
    gatewayApiKeys.map(async (entry) => {
      if (entry.valueHash) {
        return entry;
      }

      if (!entry.value) {
        return entry;
      }

      const rest = { ...entry };
      delete rest.value;

      return {
        ...rest,
        valueHash: await sha256Hex(entry.value)
      };
    })
  );
}

export class GatewayKeyRegistryDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? REGISTRY_KIND_OVERRIDE;
    const keyId = url.searchParams.get("keyId");
    const operationId = request.headers.get("x-airlock-request-id") ?? undefined;

    if (kind === REGISTRY_KIND_DYNAMIC_LIST) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      return Response.json({
        keys: (await listStoredDynamicKeys(this.state.storage)).map((key) => {
          return createGatewayKeyRegistryDynamicKeyView(key);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_LOOKUP) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const body = (await request.json()) as GatewayKeyRegistryLookupRequest;

      if (typeof body.bearerToken !== "string" || body.bearerToken.length === 0) {
        return new Response("Invalid bearerToken", { status: 400 });
      }

      const bearerTokenHash = await sha256Hex(body.bearerToken);
      const key = await findStoredDynamicKeyByValueHash(
        this.state.storage,
        bearerTokenHash
      );

      return Response.json({
        key: key ? createGatewayKeyRegistryDynamicKeyView(key) : null
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_EVENTS) {
      if (request.method !== "GET" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      return Response.json({
        keyId,
        events: await readStoredDynamicKeyAuditEvents(this.state.storage, keyId)
      } satisfies GatewayKeyAuditEventsResponse);
    }

    if (kind === REGISTRY_KIND_OPERATION_EVENTS) {
      const operationId = url.searchParams.get("operationId");

      if (request.method !== "GET" || !operationId) {
        return new Response("Method not allowed", { status: operationId ? 405 : 400 });
      }

      const events = await readStoredDynamicKeyOperationEvents(
        this.state.storage,
        operationId
      );

      if (events.length === 0) {
        return new Response("Not found", { status: 404 });
      }

      return Response.json({
        operationId,
        events
      } satisfies GatewayKeyOperationEventsResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_UPDATE) {
      if (request.method !== "PATCH") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkUpdateRequest(
        await request.json()
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );
      const nextKeys = bulkRequest.updates.map((entry) => {
        const existingKey = existingKeysById.get(entry.keyId);

        if (!existingKey) {
          return null;
        }

        return {
          existingKey,
          nextKey: applyGatewayApiKeyMetadataOverride(existingKey, entry.update)
        };
      });

      if (nextKeys.some((entry) => entry === null)) {
        return new Response("Not found", { status: 404 });
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const updatedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const entry of nextKeys) {
        if (!entry) {
          continue;
        }

        updatedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            entry.nextKey,
            dynamicKeys
          )
        );
      }

      for (const key of updatedKeys) {
        const previousKey = existingKeysById.get(key.id);

        if (!previousKey) {
          continue;
        }

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "updated",
            ownership: "registry",
            occurredAt: key.updatedAt,
            ...(operationId ? { operationId } : {}),
            changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: updatedKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_CREATE) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const bulkRequest = parseGatewayKeyRegistryBulkCreateRequest(
        await request.json(),
        dynamicKeys
      );
      const createdKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const entry of bulkRequest.keys) {
        createdKeys.push(
          await createStoredDynamicKey(this.state.storage, entry)
        );
      }

      for (const key of createdKeys) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "created",
            ownership: "registry",
            occurredAt: key.createdAt,
            ...(operationId ? { operationId } : {}),
            ...(bulkRequest.actorContext
              ? toGatewayKeyAuditActorContextRecord(
                  bulkRequest.actorContext
                )
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: createdKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryBulkCreateResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_DELETE) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkDeleteRequest(
        await request.json()
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );

      if (
        bulkRequest.keyIds.some((keyId) => {
          return !existingKeysById.has(keyId);
        })
      ) {
        return new Response("Not found", { status: 404 });
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const occurredAt = new Date().toISOString();

      for (const keyId of bulkRequest.keyIds) {
        await clearStoredDynamicKey(this.state.storage, keyId);
      }

      for (const keyId of bulkRequest.keyIds) {
        const existingKey = existingKeysById.get(keyId);

        if (!existingKey) {
          continue;
        }

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: existingKey.id,
            kind: "deleted",
            ownership: "registry",
            occurredAt,
            ...(operationId ? { operationId } : {}),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: bulkRequest.keyIds.map((keyId) => {
          return {
            keyId,
            deleted: true
          };
        })
      } satisfies GatewayKeyRegistryBulkDeleteResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_ROTATE) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkRotateRequest(
        await request.json()
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );
      const rotationPlan = bulkRequest.rotations.map((entry) => {
        const existingKey = existingKeysById.get(entry.keyId);

        if (!existingKey) {
          return null;
        }

        return {
          entry,
          existingKey,
          nextKey:
            entry.overlapSeconds && entry.overlapSeconds > 0
              ? {
                  ...existingKey,
                  valueHash: entry.valueHash,
                  previousValueHash: existingKey.valueHash,
                  previousValueHashExpiresAt: new Date(
                    Date.now() + entry.overlapSeconds * 1000
                  ).toISOString()
                }
              : {
                  ...existingKey,
                  valueHash: entry.valueHash
                }
        };
      });

      if (rotationPlan.some((entry) => entry === null)) {
        return new Response("Not found", { status: 404 });
      }

      let simulatedKeys = [...dynamicKeys];

      for (const plan of rotationPlan) {
        if (!plan) {
          continue;
        }

        parseGatewayDynamicApiKeyRecord(
          plan.nextKey,
          simulatedKeys.filter((entry) => entry.id !== plan.entry.keyId)
        );
        simulatedKeys = simulatedKeys.map((entry) => {
          return entry.id === plan.entry.keyId ? plan.nextKey : entry;
        });
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const updatedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const plan of rotationPlan) {
        if (!plan) {
          continue;
        }

        updatedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            plan.nextKey,
            dynamicKeys,
            plan.entry.overlapSeconds && plan.entry.overlapSeconds > 0
              ? undefined
              : { clearPreviousValueHash: true }
          )
        );
      }

      for (const key of updatedKeys) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "rotated",
            ownership: "registry",
            occurredAt: key.updatedAt,
            ...(operationId ? { operationId } : {}),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: updatedKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_ROTATE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const payload = parseGatewayKeyRegistryRotateRequest(await request.json());
      const rotateRecord =
        payload.overlapSeconds && payload.overlapSeconds > 0
          ? {
              ...existingKey,
              valueHash: payload.valueHash,
              previousValueHash: existingKey.valueHash,
              previousValueHashExpiresAt: new Date(
                Date.now() + payload.overlapSeconds * 1000
              ).toISOString()
            }
          : {
              ...existingKey,
              valueHash: payload.valueHash
            };
      const key = await updateStoredDynamicKey(
        this.state.storage,
        rotateRecord,
        dynamicKeys,
        payload.overlapSeconds && payload.overlapSeconds > 0
          ? undefined
          : { clearPreviousValueHash: true }
      );
      const actorContext =
        gatewayKeyAuditActorContextFromRegistryRequest(payload);
      const previousKey = existingKey;
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        createGatewayKeyAuditEvent({
          keyId: key.id,
          kind: "rotated",
          ownership: "registry",
          occurredAt: key.updatedAt,
          changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        })
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      if (
        !existingKey.previousValueHash ||
        !existingKey.previousValueHashExpiresAt
      ) {
        return new Response("Rotation not staged", { status: 409 });
      }

      const payload = parseGatewayKeyRegistryRotationActionRequest(
        await request.json(),
        "Gateway dynamic key rotation finalize payload is invalid"
      );
      const actorContext =
        gatewayKeyAuditActorContextFromRegistryRequest(payload);
      const previousKey = existingKey;
      const key = await updateStoredDynamicKey(
        this.state.storage,
        existingKey,
        await listStoredDynamicKeys(this.state.storage),
        { clearPreviousValueHash: true }
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        createGatewayKeyAuditEvent({
          keyId: key.id,
          kind: "rotation_finalized",
          ownership: "registry",
          occurredAt: key.updatedAt,
          changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        })
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      if (
        !existingKey.previousValueHash ||
        !existingKey.previousValueHashExpiresAt
      ) {
        return new Response("Rotation not staged", { status: 409 });
      }

      if (Date.now() >= Date.parse(existingKey.previousValueHashExpiresAt)) {
        return new Response("Rotation not cancelable", { status: 409 });
      }

      const payload = parseGatewayKeyRegistryRotationActionRequest(
        await request.json(),
        "Gateway dynamic key rotation cancel payload is invalid"
      );
      const actorContext =
        gatewayKeyAuditActorContextFromRegistryRequest(payload);
      const previousKey = existingKey;
      const key = await updateStoredDynamicKey(
        this.state.storage,
        {
          ...existingKey,
          valueHash: existingKey.previousValueHash
        },
        await listStoredDynamicKeys(this.state.storage),
        { clearPreviousValueHash: true }
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        createGatewayKeyAuditEvent({
          keyId: key.id,
          kind: "rotation_canceled",
          ownership: "registry",
          occurredAt: key.updatedAt,
          changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        })
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_ARCHIVE) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkArchiveRequest(
        await request.json()
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );
      const archivePlan = bulkRequest.keyIds.map((candidateKeyId) => {
        const existingKey = existingKeysById.get(candidateKeyId);

        if (!existingKey) {
          return null;
        }

        if (existingKey.archivedAt) {
          return "already_archived" as const;
        }

        return {
          nextKey: {
            ...existingKey,
            archivedAt: new Date().toISOString()
          }
        };
      });

      if (archivePlan.some((entry) => entry === null)) {
        return new Response("Not found", { status: 404 });
      }

      if (archivePlan.some((entry) => entry === "already_archived")) {
        return new Response("Already archived", { status: 409 });
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const archivedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const plan of archivePlan) {
        if (!plan || plan === "already_archived") {
          continue;
        }

        archivedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            plan.nextKey,
            dynamicKeys
          )
        );
      }

      for (const key of archivedKeys) {
        const previousKey = existingKeysById.get(key.id);

        if (!previousKey) {
          continue;
        }

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "archived",
            ownership: "registry",
            occurredAt: key.updatedAt,
            ...(operationId ? { operationId } : {}),
            changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: archivedKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_RESTORE) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkRestoreRequest(
        await request.json()
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );
      const restorePlan = bulkRequest.keyIds.map((candidateKeyId) => {
        const existingKey = existingKeysById.get(candidateKeyId);

        if (!existingKey) {
          return null;
        }

        if (!existingKey.archivedAt) {
          return "not_archived" as const;
        }

        const nextKey = { ...existingKey };
        delete nextKey.archivedAt;

        return { nextKey };
      });

      if (restorePlan.some((entry) => entry === null)) {
        return new Response("Not found", { status: 404 });
      }

      if (restorePlan.some((entry) => entry === "not_archived")) {
        return new Response("Not archived", { status: 409 });
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const restoredKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const plan of restorePlan) {
        if (!plan || plan === "not_archived") {
          continue;
        }

        restoredKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            plan.nextKey,
            dynamicKeys,
            { clearArchivedAt: true }
          )
        );
      }

      for (const key of restoredKeys) {
        const previousKey = existingKeysById.get(key.id);

        if (!previousKey) {
          continue;
        }

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "restored",
            ownership: "registry",
            occurredAt: key.updatedAt,
            ...(operationId ? { operationId } : {}),
            changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: restoredKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_ROTATE_FINALIZE) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkRotationActionRequest(
        await request.json(),
        "Gateway dynamic key bulk rotation finalize payload is invalid"
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );

      for (const candidateKeyId of bulkRequest.keyIds) {
        const existingKey = existingKeysById.get(candidateKeyId);

        if (!existingKey) {
          return new Response("Not found", { status: 404 });
        }

        if (
          !existingKey.previousValueHash ||
          !existingKey.previousValueHashExpiresAt
        ) {
          return new Response("Rotation not staged", { status: 409 });
        }
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const finalizedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const candidateKeyId of bulkRequest.keyIds) {
        const existingKey = existingKeysById.get(candidateKeyId);

        if (!existingKey) {
          continue;
        }

        finalizedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            existingKey,
            dynamicKeys,
            { clearPreviousValueHash: true }
          )
        );
      }

      for (const key of finalizedKeys) {
        const previousKey = existingKeysById.get(key.id);

        if (!previousKey) {
          continue;
        }

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "rotation_finalized",
            ownership: "registry",
            occurredAt: key.updatedAt,
            ...(operationId ? { operationId } : {}),
            changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: finalizedKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_BULK_ROTATE_CANCEL) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const bulkRequest = parseGatewayKeyRegistryBulkRotationActionRequest(
        await request.json(),
        "Gateway dynamic key bulk rotation cancel payload is invalid"
      );
      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const existingKeysById = new Map(
        dynamicKeys.map((entry) => {
          return [entry.id, entry] as const;
        })
      );

      for (const candidateKeyId of bulkRequest.keyIds) {
        const existingKey = existingKeysById.get(candidateKeyId);

        if (!existingKey) {
          return new Response("Not found", { status: 404 });
        }

        if (
          !existingKey.previousValueHash ||
          !existingKey.previousValueHashExpiresAt
        ) {
          return new Response("Rotation not staged", { status: 409 });
        }

        if (Date.now() >= Date.parse(existingKey.previousValueHashExpiresAt)) {
          return new Response("Rotation not cancelable", { status: 409 });
        }
      }

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const canceledKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const candidateKeyId of bulkRequest.keyIds) {
        const existingKey = existingKeysById.get(candidateKeyId);

        if (!existingKey || !existingKey.previousValueHash) {
          continue;
        }

        canceledKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            {
              ...existingKey,
              valueHash: existingKey.previousValueHash
            },
            dynamicKeys,
            { clearPreviousValueHash: true }
          )
        );
      }

      for (const key of canceledKeys) {
        const previousKey = existingKeysById.get(key.id);

        if (!previousKey) {
          continue;
        }

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "rotation_canceled",
            ownership: "registry",
            occurredAt: key.updatedAt,
            ...(operationId ? { operationId } : {}),
            changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );
      }

      return Response.json({
        ...(operationId ? { operationId } : {}),
        keys: canceledKeys.map((entry) => {
          return createGatewayKeyRegistryDynamicKeyView(entry);
        })
      } satisfies GatewayKeyRegistryDynamicKeyListResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_ARCHIVE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      if (existingKey.archivedAt) {
        return new Response("Already archived", { status: 409 });
      }

      const payload = parseGatewayKeyRegistryLifecycleActionRequest(
        await request.json(),
        "Gateway dynamic key archive payload is invalid"
      );
      const actorContext =
        gatewayKeyAuditActorContextFromRegistryRequest(payload);
      const previousKey = existingKey;
      const key = await updateStoredDynamicKey(
        this.state.storage,
        {
          ...existingKey,
          archivedAt: new Date().toISOString()
        },
        await listStoredDynamicKeys(this.state.storage)
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        createGatewayKeyAuditEvent({
          keyId: key.id,
          kind: "archived",
          ownership: "registry",
          occurredAt: key.updatedAt,
          changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        })
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_RESTORE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      if (!existingKey.archivedAt) {
        return new Response("Not archived", { status: 409 });
      }

      const payload = parseGatewayKeyRegistryLifecycleActionRequest(
        await request.json(),
        "Gateway dynamic key restore payload is invalid"
      );
      const actorContext =
        gatewayKeyAuditActorContextFromRegistryRequest(payload);
      const nextKey = { ...existingKey };
      delete nextKey.archivedAt;
      const previousKey = existingKey;
      const key = await updateStoredDynamicKey(
        this.state.storage,
        nextKey,
        await listStoredDynamicKeys(this.state.storage),
        { clearArchivedAt: true }
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        createGatewayKeyAuditEvent({
          keyId: key.id,
          kind: "restored",
          ownership: "registry",
          occurredAt: key.updatedAt,
          changes: createStoredGatewayRegistryFieldDiffs(previousKey, key),
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        })
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC) {
      if (request.method === "POST") {
        const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
        const createRequest = parseGatewayKeyRegistryCreateRequest(
          await request.json(),
          dynamicKeys
        );
        const key = await createStoredDynamicKey(
          this.state.storage,
          createRequest.key
        );
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "created",
            ownership: "registry",
            occurredAt: key.createdAt,
            ...(createRequest.actorContext
              ? toGatewayKeyAuditActorContextRecord(
                  createRequest.actorContext
                )
              : {})
          })
        );

        return Response.json({
          key: createGatewayKeyRegistryDynamicKeyView(key)
        } satisfies GatewayKeyRegistryDynamicKeyResponse);
      }

      if (!keyId) {
        return new Response("Missing keyId", { status: 400 });
      }

      if (request.method === "GET") {
        const key = await readStoredDynamicKey(this.state.storage, keyId);

        if (!key) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json({
          key: createGatewayKeyRegistryDynamicKeyView(key)
        } satisfies GatewayKeyRegistryDynamicKeyResponse);
      }

      if (request.method === "PUT") {
        const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

        if (!existingKey) {
          return new Response("Not found", { status: 404 });
        }

        const updateRequest = parseGatewayKeyRegistryUpdateRequest(
          await request.json()
        );
        const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
          updateRequest.auditMetadata
        );
        const key = await updateStoredDynamicKey(
          this.state.storage,
          applyGatewayApiKeyMetadataOverride(existingKey, updateRequest.update),
          await listStoredDynamicKeys(this.state.storage)
        );

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          createGatewayKeyAuditEvent({
            keyId: key.id,
            kind: "updated",
            ownership: "registry",
            occurredAt: key.updatedAt,
            changes: createStoredGatewayRegistryFieldDiffs(existingKey, key),
            ...(updateRequest.auditMetadata.reason
              ? { reason: updateRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          })
        );

        return Response.json({
          key: createGatewayKeyRegistryDynamicKeyView(key)
        } satisfies GatewayKeyRegistryDynamicKeyResponse);
      }

      if (request.method === "DELETE") {
        const existingKey = await readStoredDynamicKey(this.state.storage, keyId);
        const payload =
          request.headers.get("content-type")?.includes("application/json")
            ? parseGatewayKeyRegistryDeleteRequest(await request.json())
            : {};
        const actorContext =
          gatewayKeyAuditActorContextFromRegistryRequest(payload);
        const deleted = await clearStoredDynamicKey(this.state.storage, keyId);

        if (!deleted) {
          return new Response("Not found", { status: 404 });
        }

        if (existingKey) {
          await appendStoredDynamicKeyAuditEvent(
            this.state.storage,
            createGatewayKeyAuditEvent({
              keyId: existingKey.id,
              kind: "deleted",
              ownership: "registry",
              occurredAt: new Date().toISOString(),
              ...(payload.reason ? { reason: payload.reason } : {}),
              ...(actorContext
                ? toGatewayKeyAuditActorContextRecord(actorContext)
                : {})
            })
          );
        }

        return Response.json({
          keyId,
          deleted: true
        } satisfies GatewayKeyRegistryDeleteResponse);
      }

      return new Response("Method not allowed", { status: 405 });
    }

    if (!keyId) {
      return new Response("Missing keyId", { status: 400 });
    }

    switch (request.method) {
      case "GET":
        return Response.json({
          keyId,
          override: await readStoredOverride(this.state.storage, keyId)
        } satisfies GatewayKeyRegistryRecordResponse);
      case "PUT":
        return Response.json({
          keyId,
          override: await writeStoredOverride(
            this.state.storage,
            keyId,
            parseGatewayApiKeyMetadataOverride(await request.json())
          )
        } satisfies GatewayKeyRegistryRecordResponse);
      case "DELETE":
        await clearStoredOverride(this.state.storage, keyId);
        return Response.json({
          keyId,
          override: null
        } satisfies GatewayKeyRegistryRecordResponse);
      default:
        return new Response("Method not allowed", { status: 405 });
    }
  }
}

export function isGatewayKeyRegistryEnabled(env: GatewayBindings): boolean {
  return (
    env.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED === true ||
    (env.AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED as unknown) === "true"
  );
}

export async function getGatewayKeyRegistryOverride(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<GatewayKeyRegistryStoredOverride | null> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return null;
  }

  const namespace = requireGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_OVERRIDE, {
        method: "GET",
        keyId: gatewayApiKey.id
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    const parsed = parseGatewayKeyRegistryRecordResponse(await response.json());
    return parsed.override;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function upsertGatewayKeyRegistryOverride(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  override: GatewayApiKeyMetadataOverride,
  requestId: string
): Promise<GatewayKeyRegistryStoredOverride> {
  const namespace = requireGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_OVERRIDE, {
        method: "PUT",
        keyId: gatewayApiKey.id,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(override)
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  const parsed = parseGatewayKeyRegistryRecordResponse(await response.json());

  if (!parsed.override) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId);
  }

  return parsed.override;
}

export async function clearGatewayKeyRegistryOverride(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<void> {
  const namespace = requireGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_OVERRIDE, {
        method: "DELETE",
        keyId: gatewayApiKey.id
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }
}

export async function createGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return createGatewayRegistryKeyUseCase(
    payload,
    requestId,
    {
      listComparableKeysForCreate: async () => {
        const existingDynamicKeys = await listGatewayRegistryApiKeys(env, requestId);
        const comparableConfiguredKeys =
          await toDynamicUniquenessComparableGatewayApiKeys(
            configuredGatewayApiKeys
          );

        return [
          ...comparableConfiguredKeys,
          ...existingDynamicKeys.map((entry) => {
            return entry.key;
          })
        ];
      },
      validateRuntimeDependencies: (gatewayApiKey) => {
        assertGatewayKeyRuntimeDependencies(env, gatewayApiKey, requestId);
      },
      createRegistryKey: async (createRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                ...createRequest.key,
                ...(actorContext ?? createRequest.actorContext
                  ? toGatewayKeyAuditActorContextRecord(
                      actorContext ?? createRequest.actorContext!
                    )
                  : {})
              } satisfies GatewayKeyRegistryCreateRequest)
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Created dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkCreateGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryBulkCreateResponse> {
  return bulkCreateGatewayRegistryKeysUseCase(
    payload,
    requestId,
    {
      listComparableKeysForCreate: async () => {
        const existingDynamicKeys = await listGatewayRegistryApiKeys(env, requestId);
        const comparableConfiguredKeys =
          await toDynamicUniquenessComparableGatewayApiKeys(
            configuredGatewayApiKeys
          );

        return [
          ...comparableConfiguredKeys,
          ...existingDynamicKeys.map((entry) => {
            return entry.key;
          })
        ];
      },
      validateRuntimeDependencies: (gatewayApiKey) => {
        assertGatewayKeyRuntimeDependencies(env, gatewayApiKey, requestId);
      },
      bulkCreateRegistryKeys: async (createRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_CREATE, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                keys: createRequest.keys,
                ...(actorContext ?? createRequest.actorContext
                  ? toGatewayKeyAuditActorContextRecord(
                      actorContext ?? createRequest.actorContext!
                    )
                  : {})
              } satisfies {
                keys: GatewayApiKeyRecord[];
                actor?: string;
                actorSource?: "payload" | "trusted_header" | "credential";
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryBulkCreateResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function getGatewayRegistryApiKey(
  env: GatewayBindings,
  keyId: string,
  requestId: string
): Promise<GatewayKeyRegistryDynamicKeyView | null> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return null;
  }

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
        method: "GET",
        keyId
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    return parseGatewayKeyRegistryDynamicKeyResponse(await response.json());
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function deleteGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<void> {
  await deleteGatewayRegistryKeyUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      clearRevocationOverlay: async (existingKey) => {
        return clearGatewayKeyRevocationOverlayState(
          env,
          existingKey.key,
          requestId
        );
      },
      deleteRegistryKey: async (candidateKeyId, deleteRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
              method: "DELETE",
              keyId: candidateKeyId,
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                ...deleteRequest,
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : {})
              } satisfies GatewayKeyRegistryDeleteRequest)
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const parsed = parseGatewayKeyRegistryDeleteResponse(await response.json());

          if (!parsed.deleted) {
            throw new Error("Dynamic key delete was not acknowledged");
          }
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function updateGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return updateGatewayRegistryKeyUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      applyUpdate: (existingKey, update) => {
        return applyGatewayApiKeyMetadataOverride(existingKey, update);
      },
      validateRuntimeDependencies: (gatewayApiKey) => {
        assertGatewayKeyRuntimeDependencies(env, gatewayApiKey, requestId);
      },
      updateRegistryKey: async (updateRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
              method: "PUT",
              keyId: updateRequest.keyId,
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                ...updateRequest.update,
                ...(updateRequest.auditMetadata.reason
                  ? { reason: updateRequest.auditMetadata.reason }
                  : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : updateRequest.auditMetadata.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          updateRequest.auditMetadata
                        )!
                      )
                    : {})
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Updated dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkUpdateGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkUpdateGatewayRegistryKeysUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      applyUpdate: (existingKey, update) => {
        return applyGatewayApiKeyMetadataOverride(existingKey, update);
      },
      validateRuntimeDependencies: (gatewayApiKey) => {
        assertGatewayKeyRuntimeDependencies(env, gatewayApiKey, requestId);
      },
      bulkUpdateRegistryKeys: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_UPDATE, {
              method: "PATCH",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                updates: bulkRequest.updates.map((entry) => {
                  return {
                    keyId: entry.keyId,
                    ...entry.update
                  };
                }),
                ...(bulkRequest.auditMetadata.reason
                  ? { reason: bulkRequest.auditMetadata.reason }
                  : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : bulkRequest.auditMetadata.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          bulkRequest.auditMetadata
                        )!
                      )
                    : {})
              } satisfies {
                updates: Array<{ keyId: string } & GatewayApiKeyMetadataOverride>;
                reason?: string;
                actor?: string;
                actorSource?: "payload" | "trusted_header" | "credential";
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkDeleteGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryBulkDeleteResponse> {
  return bulkDeleteGatewayRegistryKeysUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      clearRevocationOverlay: async (existingKey) => {
        return clearGatewayKeyRevocationOverlayState(
          env,
          existingKey.key,
          requestId
        );
      },
      bulkDeleteRegistryKeys: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_DELETE, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                keyIds: bulkRequest.keyIds,
                ...(bulkRequest.auditMetadata.reason
                  ? { reason: bulkRequest.auditMetadata.reason }
                  : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : bulkRequest.auditMetadata.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          bulkRequest.auditMetadata
                        )!
                      )
                    : {})
              } satisfies {
                keyIds: string[];
                reason?: string;
                actor?: string;
                actorSource?: "payload" | "trusted_header" | "credential";
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryBulkDeleteResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkRotateGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkRotateGatewayRegistryKeysUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      listComparableKeysForRotation: async () => {
        const comparableConfiguredKeys =
          await toDynamicUniquenessComparableGatewayApiKeys(
            configuredGatewayApiKeys
          );

        return [
          ...comparableConfiguredKeys,
          ...(await listGatewayRegistryApiKeys(env, requestId)).map((entry) => {
            return entry.key;
          })
        ];
      },
      validateRotatedKey: (existingKey, valueHash, comparableKeys) => {
        const rotatedGatewayApiKey = validateGatewayRegistryRotatedKeyCandidate(
          existingKey,
          valueHash,
          comparableKeys
        );
        assertGatewayKeyRuntimeDependencies(env, rotatedGatewayApiKey, requestId);
        return rotatedGatewayApiKey;
      },
      clearRevocationOverlay: async (existingKey) => {
        return clearGatewayKeyRevocationOverlayState(
          env,
          existingKey.key,
          requestId
        );
      },
      bulkRotateRegistryKeys: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_ROTATE, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                rotations: bulkRequest.rotations,
                ...(bulkRequest.auditMetadata.reason
                  ? { reason: bulkRequest.auditMetadata.reason }
                  : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : bulkRequest.auditMetadata.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          bulkRequest.auditMetadata
                        )!
                      )
                    : {})
              } satisfies {
                rotations: Array<{
                  keyId: string;
                  valueHash: string;
                  overlapSeconds?: number;
                }>;
                reason?: string;
                actor?: string;
                actorSource?: "payload" | "trusted_header" | "credential";
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkArchiveGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkArchiveGatewayRegistryKeysUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      bulkArchiveRegistryKeys: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_ARCHIVE, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                keyIds: bulkRequest.keyIds,
                ...(bulkRequest.auditMetadata.reason
                  ? { reason: bulkRequest.auditMetadata.reason }
                  : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : bulkRequest.auditMetadata.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          bulkRequest.auditMetadata
                        )!
                      )
                    : {})
              } satisfies {
                keyIds: string[];
                reason?: string;
                actor?: string;
                actorSource?: "payload" | "trusted_header" | "credential";
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          throw createGatewayKeyAlreadyArchivedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkRestoreGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkRestoreGatewayRegistryKeysUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      bulkRestoreRegistryKeys: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_RESTORE, {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                keyIds: bulkRequest.keyIds,
                ...(bulkRequest.auditMetadata.reason
                  ? { reason: bulkRequest.auditMetadata.reason }
                  : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : bulkRequest.auditMetadata.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          bulkRequest.auditMetadata
                        )!
                      )
                    : {})
              } satisfies {
                keyIds: string[];
                reason?: string;
                actor?: string;
                actorSource?: "payload" | "trusted_header" | "credential";
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          throw createGatewayKeyNotArchivedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkFinalizeGatewayRegistryApiKeyRotations(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkFinalizeGatewayRegistryKeyRotationsUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      bulkFinalizeRegistryKeyRotations: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(
              requestId,
              REGISTRY_KIND_DYNAMIC_BULK_ROTATE_FINALIZE,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                body: JSON.stringify({
                  keyIds: bulkRequest.keyIds,
                  ...(bulkRequest.auditMetadata.reason
                    ? { reason: bulkRequest.auditMetadata.reason }
                    : {}),
                  ...(actorContext
                    ? toGatewayKeyAuditActorContextRecord(actorContext)
                    : bulkRequest.auditMetadata.actor
                      ? toGatewayKeyAuditActorContextRecord(
                          gatewayKeyAuditActorContextFromRegistryRequest(
                            bulkRequest.auditMetadata
                          )!
                        )
                      : {})
                } satisfies {
                  keyIds: string[];
                  reason?: string;
                  actor?: string;
                  actorSource?: "payload" | "trusted_header" | "credential";
                })
              }
            )
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          throw createGatewayKeyRotationNotStagedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function bulkCancelGatewayRegistryApiKeyRotations(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkCancelGatewayRegistryKeyRotationsUseCase(
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKeys: async (keyIds) => {
        return Promise.all(
          keyIds.map(async (keyId) => {
            return getGatewayRegistryApiKey(env, keyId, requestId);
          })
        );
      },
      bulkCancelRegistryKeyRotations: async (bulkRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(
              requestId,
              REGISTRY_KIND_DYNAMIC_BULK_ROTATE_CANCEL,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json"
                },
                body: JSON.stringify({
                  keyIds: bulkRequest.keyIds,
                  ...(bulkRequest.auditMetadata.reason
                    ? { reason: bulkRequest.auditMetadata.reason }
                    : {}),
                  ...(actorContext
                    ? toGatewayKeyAuditActorContextRecord(actorContext)
                    : bulkRequest.auditMetadata.actor
                      ? toGatewayKeyAuditActorContextRecord(
                          gatewayKeyAuditActorContextFromRegistryRequest(
                            bulkRequest.auditMetadata
                          )!
                        )
                      : {})
                } satisfies {
                  keyIds: string[];
                  reason?: string;
                  actor?: string;
                  actorSource?: "payload" | "trusted_header" | "credential";
                })
              }
            )
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          const body = await response.text();

          if (body === "Rotation not cancelable") {
            throw createGatewayKeyRotationNotCancelableError(requestId);
          }

          throw createGatewayKeyRotationNotStagedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json());
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function getGatewayRegistryOperationEvents(
  env: GatewayBindings,
  operationId: string,
  requestId: string
): Promise<GatewayKeyAuditEvent[]> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return [];
  }

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  const url = new URL("https://airlock.internal/gateway-key-registry");
  url.searchParams.set("kind", REGISTRY_KIND_OPERATION_EVENTS);
  url.searchParams.set("operationId", operationId);
  let response: Response;

  try {
    response = await stub.fetch(
      new Request(url, {
        method: "GET",
        headers: {
          "x-airlock-request-id": requestId
        }
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (response.status === 404) {
    throw createGatewayKeyNotFoundError(requestId);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    return parseGatewayKeyOperationEventsResponse(await response.json()).events;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function listGatewayRegistryApiKeys(
  env: GatewayBindings,
  requestId: string
): Promise<GatewayKeyRegistryDynamicKeyView[]> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return [];
  }

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_LIST, {
        method: "GET"
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    return parseGatewayKeyRegistryDynamicKeyListResponse(await response.json()).keys;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function getGatewayRegistryApiKeyEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
): Promise<GatewayKeyAuditEvent[]> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return [];
  }

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_EVENTS, {
        method: "GET",
        keyId
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    return parseGatewayKeyAuditEventsResponse(await response.json()).events;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function findGatewayRegistryApiKeyByToken(
  env: GatewayBindings,
  bearerToken: string,
  requestId: string
): Promise<GatewayApiKeyRecord | undefined> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return undefined;
  }

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_LOOKUP, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          bearerToken
        } satisfies GatewayKeyRegistryLookupRequest)
      })
    );
  } catch (cause) {
    throw createGatewayKeyRegistryUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    throw createGatewayKeyRegistryUnavailableError(requestId);
  }

  try {
    const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());
    return key?.key;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function rotateGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return rotateGatewayRegistryKeyUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      listComparableKeysForRotation: async (candidateKeyId) => {
        const comparableConfiguredKeys =
          await toDynamicUniquenessComparableGatewayApiKeys(
            configuredGatewayApiKeys
          );

        return [
          ...comparableConfiguredKeys,
          ...(await listGatewayRegistryApiKeys(env, requestId))
            .filter((entry) => entry.keyId !== candidateKeyId)
            .map((entry) => {
              return entry.key;
            })
        ];
      },
      validateRotatedKey: (existingKey, valueHash, comparableKeys) => {
        const rotatedGatewayApiKey = validateGatewayRegistryRotatedKeyCandidate(
          existingKey,
          valueHash,
          comparableKeys
        );
        assertGatewayKeyRuntimeDependencies(env, rotatedGatewayApiKey, requestId);
        return rotatedGatewayApiKey;
      },
      clearRevocationOverlay: async (existingKey) => {
        return clearGatewayKeyRevocationOverlayState(
          env,
          existingKey.key,
          requestId
        );
      },
      rotateRegistryKey: async (candidateKeyId, rotateRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ROTATE, {
              method: "POST",
              keyId: candidateKeyId,
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                valueHash: rotateRequest.valueHash,
                ...(rotateRequest.overlapSeconds !== undefined
                  ? { overlapSeconds: rotateRequest.overlapSeconds }
                  : {}),
                ...(rotateRequest.reason ? { reason: rotateRequest.reason } : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : rotateRequest.actor
                    ? toGatewayKeyAuditActorContextRecord(
                        gatewayKeyAuditActorContextFromRegistryRequest(
                          rotateRequest
                        )!
                      )
                    : {})
              } satisfies GatewayKeyRegistryRotateRequest)
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Rotated dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function finalizeGatewayRegistryApiKeyRotation(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return finalizeGatewayRegistryKeyRotationUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      finalizeRegistryKeyRotation: async (candidateKeyId, actionRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(
              requestId,
              REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE,
              {
                method: "POST",
                keyId: candidateKeyId,
                headers: {
                  "content-type": "application/json"
                },
                body: JSON.stringify({
                  ...actionRequest,
                  ...(actorContext
                    ? toGatewayKeyAuditActorContextRecord(actorContext)
                    : {})
                } satisfies GatewayKeyRegistryRotationActionRequest)
              }
            )
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          throw createGatewayKeyRotationNotStagedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Finalized dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function cancelGatewayRegistryApiKeyRotation(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return cancelGatewayRegistryKeyRotationUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      cancelRegistryKeyRotation: async (candidateKeyId, actionRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(
              requestId,
              REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL,
              {
                method: "POST",
                keyId: candidateKeyId,
                headers: {
                  "content-type": "application/json"
                },
                body: JSON.stringify({
                  ...actionRequest,
                  ...(actorContext
                    ? toGatewayKeyAuditActorContextRecord(actorContext)
                    : {})
                } satisfies GatewayKeyRegistryRotationActionRequest)
              }
            )
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          const body = await response.text();

          if (body === "Rotation not cancelable") {
            throw createGatewayKeyRotationNotCancelableError(requestId);
          }

          throw createGatewayKeyRotationNotStagedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Canceled dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function archiveGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return archiveGatewayRegistryKeyUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      archiveRegistryKey: async (candidateKeyId, actionRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ARCHIVE, {
              method: "POST",
              keyId: candidateKeyId,
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                ...actionRequest,
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : {})
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          throw createGatewayKeyAlreadyArchivedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Archived dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function restoreGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return restoreGatewayRegistryKeyUseCase(
    keyId,
    payload,
    requestId,
    {
      isConfiguredKey: (candidateKeyId) => {
        return isConfiguredGatewayApiKeyId(
          configuredGatewayApiKeys,
          candidateKeyId
        );
      },
      getRegistryKey: async (candidateKeyId) => {
        return getGatewayRegistryApiKey(env, candidateKeyId, requestId);
      },
      restoreRegistryKey: async (candidateKeyId, actionRequest) => {
        const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
        const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
        let response: Response;

        try {
          response = await stub.fetch(
            buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_RESTORE, {
              method: "POST",
              keyId: candidateKeyId,
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                ...actionRequest,
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : {})
              })
            })
          );
        } catch (cause) {
          throw createGatewayKeyRegistryUnavailableError(requestId, cause);
        }

        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        if (response.status === 409) {
          throw createGatewayKeyNotArchivedError(requestId);
        }

        if (!response.ok) {
          throw createGatewayKeyRegistryUnavailableError(requestId);
        }

        try {
          const key = parseGatewayKeyRegistryDynamicKeyResponse(await response.json());

          if (!key) {
            throw new Error("Restored dynamic key response was empty");
          }

          return key;
        } catch (cause) {
          throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
        }
      }
    }
  );
}

export async function resolveGatewayRuntimeApiKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<{
  runtimeGatewayApiKey: GatewayApiKeyRecord;
  registryOverride: GatewayKeyRegistryStoredOverride | null;
}> {
  return resolveConfiguredGatewayApiKeyRuntime(gatewayApiKey, {
    readRegistryOverride: async (candidateGatewayApiKey) => {
      return getGatewayKeyRegistryOverride(
        env,
        candidateGatewayApiKey,
        requestId
      );
    }
  });
}

async function readStoredOverride(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<GatewayKeyRegistryStoredOverride | null> {
  const value = await storage.get<GatewayKeyRegistryStoredOverride>(
    `registry:${keyId}`
  );

  return value ?? null;
}

async function writeStoredOverride(
  storage: DurableObjectStateLike["storage"],
  keyId: string,
  override: GatewayApiKeyMetadataOverride
): Promise<GatewayKeyRegistryStoredOverride> {
  const next = {
    ...override,
    updatedAt: new Date().toISOString()
  };

  await storage.put(`registry:${keyId}`, next);
  return next;
}

async function clearStoredOverride(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<void> {
  await storage.delete(`registry:${keyId}`);
}

async function readStoredDynamicKeyIndex(
  storage: DurableObjectStateLike["storage"]
): Promise<string[]> {
  const value = await storage.get<unknown>(DYNAMIC_KEY_INDEX);

  if (value === undefined) {
    return [];
  }

  if (!isStringArray(value)) {
    throw new Error("Registry dynamic key index is invalid");
  }

  return Array.from(new Set(value));
}

async function writeStoredDynamicKeyIndex(
  storage: DurableObjectStateLike["storage"],
  keyIds: readonly string[]
): Promise<void> {
  const uniqueKeyIds = Array.from(new Set(keyIds)).sort();
  await storage.put(DYNAMIC_KEY_INDEX, uniqueKeyIds);
}

async function readStoredDynamicKey(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<GatewayKeyRegistryStoredDynamicKey | null> {
  const value = await storage.get<unknown>(`dynamic:${keyId}`);

  if (value === undefined) {
    return null;
  }

  return parseGatewayKeyRegistryStoredDynamicKey(value);
}

async function listStoredDynamicKeys(
  storage: DurableObjectStateLike["storage"]
): Promise<GatewayKeyRegistryStoredDynamicKey[]> {
  const keyIds = await readStoredDynamicKeyIndex(storage);
  const keys = await Promise.all(
    keyIds.map(async (keyId) => {
      return readStoredDynamicKey(storage, keyId);
    })
  );

  return keys.filter((key): key is GatewayKeyRegistryStoredDynamicKey => {
    return key !== null;
  });
}

async function findStoredDynamicKeyByValueHash(
  storage: DurableObjectStateLike["storage"],
  valueHash: string
): Promise<GatewayKeyRegistryStoredDynamicKey | null> {
  const keys = await listStoredDynamicKeys(storage);
  const now = Date.now();

  return (
    keys.find((key) => {
      if (key.archivedAt) {
        return false;
      }

      if (key.valueHash === valueHash) {
        return true;
      }

      return (
        key.previousValueHash === valueHash &&
        key.previousValueHashExpiresAt !== undefined &&
        now < Date.parse(key.previousValueHashExpiresAt)
      );
    }) ?? null
  );
}

async function createStoredDynamicKey(
  storage: DurableObjectStateLike["storage"],
  gatewayApiKey: GatewayApiKeyRecord
): Promise<GatewayKeyRegistryStoredDynamicKey> {
  const existing = await readStoredDynamicKey(storage, gatewayApiKey.id);

  if (existing) {
    throw new GatewayError("Gateway API key already exists", {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 409,
      retryable: false
    });
  }

  const next = createStoredGatewayRegistryDynamicKey(gatewayApiKey);

  await storage.put(`dynamic:${gatewayApiKey.id}`, next);
  await writeStoredDynamicKeyIndex(storage, [
    ...(await readStoredDynamicKeyIndex(storage)),
    gatewayApiKey.id
  ]);

  return next;
}

async function updateStoredDynamicKey(
  storage: DurableObjectStateLike["storage"],
  gatewayApiKey: GatewayApiKeyRecord & {
    previousValueHash?: string;
    previousValueHashExpiresAt?: string;
  },
  existingGatewayApiKeys: readonly GatewayKeyRegistryStoredDynamicKey[],
  options?: GatewayKeyRegistryStoredDynamicKeyUpdateOptions
): Promise<GatewayKeyRegistryStoredDynamicKey> {
  const existing = await readStoredDynamicKey(storage, gatewayApiKey.id);

  if (!existing) {
    throw new GatewayError("Gateway API key not found", {
      code: "gateway_key_not_found",
      category: "governance",
      httpStatus: 404,
      retryable: false
    });
  }

  const next = updateStoredGatewayRegistryDynamicKey(
    existing,
    gatewayApiKey,
    existingGatewayApiKeys,
    options
  );

  await storage.put(`dynamic:${gatewayApiKey.id}`, next);

  return next;
}

async function clearStoredDynamicKey(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<boolean> {
  const existing = await readStoredDynamicKey(storage, keyId);

  if (!existing) {
    return false;
  }

  await storage.delete(`dynamic:${keyId}`);
  await writeStoredDynamicKeyIndex(
    storage,
    (await readStoredDynamicKeyIndex(storage)).filter((candidate) => {
      return candidate !== keyId;
    })
  );

  return true;
}

async function readStoredDynamicKeyAuditEvents(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<GatewayKeyAuditEvent[]> {
  const value = await storage.get<unknown>(`${DYNAMIC_KEY_AUDIT_EVENTS_PREFIX}${keyId}`);

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Registry dynamic key audit events are invalid");
  }

  return value.map((entry) => {
    const parsedEvent = parseGatewayKeyAuditEventsResponse({
      keyId,
      events: [entry]
    }).events[0];

    if (!parsedEvent) {
      throw new Error("Registry dynamic key audit event is missing");
    }

    return createGatewayKeyAuditEvent(parsedEvent);
  });
}

async function appendStoredDynamicKeyAuditEvent(
  storage: DurableObjectStateLike["storage"],
  event: GatewayKeyAuditEvent
): Promise<void> {
  const events = await readStoredDynamicKeyAuditEvents(storage, event.keyId);

  await storage.put(`${DYNAMIC_KEY_AUDIT_EVENTS_PREFIX}${event.keyId}`, [
    ...events,
    createGatewayKeyAuditEvent(event)
  ].slice(-MAX_GATEWAY_KEY_AUDIT_EVENTS));

  if (event.operationId) {
    const operationKey = `${DYNAMIC_KEY_OPERATION_INDEX_PREFIX}${event.operationId}`;
    const existingKeyIds =
      (await storage.get<unknown>(operationKey)) as string[] | undefined;
    const normalizedKeyIds =
      Array.isArray(existingKeyIds) &&
      existingKeyIds.every((entry) => typeof entry === "string")
        ? existingKeyIds
        : [];

    if (!normalizedKeyIds.includes(event.keyId)) {
      await storage.put(operationKey, [...normalizedKeyIds, event.keyId]);
    }
  }
}

async function readStoredDynamicKeyOperationEvents(
  storage: DurableObjectStateLike["storage"],
  operationId: string
): Promise<GatewayKeyAuditEvent[]> {
  const rawKeyIds = await storage.get<unknown>(
    `${DYNAMIC_KEY_OPERATION_INDEX_PREFIX}${operationId}`
  );

  if (rawKeyIds === undefined) {
    return [];
  }

  if (!Array.isArray(rawKeyIds) || !rawKeyIds.every((entry) => typeof entry === "string")) {
    throw new Error("Registry dynamic key operation index is invalid");
  }

  const perKeyEvents = await Promise.all(
    rawKeyIds.map(async (keyId) => {
      return readStoredDynamicKeyAuditEvents(storage, keyId);
    })
  );

  return perKeyEvents.flat().filter((event) => {
    return event.operationId === operationId;
  });
}
