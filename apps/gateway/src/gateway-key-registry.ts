import {
  applyGatewayApiKeyMetadataOverride,
  parseGatewayApiKeyMetadataOverride,
  type GatewayApiKeyLifecycleStatus,
  type GatewayApiKeyMetadataOverride,
  type GatewayApiKeyRecord
} from "@airlock/governance";
import { GatewayError } from "@airlock/shared";

import type { GatewayBindings } from "./env.js";

const REGISTRY_OBJECT_NAME = "gateway-key-registry";

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

interface GatewayKeyRegistryRecordResponse {
  keyId: string;
  override: GatewayKeyRegistryStoredOverride | null;
}

export interface GatewayApiKeyStatusView {
  keyId: string;
  label: string;
  configuredStatus: GatewayApiKeyRecord["status"];
  notBefore?: string;
  expiresAt?: string;
  lifecycleStatus: GatewayApiKeyLifecycleStatus;
  overlayRevoked: boolean;
  overlayUpdatedAt: string;
  effectiveStatus: GatewayApiKeyLifecycleStatus;
  acceptedNow: boolean;
}

export interface GatewayApiKeyRegistrySnapshot {
  keyId: string;
  label: string;
  configuredStatus: GatewayApiKeyRecord["status"];
  notBefore?: string;
  expiresAt?: string;
  lifecycleStatus: GatewayApiKeyLifecycleStatus;
  overlayRevoked: boolean;
  overlayUpdatedAt: string;
  effectiveStatus: GatewayApiKeyLifecycleStatus;
  acceptedNow: boolean;
  configured: GatewayApiKeyStatusView;
  runtime: GatewayApiKeyStatusView;
  registryOverride: GatewayKeyRegistryStoredOverride | null;
  registryOverrideApplied: boolean;
  registryUpdatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredOverride(value: unknown): GatewayKeyRegistryStoredOverride {
  if (!isRecord(value)) {
    throw new Error("Registry override must be an object");
  }

  const { updatedAt, ...overrideValue } = value;

  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error("Registry override updatedAt must be a valid timestamp");
  }

  return {
    ...parseGatewayApiKeyMetadataOverride(overrideValue),
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

function requireGatewayKeyRegistryNamespace(
  env: GatewayBindings,
  requestId: string
) {
  const namespace = env.AIRLOCK_GATEWAY_KEY_REGISTRY;

  if (!namespace) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  return namespace;
}

export class GatewayKeyRegistryDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const keyId = url.searchParams.get("keyId");

    if (!keyId) {
      return new Response("Missing keyId", { status: 400 });
    }

    switch (request.method) {
      case "GET":
        return Response.json({
          keyId,
          override: await readStoredOverride(this.state.storage, keyId)
        });
      case "PUT":
        return Response.json({
          keyId,
          override: await writeStoredOverride(
            this.state.storage,
            keyId,
            parseGatewayApiKeyMetadataOverride(await request.json())
          )
        });
      case "DELETE":
        await clearStoredOverride(this.state.storage, keyId);
        return Response.json({
          keyId,
          override: null
        });
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
      new Request(
        `https://airlock.internal/gateway-key-registry?keyId=${encodeURIComponent(gatewayApiKey.id)}`,
        {
          method: "GET"
        }
      )
    );
  } catch (cause) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  try {
    const parsed = parseRegistryResponse(await response.json());
    return parsed.override;
  } catch (cause) {
    throw new GatewayError(
      "Gateway key registry subsystem returned an invalid response",
      {
        code: "gateway_key_registry_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId,
        cause
      }
    );
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
      new Request(
        `https://airlock.internal/gateway-key-registry?keyId=${encodeURIComponent(gatewayApiKey.id)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(override)
        }
      )
    );
  } catch (cause) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
  }

  const parsed = parseRegistryResponse(await response.json());

  if (!parsed.override) {
    throw new GatewayError(
      "Gateway key registry subsystem returned an invalid response",
      {
        code: "gateway_key_registry_invalid_response",
        category: "governance",
        httpStatus: 503,
        retryable: true,
        requestId
      }
    );
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
      new Request(
        `https://airlock.internal/gateway-key-registry?keyId=${encodeURIComponent(gatewayApiKey.id)}`,
        {
          method: "DELETE"
        }
      )
    );
  } catch (cause) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId,
      cause
    });
  }

  if (!response.ok) {
    throw new GatewayError("Gateway key registry subsystem is unavailable", {
      code: "gateway_key_registry_unavailable",
      category: "governance",
      httpStatus: 503,
      retryable: true,
      requestId
    });
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

export async function createGatewayApiKeyRegistrySnapshot(
  env: GatewayBindings,
  gatewayApiKey: GatewayApiKeyRecord,
  requestId: string,
  resolveStatus: (
    gatewayApiKeyRecord: GatewayApiKeyRecord,
    requestId: string
  ) => Promise<GatewayApiKeyStatusView>
): Promise<GatewayApiKeyRegistrySnapshot> {
  const configured = await resolveStatus(gatewayApiKey, requestId);
  const { runtimeGatewayApiKey, registryOverride } =
    await resolveGatewayRuntimeApiKey(env, gatewayApiKey, requestId);
  const runtime = await resolveStatus(runtimeGatewayApiKey, requestId);

  return {
    keyId: gatewayApiKey.id,
    label: runtime.label,
    configuredStatus: runtime.configuredStatus,
    ...(runtime.notBefore ? { notBefore: runtime.notBefore } : {}),
    ...(runtime.expiresAt ? { expiresAt: runtime.expiresAt } : {}),
    lifecycleStatus: runtime.lifecycleStatus,
    overlayRevoked: runtime.overlayRevoked,
    overlayUpdatedAt: runtime.overlayUpdatedAt,
    effectiveStatus: runtime.effectiveStatus,
    acceptedNow: runtime.acceptedNow,
    configured: {
      ...configured,
      label: gatewayApiKey.label,
      configuredStatus: gatewayApiKey.status,
      ...(gatewayApiKey.notBefore ? { notBefore: gatewayApiKey.notBefore } : {}),
      ...(gatewayApiKey.expiresAt ? { expiresAt: gatewayApiKey.expiresAt } : {})
    },
    runtime,
    registryOverride,
    registryOverrideApplied: registryOverride !== null,
    ...(registryOverride ? { registryUpdatedAt: registryOverride.updatedAt } : {})
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
