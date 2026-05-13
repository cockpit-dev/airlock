import {
  applyGatewayApiKeyMetadataOverride,
  parseGatewayApiKeyMetadataOverride,
  parseGatewayDynamicApiKeyRecord,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";
import {
  createGatewayKeyAuditEvent,
  MAX_GATEWAY_KEY_AUDIT_EVENTS,
  parseOptionalGatewayKeyAuditActor,
  parseOptionalGatewayKeyAuditActorSource,
  parseOptionalGatewayKeyAuditReason,
  parseGatewayKeyAuditEventsResponse,
  type GatewayKeyAuditActorContext,
  type GatewayKeyAuditEvent,
  type GatewayKeyAuditEventsResponse
} from "./gateway-key-audit.js";
import { clearGatewayKeyRevocationOverlayState } from "./gateway-key-revocation.js";

const REGISTRY_OBJECT_NAME = "gateway-key-registry";
const REGISTRY_KIND_OVERRIDE = "override";
const REGISTRY_KIND_DYNAMIC = "dynamic";
const REGISTRY_KIND_DYNAMIC_LIST = "dynamic_list";
const REGISTRY_KIND_DYNAMIC_LOOKUP = "dynamic_lookup";
const REGISTRY_KIND_DYNAMIC_ROTATE = "dynamic_rotate";
const REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE = "dynamic_rotate_finalize";
const REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL = "dynamic_rotate_cancel";
const REGISTRY_KIND_EVENTS = "events";
const DYNAMIC_KEY_INDEX = "dynamic:index";
const DYNAMIC_KEY_AUDIT_EVENTS_PREFIX = "dynamic_events:";

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean | void>;
  };
}

interface GatewayKeyRegistryStoredOverride extends GatewayApiKeyMetadataOverride {
  updatedAt: string;
}

