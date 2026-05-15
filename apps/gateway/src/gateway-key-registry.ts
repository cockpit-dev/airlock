import {
  assertGatewayApiKeyRuntimeDependencies,
  applyGatewayApiKeyMetadataOverride,
  archiveGatewayRegistryKey as archiveGatewayRegistryKeyUseCase,
  buildArchiveGatewayRegistryKeyTransition,
  buildBulkArchiveGatewayRegistryKeyTransitions,
  buildBulkCancelGatewayRegistryKeyRotationTransitions,
  buildBulkFinalizeGatewayRegistryKeyRotationTransitions,
  buildBulkRestoreGatewayRegistryKeyTransitions,
  buildCancelGatewayRegistryKeyRotationTransition,
  buildCreateGatewayRegistryKeyTransition,
  buildBulkCreateGatewayRegistryKeyTransitions,
  buildBulkDeleteGatewayRegistryKeyAuditEvents,
  buildBulkRotateGatewayRegistryKeyTransitions,
  buildBulkUpdateGatewayRegistryKeyTransitions,
  buildDeleteGatewayRegistryKeyAuditEvent,
  buildFinalizeGatewayRegistryKeyRotationTransition,
  buildRotateGatewayRegistryKeyTransition,
  buildRestoreGatewayRegistryKeyTransition,
  buildUpdateGatewayRegistryKeyTransition,
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
  createGatewayKeyRegistryDynamicKeyView,
  createGatewayKeyAuditEvent,
  createGatewayKeyAlreadyArchivedError,
  createGatewayKeyNotArchivedError,
  createGatewayKeyNotFoundError,
  createGatewayKeyRotationNotCancelableError,
  createGatewayKeyRotationNotStagedError,
  deleteGatewayRegistryKey as deleteGatewayRegistryKeyUseCase,
  finalizeGatewayRegistryKeyRotation as finalizeGatewayRegistryKeyRotationUseCase,
  isConfiguredGatewayApiKeyId,
  isStringArray,
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
  findDynamicKeyByValueHash,
  restoreGatewayRegistryKey as restoreGatewayRegistryKeyUseCase,
  toGatewayKeyAuditActorContextRecord,
  rotateGatewayRegistryKey as rotateGatewayRegistryKeyUseCase,
  updateStoredGatewayRegistryDynamicKey,
  updateGatewayRegistryKey as updateGatewayRegistryKeyUseCase,
  validateGatewayRegistryRotatedKeyCandidate,
  MAX_GATEWAY_KEY_AUDIT_EVENTS,
  parseGatewayKeyAuditEventsResponse,
  resolveConfiguredGatewayApiKeyRuntime,
  parseGatewayKeyRegistryOverrideMutationRequest,
  parseGatewayKeyRegistryOverrideClearRequest,
  sha256Hex,
  toDynamicUniquenessComparableGatewayApiKeys,
  toGatewayAuditRecord,
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
  type GatewayKeyRegistryStoredDynamicKeyUpdateOptions,
  type GatewayKeyRegistryOverrideMutationRequest
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import { clearGatewayKeyRevocationOverlayState } from "./gateway-key-revocation.js";
import {
  REGISTRY_OBJECT_NAME,
  buildRegistryRequest,
  fetchParsedRegistryResponse,
  isGatewayKeyRegistryEnabled,
  requireDynamicGatewayKeyRegistryNamespace,
  requireGatewayKeyRegistryNamespace
} from "./gateway-key-registry-transport.js";
import type { DurableObjectStateLike } from "./durable-object-state.js";

const REGISTRY_KIND_OVERRIDE = "override";
const REGISTRY_KIND_DYNAMIC = "dynamic";
const REGISTRY_KIND_DYNAMIC_LIST = "dynamic_list";
const REGISTRY_KIND_DYNAMIC_LOOKUP = "dynamic_lookup";
const REGISTRY_KIND_DYNAMIC_BULK_CREATE = "dynamic_bulk_create";
const REGISTRY_KIND_DYNAMIC_BULK_UPDATE = "dynamic_bulk_update";
const REGISTRY_KIND_DYNAMIC_BULK_DELETE = "dynamic_bulk_delete";
const REGISTRY_KIND_DYNAMIC_BULK_ROTATE = "dynamic_bulk_rotate";
const REGISTRY_KIND_DYNAMIC_BULK_ROTATE_CANCEL = "dynamic_bulk_rotate_cancel";
const REGISTRY_KIND_DYNAMIC_BULK_ROTATE_FINALIZE =
  "dynamic_bulk_rotate_finalize";
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
const CONFIGURED_KEY_AUDIT_EVENTS_PREFIX = "configured_events:";
const CONFIGURED_KEY_OPERATION_INDEX_PREFIX = "configured_operation:";

interface GatewayKeyRegistryLookupRequest {
  bearerToken: string;
}

interface GatewayKeyRegistryOverrideMutationResult {
  override: GatewayKeyRegistryStoredOverride;
  auditEvent: GatewayKeyAuditEvent;
}

interface GatewayKeyRegistryOverrideClearMutationResult {
  auditEvent: GatewayKeyAuditEvent;
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

export class GatewayKeyRegistryDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? REGISTRY_KIND_OVERRIDE;
    const keyId = url.searchParams.get("keyId");
    const operationId =
      request.headers.get("x-airlock-request-id") ?? undefined;

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

      if (
        typeof body.bearerToken !== "string" ||
        body.bearerToken.length === 0
      ) {
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
        return new Response("Method not allowed", {
          status: keyId ? 405 : 400
        });
      }

      const dynamicEvents = await readStoredDynamicKeyAuditEvents(
        this.state.storage,
        keyId
      );
      const configuredEvents = await readStoredConfiguredKeyAuditEvents(
        this.state.storage,
        keyId
      );

      return Response.json({
        keyId,
        events: [...dynamicEvents, ...configuredEvents]
      } satisfies GatewayKeyAuditEventsResponse);
    }

    if (kind === REGISTRY_KIND_OPERATION_EVENTS) {
      const operationId = url.searchParams.get("operationId");

      if (request.method !== "GET" || !operationId) {
        return new Response("Method not allowed", {
          status: operationId ? 405 : 400
        });
      }

      const events = await readStoredDynamicKeyOperationEvents(
        this.state.storage,
        operationId
      );
      const configuredEvents = await readStoredConfiguredKeyOperationEvents(
        this.state.storage,
        operationId
      );
      const allEvents = [...events, ...configuredEvents];

      if (allEvents.length === 0) {
        return new Response("Not found", { status: 404 });
      }

      return Response.json({
        operationId,
        events: allEvents
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
      const transitionNow = new Date().toISOString();
      const updateTransitions = buildBulkUpdateGatewayRegistryKeyTransitions(
        nextKeys
          .filter((entry): entry is NonNullable<(typeof nextKeys)[number]> => {
            return entry !== null;
          })
          .map((entry) => {
            return {
              previousKey: entry.existingKey,
              nextKey: entry.nextKey
            };
          }),
        {
          ...(operationId ? { operationId } : {}),
          ...(bulkRequest.auditMetadata.reason
            ? { reason: bulkRequest.auditMetadata.reason }
            : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        dynamicKeys,
        transitionNow
      );
      const updatedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const transition of updateTransitions) {
        updatedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            transition.nextKey,
            dynamicKeys,
            undefined,
            transitionNow
          )
        );
      }

      for (const transition of updateTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
      const transitionNow = new Date().toISOString();
      const createTransitions = buildBulkCreateGatewayRegistryKeyTransitions(
        bulkRequest.keys,
        {
          ...(operationId ? { operationId } : {}),
          ...(bulkRequest.auditMetadata?.reason
            ? { reason: bulkRequest.auditMetadata.reason }
            : {}),
          ...(bulkRequest.actorContext
            ? toGatewayKeyAuditActorContextRecord(bulkRequest.actorContext)
            : {})
        },
        transitionNow
      );
      const createdKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const entry of createTransitions) {
        createdKeys.push(
          await createStoredDynamicKey(this.state.storage, entry.nextKey)
        );
      }

      for (const entry of createTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          entry.auditEvent
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
      const deleteEvents = buildBulkDeleteGatewayRegistryKeyAuditEvents(
        bulkRequest.keyIds.map((candidateKeyId) => {
          return existingKeysById.get(candidateKeyId)!;
        }),
        {
          ...(operationId ? { operationId } : {}),
          ...(bulkRequest.auditMetadata.reason
            ? { reason: bulkRequest.auditMetadata.reason }
            : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        occurredAt
      );

      for (const keyId of bulkRequest.keyIds) {
        await clearStoredDynamicKey(this.state.storage, keyId);
      }

      for (const event of deleteEvents) {
        await appendStoredDynamicKeyAuditEvent(this.state.storage, event);
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

      const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
        bulkRequest.auditMetadata
      );
      const transitionNow = new Date().toISOString();
      const rotateTransitions = buildBulkRotateGatewayRegistryKeyTransitions(
        rotationPlan
          .filter(
            (entry): entry is NonNullable<(typeof rotationPlan)[number]> => {
              return entry !== null;
            }
          )
          .map((entry) => {
            return {
              previousKey: entry.existingKey,
              valueHash: entry.entry.valueHash,
              ...(entry.entry.overlapSeconds !== undefined
                ? { overlapSeconds: entry.entry.overlapSeconds }
                : {})
            };
          }),
        {
          ...(operationId ? { operationId } : {}),
          ...(bulkRequest.auditMetadata.reason
            ? { reason: bulkRequest.auditMetadata.reason }
            : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        dynamicKeys,
        transitionNow
      );
      const updatedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const transition of rotateTransitions) {
        updatedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            transition.nextKey,
            dynamicKeys,
            transition.nextKey.previousValueHash &&
              transition.nextKey.previousValueHashExpiresAt
              ? undefined
              : { clearPreviousValueHash: true },
            transitionNow
          )
        );
      }

      for (const transition of rotateTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
        return new Response("Method not allowed", {
          status: keyId ? 405 : 400
        });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const payload = parseGatewayKeyRegistryRotateRequest(
        await request.json()
      );
      const transitionNow = new Date().toISOString();
      const transition = buildRotateGatewayRegistryKeyTransition(
        existingKey,
        payload,
        dynamicKeys,
        transitionNow
      );
      const key = await updateStoredDynamicKey(
        this.state.storage,
        transition.nextKey,
        dynamicKeys,
        transition.nextKey.previousValueHash &&
          transition.nextKey.previousValueHashExpiresAt
          ? undefined
          : { clearPreviousValueHash: true },
        transitionNow
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        transition.auditEvent
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", {
          status: keyId ? 405 : 400
        });
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
      const transitionNow = new Date().toISOString();
      const transition = buildFinalizeGatewayRegistryKeyRotationTransition(
        existingKey,
        {
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        transitionNow
      );
      const key = await updateStoredDynamicKey(
        this.state.storage,
        transition.nextKey,
        await listStoredDynamicKeys(this.state.storage),
        { clearPreviousValueHash: true },
        transitionNow
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        transition.auditEvent
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", {
          status: keyId ? 405 : 400
        });
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
      const transitionNow = new Date().toISOString();
      const transition = buildCancelGatewayRegistryKeyRotationTransition(
        existingKey,
        {
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        transitionNow
      );
      const key = await updateStoredDynamicKey(
        this.state.storage,
        transition.nextKey,
        await listStoredDynamicKeys(this.state.storage),
        { clearPreviousValueHash: true },
        transitionNow
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        transition.auditEvent
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
      const transitionNow = new Date().toISOString();
      const archiveTransitions = buildBulkArchiveGatewayRegistryKeyTransitions(
        bulkRequest.keyIds.map((candidateKeyId) => {
          return existingKeysById.get(candidateKeyId)!;
        }),
        {
          ...(operationId ? { operationId } : {}),
          ...(bulkRequest.auditMetadata.reason
            ? { reason: bulkRequest.auditMetadata.reason }
            : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        transitionNow
      );
      const archivedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const transition of archiveTransitions) {
        archivedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            transition.nextKey,
            dynamicKeys,
            undefined,
            transitionNow
          )
        );
      }

      for (const transition of archiveTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
      const transitionNow = new Date().toISOString();
      const restoreTransitions = buildBulkRestoreGatewayRegistryKeyTransitions(
        bulkRequest.keyIds.map((candidateKeyId) => {
          return existingKeysById.get(candidateKeyId)!;
        }),
        {
          ...(operationId ? { operationId } : {}),
          ...(bulkRequest.auditMetadata.reason
            ? { reason: bulkRequest.auditMetadata.reason }
            : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        transitionNow
      );
      const restoredKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const transition of restoreTransitions) {
        restoredKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            transition.nextKey,
            dynamicKeys,
            { clearArchivedAt: true },
            transitionNow
          )
        );
      }

      for (const transition of restoreTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
      const transitionNow = new Date().toISOString();
      const finalizeTransitions =
        buildBulkFinalizeGatewayRegistryKeyRotationTransitions(
          bulkRequest.keyIds.map((candidateKeyId) => {
            return existingKeysById.get(candidateKeyId)!;
          }),
          {
            ...(operationId ? { operationId } : {}),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          },
          transitionNow
        );
      const finalizedKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const transition of finalizeTransitions) {
        finalizedKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            transition.nextKey,
            dynamicKeys,
            { clearPreviousValueHash: true },
            transitionNow
          )
        );
      }

      for (const transition of finalizeTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
      const transitionNow = new Date().toISOString();
      const cancelTransitions =
        buildBulkCancelGatewayRegistryKeyRotationTransitions(
          bulkRequest.keyIds.map((candidateKeyId) => {
            return existingKeysById.get(candidateKeyId)!;
          }),
          {
            ...(operationId ? { operationId } : {}),
            ...(bulkRequest.auditMetadata.reason
              ? { reason: bulkRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          },
          transitionNow
        );
      const canceledKeys: GatewayKeyRegistryStoredDynamicKey[] = [];

      for (const transition of cancelTransitions) {
        canceledKeys.push(
          await updateStoredDynamicKey(
            this.state.storage,
            transition.nextKey,
            dynamicKeys,
            { clearPreviousValueHash: true },
            transitionNow
          )
        );
      }

      for (const transition of cancelTransitions) {
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
        return new Response("Method not allowed", {
          status: keyId ? 405 : 400
        });
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
      const transitionNow = new Date().toISOString();
      const transition = buildArchiveGatewayRegistryKeyTransition(
        existingKey,
        {
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        transitionNow
      );
      const key = await updateStoredDynamicKey(
        this.state.storage,
        transition.nextKey,
        await listStoredDynamicKeys(this.state.storage),
        undefined,
        transitionNow
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        transition.auditEvent
      );

      return Response.json({
        key: createGatewayKeyRegistryDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC_RESTORE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", {
          status: keyId ? 405 : 400
        });
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
      const transitionNow = new Date().toISOString();
      const transition = buildRestoreGatewayRegistryKeyTransition(
        existingKey,
        {
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext
            ? toGatewayKeyAuditActorContextRecord(actorContext)
            : {})
        },
        transitionNow
      );
      const key = await updateStoredDynamicKey(
        this.state.storage,
        transition.nextKey,
        await listStoredDynamicKeys(this.state.storage),
        { clearArchivedAt: true },
        transitionNow
      );
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        transition.auditEvent
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
        const transitionNow = new Date().toISOString();
        const transition = buildCreateGatewayRegistryKeyTransition(
          createRequest.key,
          {
            ...(createRequest.auditMetadata?.reason
              ? { reason: createRequest.auditMetadata.reason }
              : {}),
            ...(createRequest.actorContext
              ? toGatewayKeyAuditActorContextRecord(createRequest.actorContext)
              : {})
          },
          transitionNow
        );
        const key = await createStoredDynamicKey(
          this.state.storage,
          transition.nextKey
        );
        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
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
        const existingKey = await readStoredDynamicKey(
          this.state.storage,
          keyId
        );

        if (!existingKey) {
          return new Response("Not found", { status: 404 });
        }

        const updateRequest = parseGatewayKeyRegistryUpdateRequest(
          await request.json()
        );
        const actorContext = gatewayKeyAuditActorContextFromRegistryRequest(
          updateRequest.auditMetadata
        );
        const transitionNow = new Date().toISOString();
        const transition = buildUpdateGatewayRegistryKeyTransition(
          existingKey,
          applyGatewayApiKeyMetadataOverride(existingKey, updateRequest.update),
          {
            ...(updateRequest.auditMetadata.reason
              ? { reason: updateRequest.auditMetadata.reason }
              : {}),
            ...(actorContext
              ? toGatewayKeyAuditActorContextRecord(actorContext)
              : {})
          },
          await listStoredDynamicKeys(this.state.storage),
          transitionNow
        );
        const key = await updateStoredDynamicKey(
          this.state.storage,
          transition.nextKey,
          await listStoredDynamicKeys(this.state.storage),
          undefined,
          transitionNow
        );

        await appendStoredDynamicKeyAuditEvent(
          this.state.storage,
          transition.auditEvent
        );

        return Response.json({
          key: createGatewayKeyRegistryDynamicKeyView(key)
        } satisfies GatewayKeyRegistryDynamicKeyResponse);
      }

      if (request.method === "DELETE") {
        const existingKey = await readStoredDynamicKey(
          this.state.storage,
          keyId
        );
        const payload = request.headers
          .get("content-type")
          ?.includes("application/json")
          ? parseGatewayKeyRegistryDeleteRequest(await request.json())
          : {};
        const actorContext =
          gatewayKeyAuditActorContextFromRegistryRequest(payload);
        const deleted = await clearStoredDynamicKey(this.state.storage, keyId);

        if (!deleted) {
          return new Response("Not found", { status: 404 });
        }

        if (existingKey) {
          const occurredAt = new Date().toISOString();
          await appendStoredDynamicKeyAuditEvent(
            this.state.storage,
            buildDeleteGatewayRegistryKeyAuditEvent(
              existingKey,
              {
                ...(payload.reason ? { reason: payload.reason } : {}),
                ...(actorContext
                  ? toGatewayKeyAuditActorContextRecord(actorContext)
                  : {})
              },
              occurredAt
            )
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
      case "PUT": {
        const body: unknown = await request.json();
        const parsedRequest =
          parseGatewayKeyRegistryOverrideMutationRequest(body);
        const result = await writeStoredOverride(
          this.state.storage,
          keyId,
          parsedRequest.override,
          {
            ...(operationId ? { operationId } : {}),
            ...(parsedRequest.auditMetadata?.reason
              ? { reason: parsedRequest.auditMetadata.reason }
              : {}),
            ...(parsedRequest.auditMetadata?.actor
              ? {
                  actor: parsedRequest.auditMetadata.actor,
                  actorSource: parsedRequest.auditMetadata.actorSource
                }
              : {})
          }
        );
        await appendStoredConfiguredKeyAuditEvent(
          this.state.storage,
          result.auditEvent
        );

        return Response.json({
          keyId,
          override: result.override,
          events: [result.auditEvent]
        } satisfies GatewayKeyRegistryRecordResponse);
      }
      case "DELETE": {
        const body: unknown = request.headers
          .get("content-type")
          ?.includes("application/json")
          ? await request.json()
          : {};
        const parsedRequest = parseGatewayKeyRegistryOverrideClearRequest(body);
        const result = await clearStoredOverride(this.state.storage, keyId, {
          ...(operationId ? { operationId } : {}),
          ...(parsedRequest.auditMetadata?.reason
            ? { reason: parsedRequest.auditMetadata.reason }
            : {}),
          ...(parsedRequest.auditMetadata?.actor
            ? {
                actor: parsedRequest.auditMetadata.actor,
                actorSource: parsedRequest.auditMetadata.actorSource
              }
            : {})
        });
        await appendStoredConfiguredKeyAuditEvent(
          this.state.storage,
          result.auditEvent
        );

        return Response.json({
          keyId,
          override: null,
          events: [result.auditEvent]
        } satisfies GatewayKeyRegistryRecordResponse);
      }
      default:
        return new Response("Method not allowed", { status: 405 });
    }
  }
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
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_OVERRIDE, {
      method: "GET",
      keyId: gatewayApiKey.id
    }),
    requestId,
    {
      parse: (value) => {
        return parseGatewayKeyRegistryRecordResponse(value).override;
      }
    }
  );
}

export async function upsertGatewayKeyRegistryOverride(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  override: GatewayApiKeyMetadataOverride,
  requestId: string,
  audit?: {
    reason?: string;
    actorContext?: GatewayKeyAuditActorContext;
  }
): Promise<GatewayKeyRegistryOverrideMutationResult> {
  const namespace = requireGatewayKeyRegistryNamespace(env, requestId);
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_OVERRIDE, {
      method: "PUT",
      keyId: gatewayApiKey.id,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        override,
        auditMetadata: {
          ...(audit?.reason ? { reason: audit.reason } : {}),
          ...(audit?.actorContext
            ? toGatewayKeyAuditActorContextRecord(audit.actorContext)
            : {})
        }
      } satisfies GatewayKeyRegistryOverrideMutationRequest)
    }),
    requestId,
    {
      parse: (value) => {
        const parsed = parseGatewayKeyRegistryRecordResponse(value);

        if (!parsed.override) {
          throw new Error("Registry override write response was empty");
        }

        return {
          override: parsed.override,
          auditEvent:
            parsed.events?.find((event) => {
              return (
                event.kind === "override_updated" &&
                event.keyId === gatewayApiKey.id
              );
            }) ??
            createGatewayKeyAuditEvent({
              keyId: gatewayApiKey.id,
              kind: "override_updated",
              ownership: "configured",
              occurredAt: parsed.override.updatedAt,
              operationId: requestId,
              ...(audit?.reason ? { reason: audit.reason } : {}),
              ...(audit?.actorContext
                ? toGatewayKeyAuditActorContextRecord(audit.actorContext)
                : {}),
              changes: [
                {
                  field: "registryOverride",
                  after: parsed.override as unknown as Record<string, unknown>
                }
              ]
            })
        };
      }
    }
  );
}

export async function clearGatewayKeyRegistryOverride(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  audit?: {
    reason?: string;
    actorContext?: GatewayKeyAuditActorContext;
  }
): Promise<GatewayKeyRegistryOverrideClearMutationResult> {
  const namespace = requireGatewayKeyRegistryNamespace(env, requestId);
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_OVERRIDE, {
      method: "DELETE",
      keyId: gatewayApiKey.id,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        auditMetadata: {
          ...(audit?.reason ? { reason: audit.reason } : {}),
          ...(audit?.actorContext
            ? toGatewayKeyAuditActorContextRecord(audit.actorContext)
            : {})
        }
      })
    }),
    requestId,
    {
      parse: (value) => {
        const parsed = parseGatewayKeyRegistryRecordResponse(value);

        return {
          auditEvent:
            parsed.events?.find((event) => {
              return (
                event.kind === "override_cleared" &&
                event.keyId === gatewayApiKey.id
              );
            }) ??
            createGatewayKeyAuditEvent({
              keyId: gatewayApiKey.id,
              kind: "override_cleared",
              ownership: "configured",
              occurredAt: new Date().toISOString(),
              operationId: requestId,
              ...(audit?.reason ? { reason: audit.reason } : {}),
              ...(audit?.actorContext
                ? toGatewayKeyAuditActorContextRecord(audit.actorContext)
                : {}),
              changes: [
                {
                  field: "registryOverride",
                  after: null
                }
              ]
            })
        };
      }
    }
  );
}

