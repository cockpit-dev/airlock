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
  updateGatewayAdminKeyRegistryOverride as writeGatewayAdminKeyRegistryOverrideUpdate
} from "@airlock/governance";

import { createAdminKeyGovernanceWorkflow } from "./admin-key-governance-workflow.js";
import type { GatewayBindings } from "./env.js";

export async function listAdminGatewayKeys(
  env: GatewayBindings,
  _request: Request,
  requestId: string,
  query: URLSearchParams
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKeys(query, runtime.read);
  });
}

export async function createAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key create payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyCreate(mutation.payload, runtime.write);
    }
  );
}

export async function bulkCreateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk create payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkUpdateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk update payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkDeleteAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk delete payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkRotateAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk rotate payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkArchiveAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk archive payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkRestoreAdminGatewayKeys(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk restore payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkFinalizeAdminGatewayKeyRotations(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk rotation finalize payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function bulkCancelAdminGatewayKeyRotations(
  env: GatewayBindings,
  request: Request,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key bulk rotation cancel payload is invalid",
    ({ mutation, runtime }) => {
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
  );
}

export async function getAdminGatewayKey(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKey(keyId, requestId, runtime.read);
  });
}

export async function updateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key update payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyUpdate(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function deleteAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key delete payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyDelete(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function rotateAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key rotation payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyRotate(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function archiveAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key archive payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyArchive(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function restoreAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key restore payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyRestore(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function finalizeAdminGatewayKeyRotation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key rotation finalize payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyRotationFinalize(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function cancelAdminGatewayKeyRotation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway dynamic key rotation cancel payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyRotationCancel(
        keyId,
        mutation.payload,
        requestId,
        runtime.write
      );
    }
  );
}

export async function getAdminGatewayKeyRevocationStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKeyRevocationStatus(keyId, runtime.read);
  });
}

export async function getAdminGatewayKeyStatus(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKeyStatus(keyId, runtime.read);
  });
}

export async function getAdminGatewayKeyEvents(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKeyEvents(keyId, runtime.read);
  });
}

export async function getAdminGatewayKeyOperationEvents(
  env: GatewayBindings,
  operationId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKeyOperationEvents(operationId, requestId, runtime.read);
  });
}

export async function getAdminGatewayKeyRegistryView(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return readGatewayAdminKeyRegistryView(keyId, runtime.read);
  });
}

export async function updateAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return writeGatewayAdminKeyRegistryOverrideUpdate(keyId, payload, runtime.write);
  });
}

export async function clearAdminGatewayKeyRegistryOverride(
  env: GatewayBindings,
  keyId: string,
  requestId: string
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withRead((runtime) => {
    return writeGatewayAdminKeyRegistryOverrideClear(keyId, runtime.write);
  });
}

export async function revokeAdminGatewayKey(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway key revocation payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyRevoke(keyId, mutation.payload, runtime.write);
    }
  );
}

export async function clearAdminGatewayKeyRevocation(
  env: GatewayBindings,
  request: Request,
  keyId: string,
  requestId: string,
  payload: unknown
) {
  return createAdminKeyGovernanceWorkflow(env, requestId).withMutation(
    request,
    payload,
    "Gateway key revocation payload is invalid",
    ({ mutation, runtime }) => {
      return writeGatewayAdminKeyRevocationClear(
        keyId,
        mutation.payload,
        runtime.write
      );
    }
  );
}