export interface GatewayKeyRegistryDynamicKeyView {
  keyId: string;
  ownership: "registry";
  key: GatewayApiKeyRecord;
  previousValueHash?: string;
  previousValueHashExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface GatewayKeyRegistryStoredDynamicKey extends GatewayApiKeyRecord {
  valueHash: string;
  previousValueHash?: string;
  previousValueHashExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface GatewayKeyRegistryRecordResponse {
  keyId: string;
  override: GatewayKeyRegistryStoredOverride | null;
}

interface GatewayKeyRegistryDynamicKeyResponse {
  key: GatewayKeyRegistryDynamicKeyView | null;
}

interface GatewayKeyRegistryDynamicKeyListResponse {
  keys: GatewayKeyRegistryDynamicKeyView[];
}

interface GatewayKeyRegistryDeleteResponse {
  keyId: string;
  deleted: boolean;
}

interface GatewayKeyRegistryLookupRequest {
  bearerToken: string;
}

interface GatewayKeyRegistryCreateRequest extends GatewayApiKeyRecord {
  actor?: string;
  actorSource?: "payload" | "trusted_header" | "credential";
}

interface GatewayKeyRegistryRotateRequest {
  valueHash: string;
  overlapSeconds?: number;
  reason?: string;
  actor?: string;
  actorSource?: "payload" | "trusted_header" | "credential";
}

interface GatewayKeyRegistryRotationActionRequest {
  reason?: string;
  actor?: string;
  actorSource?: "payload" | "trusted_header" | "credential";
}

interface GatewayKeyRegistryDeleteRequest {
  reason?: string;
  actor?: string;
  actorSource?: "payload" | "trusted_header" | "credential";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
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

function createGatewayKeyNotRegistryOwnedError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is not registry owned", {
    code: "gateway_key_not_registry_owned",
    category: "governance",
    httpStatus: 409,
    retryable: false,
    requestId
  });
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

function parseStoredOverride(value: unknown): GatewayKeyRegistryStoredOverride {
  if (!isRecord(value)) {
    throw new Error("Registry override must be an object");
  }

  const { updatedAt, ...overrideValue } = value;

  if (typeof updatedAt !== "string" || !isValidTimestamp(updatedAt)) {
    throw new Error("Registry override updatedAt must be a valid timestamp");
  }

  return {
    ...parseGatewayApiKeyMetadataOverride(overrideValue),
    updatedAt
  };
}

function parseStoredDynamicKey(value: unknown): GatewayKeyRegistryStoredDynamicKey {
  if (!isRecord(value)) {
    throw new Error("Registry dynamic key must be an object");
  }

  const record = parseGatewayDynamicApiKeyRecord(value);
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  const previousValueHash =
    typeof value.previousValueHash === "string"
      ? value.previousValueHash.trim().toLowerCase()
      : undefined;
  const previousValueHashExpiresAt =
    typeof value.previousValueHashExpiresAt === "string"
      ? value.previousValueHashExpiresAt
      : undefined;

  if (
    typeof createdAt !== "string" ||
    !isValidTimestamp(createdAt) ||
    typeof updatedAt !== "string" ||
    !isValidTimestamp(updatedAt)
  ) {
    throw new Error("Registry dynamic key timestamps are invalid");
  }

  if (
    previousValueHash !== undefined &&
    previousValueHash.length > 0 &&
    !/^[a-f0-9]{64}$/.test(previousValueHash)
  ) {
    throw new Error("Registry dynamic key previousValueHash is invalid");
  }

  if (
    previousValueHashExpiresAt !== undefined &&
    !isValidTimestamp(previousValueHashExpiresAt)
  ) {
    throw new Error("Registry dynamic key previousValueHashExpiresAt is invalid");
  }

  return {
    ...record,
    valueHash: record.valueHash!,
    ...(previousValueHash ? { previousValueHash } : {}),
    ...(previousValueHashExpiresAt
      ? { previousValueHashExpiresAt }
      : {}),
    createdAt,
    updatedAt
  };
}

function toDynamicKeyView(
  key: GatewayKeyRegistryStoredDynamicKey
): GatewayKeyRegistryDynamicKeyView {
  return {
    keyId: key.id,
    ownership: "registry",
    key: {
      id: key.id,
      label: key.label,
      valueHash: key.valueHash,
      status: key.status,
      ...(key.notBefore ? { notBefore: key.notBefore } : {}),
      ...(key.expiresAt ? { expiresAt: key.expiresAt } : {}),
      ...(key.policy ? { policy: key.policy } : {})
    },
    ...(key.previousValueHash ? { previousValueHash: key.previousValueHash } : {}),
    ...(key.previousValueHashExpiresAt
      ? { previousValueHashExpiresAt: key.previousValueHashExpiresAt }
      : {}),
    createdAt: key.createdAt,
    updatedAt: key.updatedAt
  };
}

function parseDynamicKeyView(value: unknown): GatewayKeyRegistryDynamicKeyView {
  if (!isRecord(value) || typeof value.keyId !== "string") {
    throw new Error("Registry dynamic key view must include keyId");
  }

  const key = parseGatewayDynamicApiKeyRecord(value.key);
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;

  if (
    typeof createdAt !== "string" ||
    !isValidTimestamp(createdAt) ||
    typeof updatedAt !== "string" ||
    !isValidTimestamp(updatedAt)
  ) {
    throw new Error("Registry dynamic key timestamps are invalid");
  }

  return {
    keyId: value.keyId,
    ownership: "registry",
    key,
    ...(typeof value.previousValueHash === "string"
      ? { previousValueHash: value.previousValueHash }
      : {}),
    ...(typeof value.previousValueHashExpiresAt === "string"
      ? { previousValueHashExpiresAt: value.previousValueHashExpiresAt }
      : {}),
    createdAt,
    updatedAt
  };
}

function parseRegistryResponse(value: unknown): GatewayKeyRegistryRecordResponse {
  if (!isRecord(value) || typeof value.keyId !== "string") {
    throw new Error("Registry response must include a key id");
  }

  if (value.override !== null && value.override !== undefined) {
    return {
      keyId: value.keyId,
      override: parseStoredOverride(value.override)
    };
  }

  return {
    keyId: value.keyId,
    override: null
  };
}

function parseDynamicKeyResponse(
  value: unknown
): GatewayKeyRegistryDynamicKeyView | null {
  if (!isRecord(value) || !("key" in value)) {
    throw new Error("Registry dynamic key response must include key");
  }

  if (value.key === null) {
    return null;
  }

  return parseDynamicKeyView(value.key);
}

function parseDynamicKeyListResponse(
  value: unknown
): GatewayKeyRegistryDynamicKeyView[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    throw new Error("Registry dynamic key list response must include keys");
  }