export async function createGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return createGatewayRegistryKeyUseCase(payload, requestId, {
    listComparableKeysForCreate: async () => {
      const existingDynamicKeys = await listGatewayRegistryApiKeys(
        env,
        requestId
      );
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
        buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            ...createRequest.key,
            ...(createRequest.auditMetadata?.reason
              ? { reason: createRequest.auditMetadata.reason }
              : {}),
            ...((actorContext ?? createRequest.actorContext)
              ? toGatewayKeyAuditActorContextRecord(
                  actorContext ?? createRequest.actorContext!
                )
              : {})
          } satisfies GatewayKeyRegistryCreateRequest)
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Created dynamic key response was empty");
            }

            return key;
          }
        }
      );
    }
  });
}

export async function bulkCreateGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryBulkCreateResponse> {
  return bulkCreateGatewayRegistryKeysUseCase(payload, requestId, {
    listComparableKeysForCreate: async () => {
      const existingDynamicKeys = await listGatewayRegistryApiKeys(
        env,
        requestId
      );
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
        buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_BULK_CREATE, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            keys: createRequest.keys,
            ...(createRequest.auditMetadata?.reason
              ? { reason: createRequest.auditMetadata.reason }
              : {}),
            ...((actorContext ?? createRequest.actorContext)
              ? toGatewayKeyAuditActorContextRecord(
                  actorContext ?? createRequest.actorContext!
                )
              : {})
          } satisfies {
            keys: GatewayApiKeyRecord[];
            actor?: string;
            actorSource?: "payload" | "trusted_header" | "credential";
          })
        }),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryBulkCreateResponse(value);
          }
        }
      );
    }
  });
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
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
      method: "GET",
      keyId
    }),
    requestId,
    {
      parse: (value) => {
        return parseGatewayKeyRegistryDynamicKeyResponse(value);
      },
      handleStatus: (response) => {
        if (response.status === 404) {
          return null;
        }

        return undefined;
      }
    }
  );
}

