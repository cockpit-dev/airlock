import {
  archiveGatewayAdminKey as writeGatewayAdminKeyArchive,
  bulkArchiveGatewayAdminKeys as writeGatewayAdminKeyBulkArchive,
  bulkCancelGatewayAdminKeyRotations as writeGatewayAdminKeyBulkRotationCancel,
  bulkCreateGatewayAdminKeys as writeGatewayAdminKeyBulkCreate,
  bulkDeleteGatewayAdminKeys as writeGatewayAdminKeyBulkDelete,
  bulkFinalizeGatewayAdminKeyRotations as writeGatewayAdminKeyBulkRotationFinalize,
  bulkRotateGatewayAdminKeys as writeGatewayAdminKeyBulkRotate,
  bulkRestoreGatewayAdminKeys as writeGatewayAdminKeyBulkRestore,
  cancelGatewayAdminKeyRotation as writeGatewayAdminKeyRotationCancel,
  clearGatewayAdminKeyRegistryOverride as writeGatewayAdminKeyRegistryOverrideClear,
  clearGatewayAdminKeyRevocation as writeGatewayAdminKeyRevocationClear,
  createGatewayAdminKey as writeGatewayAdminKeyCreate,
  deleteGatewayAdminKey as writeGatewayAdminKeyDelete,
  finalizeGatewayAdminKeyRotation as writeGatewayAdminKeyRotationFinalize,
  bulkUpdateGatewayAdminKeys as writeGatewayAdminKeyBulkUpdate,
  getGatewayAdminKey as readGatewayAdminKey,
  getGatewayAdminKeyEvents as readGatewayAdminKeyEvents,
  getGatewayAdminKeyOperationEvents as readGatewayAdminKeyOperationEvents,
  getGatewayAdminKeyRegistryView as readGatewayAdminKeyRegistryView,
  getGatewayAdminKeyRevocationStatus as readGatewayAdminKeyRevocationStatus,
  getGatewayAdminKeyStatus as readGatewayAdminKeyStatus,
  listGatewayAdminKeys as readGatewayAdminKeys,
  revokeGatewayAdminKey as writeGatewayAdminKeyRevoke,
  restoreGatewayAdminKey as writeGatewayAdminKeyRestore,
  rotateGatewayAdminKey as writeGatewayAdminKeyRotate,
  updateGatewayAdminKey as writeGatewayAdminKeyUpdate,
  updateGatewayAdminKeyRegistryOverride as writeGatewayAdminKeyRegistryOverrideUpdate,
  type GatewayApiKeyMetadataOverride
} from "@airlock/governance";

import { createAdminKeyGovernanceRuntime } from "./admin-key-governance-runtime.js";
import {
  resolveAdminMutationActorCommand
} from "./admin-actor.js";
import type { GatewayBindings } from "./env.js";

export async function listAdminGatewayKeys(
  env: GatewayBindings,
  _request: Request,
  requestId: string,
  query: URLSearchParams
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKeys(query, runtime.read);
}

export async function createAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key create payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyCreate(mutation.payload, runtime.write);
}

export async function bulkCreateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk create payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkCreate(
    mutation.payload as {
      keys: Array<{
        id: string;
        label: string;
        valueHash: string;
        status: "active" | "revoked";
        notBefore?: string;
        expiresAt?: string;
        policy?: object;
      }>;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    runtime.write
  );
}

export async function bulkUpdateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk update payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkUpdate(
    mutation.payload as {
      updates: Array<{
        keyId: string;
        status?: "active" | "revoked";
        label?: string;
        notBefore?: string | null;
        expiresAt?: string | null;
        policy?: object | null;
      }>;
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function bulkDeleteAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk delete payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkDelete(
    mutation.payload as {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function bulkRotateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk rotate payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkRotate(
    mutation.payload as {
      rotations: Array<{
        keyId: string;
        valueHash: string;
        overlapSeconds?: number;
      }>;
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function bulkArchiveAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk archive payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkArchive(
    mutation.payload as {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function bulkRestoreAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk restore payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkRestore(
    mutation.payload as {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function bulkFinalizeAdminGatewayKeyRotations(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk rotation finalize payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkRotationFinalize(
    mutation.payload as {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function bulkCancelAdminGatewayKeyRotations(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key bulk rotation cancel payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyBulkRotationCancel(
    mutation.payload as {
      keyIds: string[];
      reason?: string;
      actor?: string;
      actorSource?: "payload" | "trusted_header" | "credential";
    },
    requestId,
    runtime.write
  );
}

export async function getAdminGatewayKey(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKey(keyId, requestId, runtime.read);
}

export async function updateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key update payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyUpdate(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function deleteAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key delete payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyDelete(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function rotateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyRotate(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function archiveAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key archive payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyArchive(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function restoreAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key restore payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyRestore(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function finalizeAdminGatewayKeyRotation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation finalize payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyRotationFinalize(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function cancelAdminGatewayKeyRotation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway dynamic key rotation cancel payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyRotationCancel(
    keyId,
    mutation.payload,
    requestId,
    runtime.write
  );
}

export async function getAdminGatewayKeyRevocationStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKeyRevocationStatus(keyId, runtime.read);
}

export async function getAdminGatewayKeyStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKeyStatus(keyId, runtime.read);
}

export async function getAdminGatewayKeyEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKeyEvents(keyId, runtime.read);
}

export async function getAdminGatewayKeyOperationEvents(
  env: GatewayBindings,
  operationId: string,
  requestId: string
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKeyOperationEvents(operationId, requestId, runtime.read);
}

export async function getAdminGatewayKeyRegistryView(
  env: GatewayBindings,
  keyId: string,
  requestId: string
): Promise<{
  keyId: string;
  configured: Awaited<
    ReturnType<
      ReturnType<typeof createAdminKeyGovernanceRuntime>["read"]["getConfiguredKeyStatusSnapshot"]
    >
  >["configured"];
  runtime: Awaited<
    ReturnType<
      ReturnType<typeof createAdminKeyGovernanceRuntime>["read"]["getConfiguredKeyStatusSnapshot"]
    >
  >["runtime"];
  override: GatewayApiKeyMetadataOverride & { updatedAt: string } | null;
  registryOverrideApplied: boolean;
  registryUpdatedAt?: string;
}> {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return readGatewayAdminKeyRegistryView(keyId, runtime.read);
}

export async function updateAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string,
  payload: unknown
): Promise<{
  keyId: string;
  override: GatewayApiKeyMetadataOverride & { updatedAt: string };
}> {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return writeGatewayAdminKeyRegistryOverrideUpdate(keyId, payload, runtime.write);
}

export async function clearAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  const runtime = createAdminKeyGovernanceRuntime(env, requestId);
  return writeGatewayAdminKeyRegistryOverrideClear(keyId, runtime.write);
}

export async function revokeAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway key revocation payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyRevoke(keyId, mutation.payload, runtime.write);
}

export async function clearAdminGatewayKeyRevocation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  const mutation = await resolveAdminMutationActorCommand(
    request,
    env,
    payload,
    requestId,
    "Gateway key revocation payload is invalid"
  );
  const runtime = createAdminKeyGovernanceRuntime(
    env,
    requestId,
    mutation.actorContext
  );

  return writeGatewayAdminKeyRevocationClear(
    keyId,
    mutation.payload,
    runtime.write
  );
}