  return value.keys.map((entry) => {
    return parseDynamicKeyView(entry);
  });
}

function parseDeleteResponse(value: unknown): GatewayKeyRegistryDeleteResponse {
  if (
    !isRecord(value) ||
    typeof value.keyId !== "string" ||
    typeof value.deleted !== "boolean"
  ) {
    throw new Error("Registry delete response is invalid");
  }

  return {
    keyId: value.keyId,
    deleted: value.deleted
  };
}

function parseRotateRequest(value: unknown): GatewayKeyRegistryRotateRequest {
  if (!isRecord(value) || typeof value.valueHash !== "string") {
    throw new GatewayError("Gateway dynamic key rotation payload is invalid", {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  const record = parseGatewayDynamicApiKeyRecord({
    id: "rotation_payload",
    label: "Rotation Payload",
    valueHash: value.valueHash,
    status: "active"
  });

  return {
    valueHash: record.valueHash!,
    ...(value.overlapSeconds !== undefined
      ? {
          overlapSeconds: parseOverlapSecondsPayload(
            value.overlapSeconds,
            "Gateway dynamic key rotation payload is invalid"
          )
        }
      : {}),
    ...(value.reason !== undefined
      ? {
          reason: parseReasonPayload(
            value.reason,
            "Gateway dynamic key rotation payload is invalid"
          )
        }
      : {}),
    ...(value.actor !== undefined
      ? {
          ...toActorContextRecord(
            parseActorPayload(
              value.actor,
              "actorSource" in value ? value.actorSource : undefined,
              "Gateway dynamic key rotation payload is invalid"
            )
          )
        }
      : {})
  };
}

function parseCreateRequest(
  value: unknown,
  existingGatewayApiKeys: readonly GatewayApiKeyRecord[]
): {
  key: GatewayApiKeyRecord;
  actorContext?: GatewayKeyAuditActorContext;
} {
  const key = parseGatewayDynamicApiKeyRecord(
    stripActorMetadata(value),
    existingGatewayApiKeys
  );

  if (!isRecord(value) || value.actor === undefined) {
    return { key };
  }

  return {
    key,
    actorContext: parseActorPayload(
      value.actor,
      "actorSource" in value ? value.actorSource : undefined,
      "Gateway dynamic key create payload is invalid"
    )
  };
}

function parseDeleteRequest(value: unknown): GatewayKeyRegistryDeleteRequest {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new GatewayError("Gateway dynamic key delete payload is invalid", {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  return {
    ...(value.reason !== undefined
      ? {
          reason: parseReasonPayload(
            value.reason,
            "Gateway dynamic key delete payload is invalid"
          )
        }
      : {}),
    ...(value.actor !== undefined
      ? {
          ...toActorContextRecord(
            parseActorPayload(
              value.actor,
              "actorSource" in value ? value.actorSource : undefined,
              "Gateway dynamic key delete payload is invalid"
            )
          )
        }
      : {})
  };
}

function parseRotationActionRequest(
  value: unknown,
  message: string
): GatewayKeyRegistryRotationActionRequest {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  return {
    ...(value.reason !== undefined
      ? {
          reason: parseReasonPayload(value.reason, message)
        }
      : {}),
    ...(value.actor !== undefined
      ? {
          ...toActorContextRecord(
            parseActorPayload(
              value.actor,
              "actorSource" in value ? value.actorSource : undefined,
              message
            )
          )
        }
      : {})
  };
}

function parseReasonPayload(value: unknown, message: string): string {
  try {
    const reason = parseOptionalGatewayKeyAuditReason(value);

    if (!reason) {
      throw new Error("Reason is missing");
    }

    return reason;
  } catch (cause) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false,
      cause
    });
  }
}

function parseOverlapSecondsPayload(value: unknown, message: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3600
  ) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false
    });
  }

  return value;
}

function parseActorPayload(
  value: unknown,
  actorSource: unknown,
  message: string
): GatewayKeyAuditActorContext {
  try {
    const actor = parseOptionalGatewayKeyAuditActor(value);

    if (!actor) {
      throw new Error("Actor is missing");
    }

    return {
      actor,
      actorSource:
        parseOptionalGatewayKeyAuditActorSource(actorSource) ?? "payload"
    };
  } catch (cause) {
    throw new GatewayError(message, {
      code: "config_invalid_gateway_api_keys",
      category: "configuration",
      httpStatus: 400,
      retryable: false,
      cause
    });
  }
}