export async function deleteGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<void> {
  await deleteGatewayRegistryKeyUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      await fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            const parsed = parseGatewayKeyRegistryDeleteResponse(value);

            if (!parsed.deleted) {
              throw new Error("Dynamic key delete was not acknowledged");
            }

            return parsed;
          }
        }
      );
    }
  });
}

export async function updateGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return updateGatewayRegistryKeyUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Updated dynamic key response was empty");
            }

            return key;
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkUpdateGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkUpdateGatewayRegistryKeysUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryDynamicKeyListResponse(value);
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkDeleteGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryBulkDeleteResponse> {
  return bulkDeleteGatewayRegistryKeysUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryBulkDeleteResponse(value);
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkRotateGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkRotateGatewayRegistryKeysUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryDynamicKeyListResponse(value);
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkArchiveGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkArchiveGatewayRegistryKeysUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryDynamicKeyListResponse(value);
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            if (response.status === 409) {
              throw createGatewayKeyAlreadyArchivedError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkRestoreGatewayRegistryApiKeys(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkRestoreGatewayRegistryKeysUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryDynamicKeyListResponse(value);
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            if (response.status === 409) {
              throw createGatewayKeyNotArchivedError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkFinalizeGatewayRegistryApiKeyRotations(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkFinalizeGatewayRegistryKeyRotationsUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        ),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryDynamicKeyListResponse(value);
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            if (response.status === 409) {
              throw createGatewayKeyRotationNotStagedError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function bulkCancelGatewayRegistryApiKeyRotations(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyListResponse> {
  return bulkCancelGatewayRegistryKeyRotationsUseCase(payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        ),
        requestId,
        {
          parse: (value) => {
            return parseGatewayKeyRegistryDynamicKeyListResponse(value);
          },
          handleStatus: async (response) => {
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

            return undefined;
          }
        }
      );
    }
  });
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
  const url = new URL("https://airlock.internal/gateway-key-registry");
  url.searchParams.set("kind", REGISTRY_KIND_OPERATION_EVENTS);
  url.searchParams.set("operationId", operationId);
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    new Request(url, {
      method: "GET",
      headers: {
        "x-airlock-request-id": requestId
      }
    }),
    requestId,
    {
      parse: (value) => {
        return parseGatewayKeyOperationEventsResponse(value).events;
      },
      handleStatus: (response) => {
        if (response.status === 404) {
          throw createGatewayKeyNotFoundError(requestId);
        }

        return undefined;
      }
    }
  );
}

export async function listGatewayRegistryApiKeys(
  env: GatewayBindings,
  requestId: string
): Promise<GatewayKeyRegistryDynamicKeyView[]> {
  if (!isGatewayKeyRegistryEnabled(env)) {
    return [];
  }

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_LIST, {
      method: "GET"
    }),
    requestId,
    {
      parse: (value) => {
        return parseGatewayKeyRegistryDynamicKeyListResponse(value).keys;
      }
    }
  );
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
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_EVENTS, {
      method: "GET",
      keyId
    }),
    requestId,
    {
      parse: (value) => {
        return parseGatewayKeyAuditEventsResponse(value).events;
      }
    }
  );
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
  return fetchParsedRegistryResponse(
    () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
    buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_LOOKUP, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        bearerToken
      } satisfies GatewayKeyRegistryLookupRequest)
    }),
    requestId,
    {
      parse: (value) => {
        const key = parseGatewayKeyRegistryDynamicKeyResponse(value);
        return key?.key;
      }
    }
  );
}

export async function rotateGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return rotateGatewayRegistryKeyUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Rotated dynamic key response was empty");
            }

            return key;
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function finalizeGatewayRegistryApiKeyRotation(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return finalizeGatewayRegistryKeyRotationUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
        buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE, {
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
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Finalized dynamic key response was empty");
            }

            return key;
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            if (response.status === 409) {
              throw createGatewayKeyRotationNotStagedError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function cancelGatewayRegistryApiKeyRotation(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return cancelGatewayRegistryKeyRotationUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
        buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL, {
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
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Canceled dynamic key response was empty");
            }

            return key;
          },
          handleStatus: async (response) => {
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

            return undefined;
          }
        }
      );
    }
  });
}

export async function archiveGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return archiveGatewayRegistryKeyUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Archived dynamic key response was empty");
            }

            return key;
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            if (response.status === 409) {
              throw createGatewayKeyAlreadyArchivedError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
}

export async function restoreGatewayRegistryApiKey(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  return restoreGatewayRegistryKeyUseCase(keyId, payload, requestId, {
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
      const namespace = requireDynamicGatewayKeyRegistryNamespace(
        env,
        requestId
      );
      return fetchParsedRegistryResponse(
        () => namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME)),
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
        }),
        requestId,
        {
          parse: (value) => {
            const key = parseGatewayKeyRegistryDynamicKeyResponse(value);

            if (!key) {
              throw new Error("Restored dynamic key response was empty");
            }

            return key;
          },
          handleStatus: (response) => {
            if (response.status === 404) {
              throw createGatewayKeyNotFoundError(requestId);
            }

            if (response.status === 409) {
              throw createGatewayKeyNotArchivedError(requestId);
            }

            return undefined;
          }
        }
      );
    }
  });
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
  override: GatewayApiKeyMetadataOverride,
  metadata?: {
    operationId?: string;
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  }
): Promise<GatewayKeyRegistryOverrideMutationResult> {
  const previous = await readStoredOverride(storage, keyId);
  const next = {
    ...override,
    updatedAt: new Date().toISOString()
  };

  await storage.put(`registry:${keyId}`, next);

  return {
    override: next,
    auditEvent: createGatewayKeyAuditEvent({
      keyId,
      kind: "override_updated",
      ownership: "configured",
      occurredAt: next.updatedAt,
      ...(metadata?.operationId ? { operationId: metadata.operationId } : {}),
      ...(metadata?.reason ? { reason: metadata.reason } : {}),
      ...(metadata?.actor
        ? {
            actor: metadata.actor,
            actorSource: metadata.actorSource
          }
        : {}),
      changes: [
        {
          field: "registryOverride",
          ...(previous
            ? {
                before: toGatewayAuditRecord(previous)
              }
            : {}),
          after: toGatewayAuditRecord(next)
        }
      ]
    })
  };
}