function toActorContextRecord(
  actorContext: GatewayKeyAuditActorContext
): { actor: string; actorSource: "payload" | "trusted_header" | "credential" } {
  return {
    actor: actorContext.actor,
    actorSource: actorContext.actorSource
  };
}

function actorContextFromRequest(
  request:
    | GatewayKeyRegistryCreateRequest
    | GatewayKeyRegistryRotateRequest
    | GatewayKeyRegistryRotationActionRequest
    | GatewayKeyRegistryDeleteRequest
): GatewayKeyAuditActorContext | undefined {
  if (!request.actor) {
    return undefined;
  }

  return {
    actor: request.actor,
    actorSource: request.actorSource ?? "payload"
  };
}

function stripActorMetadata(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const rest = { ...value };
  delete rest.actor;
  delete rest.actorSource;
  return rest;
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
  if (gatewayApiKey.policy?.requestQuota && !env.AIRLOCK_GATEWAY_KEY_QUOTA) {
    throw new GatewayError("Gateway key quota binding is required", {
      code: "config_missing_gateway_key_quota",
      category: "configuration",
      httpStatus: 500,
      retryable: false,
      requestId
    });
  }

  if (
    gatewayApiKey.policy?.tokenQuota &&
    !env.AIRLOCK_GATEWAY_KEY_TOKEN_QUOTA
  ) {
    throw new GatewayError("Gateway key token quota binding is required", {
      code: "config_missing_gateway_key_token_quota",
      category: "configuration",
      httpStatus: 500,
      retryable: false,
      requestId
    });
  }

  if (
    gatewayApiKey.policy?.concurrencyQuota &&
    !env.AIRLOCK_GATEWAY_KEY_CONCURRENCY
  ) {
    throw new GatewayError("Gateway key concurrency binding is required", {
      code: "config_missing_gateway_key_concurrency",
      category: "configuration",
      httpStatus: 500,
      retryable: false,
      requestId
    });
  }
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

export class GatewayKeyRegistryDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? REGISTRY_KIND_OVERRIDE;
    const keyId = url.searchParams.get("keyId");

    if (kind === REGISTRY_KIND_DYNAMIC_LIST) {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      return Response.json({
        keys: (await listStoredDynamicKeys(this.state.storage)).map((key) => {
          return toDynamicKeyView(key);
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
        key: key ? toDynamicKeyView(key) : null
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

    if (kind === REGISTRY_KIND_DYNAMIC_ROTATE) {
      if (request.method !== "POST" || !keyId) {
        return new Response("Method not allowed", { status: keyId ? 405 : 400 });
      }

      const existingKey = await readStoredDynamicKey(this.state.storage, keyId);

      if (!existingKey) {
        return new Response("Not found", { status: 404 });
      }

      const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
      const payload = parseRotateRequest(await request.json());
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
      const actorContext = actorContextFromRequest(payload);
      await appendStoredDynamicKeyAuditEvent(
        this.state.storage,
        createGatewayKeyAuditEvent({
          keyId: key.id,
          kind: "rotated",
          ownership: "registry",
          occurredAt: key.updatedAt,
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext ? toActorContextRecord(actorContext) : {})
        })
      );

      return Response.json({
        key: toDynamicKeyView(key)
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

      const payload = parseRotationActionRequest(
        await request.json(),
        "Gateway dynamic key rotation finalize payload is invalid"
      );
      const actorContext = actorContextFromRequest(payload);
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
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext ? toActorContextRecord(actorContext) : {})
        })
      );

      return Response.json({
        key: toDynamicKeyView(key)
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

      const payload = parseRotationActionRequest(
        await request.json(),
        "Gateway dynamic key rotation cancel payload is invalid"
      );
      const actorContext = actorContextFromRequest(payload);
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
          ...(payload.reason ? { reason: payload.reason } : {}),
          ...(actorContext ? toActorContextRecord(actorContext) : {})
        })
      );

      return Response.json({
        key: toDynamicKeyView(key)
      } satisfies GatewayKeyRegistryDynamicKeyResponse);
    }

    if (kind === REGISTRY_KIND_DYNAMIC) {
      if (request.method === "POST") {
        const dynamicKeys = await listStoredDynamicKeys(this.state.storage);
        const createRequest = parseCreateRequest(await request.json(), dynamicKeys);
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
              ? toActorContextRecord(createRequest.actorContext)
              : {})
          })
        );

        return Response.json({
          key: toDynamicKeyView(key)
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
          key: toDynamicKeyView(key)
        } satisfies GatewayKeyRegistryDynamicKeyResponse);
      }

      if (request.method === "DELETE") {
        const existingKey = await readStoredDynamicKey(this.state.storage, keyId);
        const payload =
          request.headers.get("content-type")?.includes("application/json")
            ? parseDeleteRequest(await request.json())
            : {};
        const actorContext = actorContextFromRequest(payload);
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
              ...(actorContext ? toActorContextRecord(actorContext) : {})
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
    const parsed = parseRegistryResponse(await response.json());
    return parsed.override;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function upsertGatewayKeyRegistryOverride(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  payload: unknown,
  requestId: string
): Promise<GatewayKeyRegistryStoredOverride> {
  const namespace = requireGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  const override = parseGatewayApiKeyMetadataOverride(payload);
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

  const parsed = parseRegistryResponse(await response.json());

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
  const existingDynamicKeys = await listGatewayRegistryApiKeys(env, requestId);
  const createRequest = parseCreateRequest(payload, [
    ...configuredGatewayApiKeys,
    ...existingDynamicKeys.map((entry) => {
      return entry.key;
    })
  ]);
  const gatewayApiKey = createRequest.key;
  assertGatewayKeyRuntimeDependencies(env, gatewayApiKey, requestId);
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
          ...gatewayApiKey,
          ...(actorContext ?? createRequest.actorContext
            ? toActorContextRecord(actorContext ?? createRequest.actorContext!)
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
    const key = parseDynamicKeyResponse(await response.json());

    if (!key) {
      throw new Error("Created dynamic key response was empty");
    }

    return key;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
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
    return parseDynamicKeyResponse(await response.json());
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
  if (configuredGatewayApiKeys.some((gatewayApiKey) => gatewayApiKey.id === keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  const existingKey = await getGatewayRegistryApiKey(env, keyId, requestId);

  if (!existingKey) {
    throw createGatewayKeyNotFoundError(requestId);
  }

  const deleteRequest = parseDeleteRequest(payload);

  await clearGatewayKeyRevocationOverlayState(
    env,
    existingKey.key,
    requestId
  );

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC, {
        method: "DELETE",
        keyId,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...deleteRequest,
          ...(actorContext ? toActorContextRecord(actorContext) : {})
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
    const parsed = parseDeleteResponse(await response.json());

    if (!parsed.deleted) {
      throw new Error("Dynamic key delete was not acknowledged");
    }
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
    return parseDynamicKeyListResponse(await response.json());
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
    const key = parseDynamicKeyResponse(await response.json());
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
  if (configuredGatewayApiKeys.some((gatewayApiKey) => gatewayApiKey.id === keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  const rotateRequest = parseRotateRequest(payload);

  const existingKey = await getGatewayRegistryApiKey(env, keyId, requestId);

  if (!existingKey) {
    throw createGatewayKeyNotFoundError(requestId);
  }
  const rotatedGatewayApiKey = parseGatewayDynamicApiKeyRecord(
    {
      ...existingKey.key,
      valueHash: rotateRequest.valueHash
    },
    [
      ...configuredGatewayApiKeys,
      ...(await listGatewayRegistryApiKeys(env, requestId))
        .filter((entry) => entry.keyId !== keyId)
        .map((entry) => {
          return entry.key;
        })
    ]
  );
  assertGatewayKeyRuntimeDependencies(env, rotatedGatewayApiKey, requestId);
  await clearGatewayKeyRevocationOverlayState(
    env,
    existingKey.key,
    requestId
  );

  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ROTATE, {
        method: "POST",
        keyId,
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
            ? toActorContextRecord(actorContext)
            : rotateRequest.actor
              ? toActorContextRecord(actorContextFromRequest(rotateRequest)!)
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
    const key = parseDynamicKeyResponse(await response.json());

    if (!key) {
      throw new Error("Rotated dynamic key response was empty");
    }

    return key;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function finalizeGatewayRegistryApiKeyRotation(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (configuredGatewayApiKeys.some((gatewayApiKey) => gatewayApiKey.id === keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  const actionRequest = parseRotationActionRequest(
    payload,
    "Gateway dynamic key rotation finalize payload is invalid"
  );
  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ROTATE_FINALIZE, {
        method: "POST",
        keyId,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...actionRequest,
          ...(actorContext ? toActorContextRecord(actorContext) : {})
        } satisfies GatewayKeyRegistryRotationActionRequest)
      })
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
    const key = parseDynamicKeyResponse(await response.json());

    if (!key) {
      throw new Error("Finalized dynamic key response was empty");
    }

    return key;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function cancelGatewayRegistryApiKeyRotation(
  env: GatewayBindings,
  configuredGatewayApiKeys: readonly GatewayApiKeyRecord[],
  keyId: string,
  payload: unknown,
  requestId: string,
  actorContext?: GatewayKeyAuditActorContext
): Promise<GatewayKeyRegistryDynamicKeyView> {
  if (configuredGatewayApiKeys.some((gatewayApiKey) => gatewayApiKey.id === keyId)) {
    throw createGatewayKeyNotRegistryOwnedError(requestId);
  }

  const actionRequest = parseRotationActionRequest(
    payload,
    "Gateway dynamic key rotation cancel payload is invalid"
  );
  const namespace = requireDynamicGatewayKeyRegistryNamespace(env, requestId);
  const stub = namespace.get(namespace.idFromName(REGISTRY_OBJECT_NAME));
  let response: Response;

  try {
    response = await stub.fetch(
      buildRegistryRequest(requestId, REGISTRY_KIND_DYNAMIC_ROTATE_CANCEL, {
        method: "POST",
        keyId,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...actionRequest,
          ...(actorContext ? toActorContextRecord(actorContext) : {})
        } satisfies GatewayKeyRegistryRotationActionRequest)
      })
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
    const key = parseDynamicKeyResponse(await response.json());

    if (!key) {
      throw new Error("Canceled dynamic key response was empty");
    }

    return key;
  } catch (cause) {
    throw createGatewayKeyRegistryInvalidResponseError(requestId, cause);
  }
}

export async function resolveGatewayRuntimeApiKey(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string
): Promise<{
  runtimeGatewayApiKey: GatewayApiKeyRecord;
  registryOverride: GatewayKeyRegistryStoredOverride | null;
}> {
  const registryOverride = await getGatewayKeyRegistryOverride(
    env,
    gatewayApiKey,
    requestId
  );

  return {
    runtimeGatewayApiKey: applyGatewayApiKeyMetadataOverride(
      gatewayApiKey,
      registryOverride ?? undefined
    ),
    registryOverride
  };
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

  return parseStoredDynamicKey(value);
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

  const now = new Date().toISOString();
  const next: GatewayKeyRegistryStoredDynamicKey = {
    ...gatewayApiKey,
    valueHash: gatewayApiKey.valueHash!,
    createdAt: now,
    updatedAt: now
  };

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
  options?: {
    clearPreviousValueHash?: boolean;
  }
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

  parseGatewayDynamicApiKeyRecord(gatewayApiKey, existingGatewayApiKeys.filter((entry) => {
    return entry.id !== gatewayApiKey.id;
  }));

  const next: GatewayKeyRegistryStoredDynamicKey = {
    ...existing,
    ...gatewayApiKey,
    valueHash: gatewayApiKey.valueHash!,
    updatedAt: new Date().toISOString()
  };

  if (
    options?.clearPreviousValueHash !== true &&
    gatewayApiKey.valueHash === existing.valueHash &&
    existing.previousValueHash &&
    existing.previousValueHashExpiresAt
  ) {
    next.previousValueHash = existing.previousValueHash;
    next.previousValueHashExpiresAt = existing.previousValueHashExpiresAt;
  }

  if (
    options?.clearPreviousValueHash === true ||
    gatewayApiKey.previousValueHash === undefined
  ) {
    delete next.previousValueHash;
  }

  if (
    options?.clearPreviousValueHash === true ||
    gatewayApiKey.previousValueHashExpiresAt === undefined
  ) {
    delete next.previousValueHashExpiresAt;
  }

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
}