async function clearStoredOverride(
  storage: DurableObjectStateLike["storage"],
  keyId: string,
  metadata?: {
    operationId?: string;
    reason?: string;
    actor?: string;
    actorSource?: "payload" | "trusted_header" | "credential";
  }
): Promise<GatewayKeyRegistryOverrideClearMutationResult> {
  const previous = await readStoredOverride(storage, keyId);
  await storage.delete(`registry:${keyId}`);

  return {
    auditEvent: createGatewayKeyAuditEvent({
      keyId,
      kind: "override_cleared",
      ownership: "configured",
      occurredAt: new Date().toISOString(),
      ...(metadata?.operationId ? { operationId: metadata.operationId } : {}),
      ...(metadata?.reason ? { reason: metadata.reason } : {}),
      ...(metadata?.actor
        ? {
            actor: metadata.actor,
            actorSource: metadata.actorSource
          }
        : {}),
      changes: [
        {
          field: "registryOverride",
          ...(previous
            ? {
                before: toGatewayAuditRecord(previous)
              }
            : {}),
          after: null
        }
      ]
    })
  };
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
  return findDynamicKeyByValueHash(keys, valueHash, Date.now()) ?? null;
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
  options?: GatewayKeyRegistryStoredDynamicKeyUpdateOptions,
  now?: string
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
    options,
    now
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
  const value = await storage.get<unknown>(
    `${DYNAMIC_KEY_AUDIT_EVENTS_PREFIX}${keyId}`
  );

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

async function readStoredConfiguredKeyAuditEvents(
  storage: DurableObjectStateLike["storage"],
  keyId: string
): Promise<GatewayKeyAuditEvent[]> {
  const value = await storage.get<unknown>(
    `${CONFIGURED_KEY_AUDIT_EVENTS_PREFIX}${keyId}`
  );

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Registry configured key audit events are invalid");
  }

  return value.map((entry) => {
    const parsedEvent = parseGatewayKeyAuditEventsResponse({
      keyId,
      events: [entry]
    }).events[0];

    if (!parsedEvent) {
      throw new Error("Registry configured key audit event is missing");
    }

    return createGatewayKeyAuditEvent(parsedEvent);
  });
}

async function appendStoredDynamicKeyAuditEvent(
  storage: DurableObjectStateLike["storage"],
  event: GatewayKeyAuditEvent
): Promise<void> {
  const events = await readStoredDynamicKeyAuditEvents(storage, event.keyId);

  await storage.put(
    `${DYNAMIC_KEY_AUDIT_EVENTS_PREFIX}${event.keyId}`,
    [...events, createGatewayKeyAuditEvent(event)].slice(
      -MAX_GATEWAY_KEY_AUDIT_EVENTS
    )
  );

  if (event.operationId) {
    const operationKey = `${DYNAMIC_KEY_OPERATION_INDEX_PREFIX}${event.operationId}`;
    const existingKeyIds = (await storage.get<unknown>(operationKey)) as
      | string[]
      | undefined;
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

async function appendStoredConfiguredKeyAuditEvent(
  storage: DurableObjectStateLike["storage"],
  event: GatewayKeyAuditEvent
): Promise<void> {
  const events = await readStoredConfiguredKeyAuditEvents(storage, event.keyId);

  await storage.put(
    `${CONFIGURED_KEY_AUDIT_EVENTS_PREFIX}${event.keyId}`,
    [...events, createGatewayKeyAuditEvent(event)].slice(
      -MAX_GATEWAY_KEY_AUDIT_EVENTS
    )
  );

  if (event.operationId) {
    const operationKey = `${CONFIGURED_KEY_OPERATION_INDEX_PREFIX}${event.operationId}`;
    const existingKeyIds = (await storage.get<unknown>(operationKey)) as
      | string[]
      | undefined;
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

  if (
    !Array.isArray(rawKeyIds) ||
    !rawKeyIds.every((entry) => typeof entry === "string")
  ) {
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

async function readStoredConfiguredKeyOperationEvents(
  storage: DurableObjectStateLike["storage"],
  operationId: string
): Promise<GatewayKeyAuditEvent[]> {
  const rawKeyIds = await storage.get<unknown>(
    `${CONFIGURED_KEY_OPERATION_INDEX_PREFIX}${operationId}`
  );

  if (rawKeyIds === undefined) {
    return [];
  }

  if (
    !Array.isArray(rawKeyIds) ||
    !rawKeyIds.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Registry configured key operation index is invalid");
  }

  const perKeyEvents = await Promise.all(
    rawKeyIds.map(async (keyId) => {
      return readStoredConfiguredKeyAuditEvents(storage, keyId);
    })
  );

  return perKeyEvents.flat().filter((event) => {
    return event.operationId === operationId;
  });
}
