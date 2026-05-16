import { GatewayError, isProviderId, type ProviderId } from "@airlock/shared";

export type GatewayApiKeyStatus = "active" | "revoked";
export type GatewayApiKeyLifecycleStatus =
  | "active"
  | "revoked"
  | "not_yet_active"
  | "expired"
  | "archived";

export interface GatewayApiKeyRequestQuotaPolicy {
  limit: number;
  windowSeconds: number;
}

export interface GatewayApiKeyConcurrencyQuotaPolicy {
  limit: number;
}

export interface GatewayApiKeyTokenQuotaPolicy {
  limit: number;
  windowSeconds: number;
}

export interface GatewayApiKeyPolicy {
  tier?: string;
  tags?: string[];
  allowedExternalModels?: string[];
  allowedProviders?: ProviderId[];
  allowedModelGroups?: string[];
  requestQuota?: GatewayApiKeyRequestQuotaPolicy;
  tokenQuota?: GatewayApiKeyTokenQuotaPolicy;
  concurrencyQuota?: GatewayApiKeyConcurrencyQuotaPolicy;
}

export interface GatewayApiKeyRecord {
  id: string;
  label: string;
  value?: string;
  valueHash?: string;
  status: GatewayApiKeyStatus;
  notBefore?: string;
  expiresAt?: string;
  archivedAt?: string;
  policy?: GatewayApiKeyPolicy;
}

export interface GatewayApiKeyMetadataOverride {
  label?: string;
  status?: GatewayApiKeyStatus;
  notBefore?: string | null;
  expiresAt?: string | null;
  policy?: GatewayApiKeyPolicy | null;
}

export type GatewayApiKeyOwnership = "configured" | "registry";

export interface GatewayKeyRevocationOverlayState {
  revoked: boolean;
  updatedAt: string;
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
  ownership: GatewayApiKeyOwnership;
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
  registryOverride:
    | (GatewayApiKeyMetadataOverride & { updatedAt: string })
    | null;
  registryOverrideApplied: boolean;
  registryUpdatedAt?: string;
}

export interface GatewayApiKeyRegistrySnapshotInput {
  ownership: GatewayApiKeyOwnership;
  configuredKey: GatewayApiKeyRecord;
  configuredStatus: GatewayApiKeyStatusView;
  runtimeKey?: GatewayApiKeyRecord;
  runtimeStatus?: GatewayApiKeyStatusView;
  registryOverride?: (GatewayApiKeyMetadataOverride & { updatedAt: string }) | null;
}

export interface InternalAdminCredential {
  id: string;
  tokenHash: string;
  actor: string;
  role: AdminRole;
  scopes: AdminScope[];
}

export interface InternalAdminAuthorization {
  credentialId: string;
  actor: string;
  role: AdminRole;
  scopes: AdminScope[];
}

export type AdminScope =
  | "status.read"
  | "metrics.read"
  | "config.read"
  | "config.write"
  | "keys.read"
  | "keys.write"
  | "routing.read"
  | "routing.write";

export type AdminRole = "super_admin" | "admin" | "operator" | "viewer";

export const ADMIN_ROLE_SCOPES: Record<AdminRole, AdminScope[]> = {
  super_admin: [
    "status.read",
    "metrics.read",
    "config.read",
    "config.write",
    "keys.read",
    "keys.write",
    "routing.read",
    "routing.write"
  ],
  admin: [
    "status.read",
    "metrics.read",
    "config.read",
    "config.write",
    "keys.read",
    "keys.write",
    "routing.read",
    "routing.write"
  ],
  operator: [
    "status.read",
    "metrics.read",
    "config.read",
    "keys.read",
    "keys.write",
    "routing.read"
  ],
  viewer: [
    "status.read",
    "metrics.read",
    "config.read",
    "keys.read",
    "routing.read"
  ]
};

/** @deprecated Use AdminScope instead. Kept for backward compatibility. */
export type InternalAdminScope = "keys.read" | "keys.write";

export interface InternalAdminAuthorizationRequest {
  authorization: string | undefined;
  adminToken: string | undefined;
  adminCredentials: readonly InternalAdminCredential[];
  structuredCredentialsConfig: string | undefined;
  requiredScope?: AdminScope;
  requestId: string;
}

const DEFAULT_INTERNAL_ADMIN_SCOPES: AdminScope[] = [
  "status.read",
  "metrics.read",
  "config.read",
  "config.write",
  "keys.read",
  "keys.write",
  "routing.read",
  "routing.write"
];

export function createUnauthorizedError(requestId: string): GatewayError {
  return new GatewayError("Unauthorized", {
    code: "auth_invalid_api_key",
    category: "authentication",
    httpStatus: 401,
    retryable: false,
    requestId
  });
}

function createInvalidAdminTokenError(requestId: string): GatewayError {
  return new GatewayError("Unauthorized", {
    code: "auth_invalid_admin_token",
    category: "authentication",
    httpStatus: 401,
    retryable: false,
    requestId
  });
}

function createGatewayApiKeyNotYetActiveError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key is not yet active", {
    code: "auth_api_key_not_yet_active",
    category: "authentication",
    httpStatus: 401,
    retryable: false,
    requestId
  });
}

function createGatewayApiKeyExpiredError(requestId: string): GatewayError {
  return new GatewayError("Gateway API key has expired", {
    code: "auth_api_key_expired",
    category: "authentication",
    httpStatus: 401,
    retryable: false,
    requestId
  });
}

function createInvalidGatewayKeyConfigError(message: string): GatewayError {
  return new GatewayError(message, {
    code: "config_invalid_gateway_api_keys",
    category: "configuration",
    httpStatus: 500,
    retryable: false
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function parseInternalAdminActor(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createInvalidGatewayKeyConfigError(
      "Internal admin credential actor must be a non-empty string"
    );
  }

  return value.trim();
}

const VALID_ADMIN_SCOPES = new Set<AdminScope>([
  "status.read",
  "metrics.read",
  "config.read",
  "config.write",
  "keys.read",
  "keys.write",
  "routing.read",
  "routing.write"
]);

const VALID_ADMIN_ROLES = new Set<AdminRole>([
  "super_admin",
  "admin",
  "operator",
  "viewer"
]);

function parseAdminRole(value: unknown): AdminRole | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (VALID_ADMIN_ROLES.has(trimmed as AdminRole)) return trimmed as AdminRole;
  return undefined;
}

function parseInternalAdminScopes(
  value: unknown
): AdminScope[] {
  if (value === undefined) {
    return [...DEFAULT_INTERNAL_ADMIN_SCOPES];
  }

  if (!Array.isArray(value)) {
    throw createInvalidGatewayKeyConfigError(
      "Internal admin credential scopes must be an array"
    );
  }

  const rawScopes = value as unknown[];
  const scopes: AdminScope[] = [];

  for (const scope of rawScopes) {
    if (!VALID_ADMIN_SCOPES.has(scope as AdminScope)) {
      throw createInvalidGatewayKeyConfigError(
        "Internal admin credential scopes must contain only supported values"
      );
    }

    scopes.push(scope as AdminScope);
  }

  if (new Set(scopes).size !== scopes.length) {
    throw createInvalidGatewayKeyConfigError(
      "Internal admin credential scopes must be unique"
    );
  }

  return scopes;
}

function validateLifecycleWindow(
  notBefore: string | undefined,
  expiresAt: string | undefined
) {
  if (notBefore !== undefined && !isValidTimestamp(notBefore)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key record notBefore must be a valid timestamp"
    );
  }

  if (expiresAt !== undefined && !isValidTimestamp(expiresAt)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key record expiresAt must be a valid timestamp"
    );
  }

  if (
    notBefore !== undefined &&
    expiresAt !== undefined &&
    Date.parse(expiresAt) <= Date.parse(notBefore)
  ) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key record expiresAt must be later than notBefore"
    );
  }
}

function parseGatewayApiKeyPolicy(value: unknown): GatewayApiKeyPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key policy must be an object"
    );
  }

  const policy: GatewayApiKeyPolicy = {};

  if (value.tier !== undefined) {
    if (typeof value.tier !== "string" || value.tier.trim().length === 0) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy tier must be a non-empty string"
      );
    }

    policy.tier = value.tier.trim();
  }

  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy tags must be an array"
      );
    }

    const tags = value.tags.map((tag) => {
      if (typeof tag !== "string" || tag.trim().length === 0) {
        throw createInvalidGatewayKeyConfigError(
          "Gateway API key policy tags must be non-empty strings"
        );
      }

      return tag.trim();
    });

    if (new Set(tags).size !== tags.length) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy tags must be unique"
      );
    }

    policy.tags = tags;
  }

  if (value.allowedExternalModels !== undefined) {
    if (!Array.isArray(value.allowedExternalModels)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy allowedExternalModels must be an array"
      );
    }

    const allowedExternalModels = value.allowedExternalModels.map((model) => {
      if (typeof model !== "string" || model.trim().length === 0) {
        throw createInvalidGatewayKeyConfigError(
          "Gateway API key policy allowedExternalModels must contain non-empty strings"
        );
      }

      return model.trim();
    });

    if (new Set(allowedExternalModels).size !== allowedExternalModels.length) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy allowedExternalModels must be unique"
      );
    }

    policy.allowedExternalModels = allowedExternalModels;
  }

  if (value.allowedProviders !== undefined) {
    if (!Array.isArray(value.allowedProviders)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy allowedProviders must be an array"
      );
    }

    const allowedProviders = value.allowedProviders.map((provider) => {
      const normalizedProvider =
        typeof provider === "string" ? provider.trim() : undefined;

      if (!normalizedProvider || !isProviderId(normalizedProvider)) {
        throw createInvalidGatewayKeyConfigError(
          "Gateway API key policy allowedProviders must contain supported provider ids"
        );
      }

      return normalizedProvider;
    });

    if (new Set(allowedProviders).size !== allowedProviders.length) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy allowedProviders must be unique"
      );
    }

    policy.allowedProviders = allowedProviders;
  }

  if (value.allowedModelGroups !== undefined) {
    if (!Array.isArray(value.allowedModelGroups)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy allowedModelGroups must be an array"
      );
    }

    const allowedModelGroups = value.allowedModelGroups.map((group) => {
      if (typeof group !== "string" || group.trim().length === 0) {
        throw createInvalidGatewayKeyConfigError(
          "Gateway API key policy allowedModelGroups must contain non-empty strings"
        );
      }

      return group.trim();
    });

    if (new Set(allowedModelGroups).size !== allowedModelGroups.length) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy allowedModelGroups must be unique"
      );
    }

    policy.allowedModelGroups = allowedModelGroups;
  }

  if (value.requestQuota !== undefined) {
    if (!isRecord(value.requestQuota)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy requestQuota must be an object"
      );
    }

    const limit = value.requestQuota.limit;
    const windowSeconds = value.requestQuota.windowSeconds;

    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy requestQuota limit must be a positive integer"
      );
    }

    if (
      typeof windowSeconds !== "number" ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds <= 0
    ) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy requestQuota windowSeconds must be a positive integer"
      );
    }

    policy.requestQuota = {
      limit,
      windowSeconds
    };
  }

  if (value.concurrencyQuota !== undefined) {
    if (!isRecord(value.concurrencyQuota)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy concurrencyQuota must be an object"
      );
    }

    const limit = value.concurrencyQuota.limit;

    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy concurrencyQuota limit must be a positive integer"
      );
    }

    policy.concurrencyQuota = {
      limit
    };
  }

  if (value.tokenQuota !== undefined) {
    if (!isRecord(value.tokenQuota)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy tokenQuota must be an object"
      );
    }

    const limit = value.tokenQuota.limit;
    const windowSeconds = value.tokenQuota.windowSeconds;

    if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy tokenQuota limit must be a positive integer"
      );
    }

    if (
      typeof windowSeconds !== "number" ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds <= 0
    ) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key policy tokenQuota windowSeconds must be a positive integer"
      );
    }

    policy.tokenQuota = {
      limit,
      windowSeconds
    };
  }

  return Object.keys(policy).length > 0 ? policy : undefined;
}

export function parseGatewayApiKeyMetadataOverride(
  value: unknown
): GatewayApiKeyMetadataOverride {
  if (!isRecord(value)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key metadata override must be an object"
    );
  }

  const override: GatewayApiKeyMetadataOverride = {};

  if (value.label !== undefined) {
    if (typeof value.label !== "string" || value.label.trim().length === 0) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key metadata override label must be a non-empty string"
      );
    }

    override.label = value.label.trim();
  }

  if (value.status !== undefined) {
    if (value.status !== "active" && value.status !== "revoked") {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key metadata override status must be active or revoked"
      );
    }

    override.status = value.status;
  }

  if (value.notBefore !== undefined) {
    if (value.notBefore !== null && typeof value.notBefore !== "string") {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key metadata override notBefore must be a string or null"
      );
    }

    override.notBefore =
      typeof value.notBefore === "string" ? value.notBefore.trim() : null;
  }

  if (value.expiresAt !== undefined) {
    if (value.expiresAt !== null && typeof value.expiresAt !== "string") {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key metadata override expiresAt must be a string or null"
      );
    }

    override.expiresAt =
      typeof value.expiresAt === "string" ? value.expiresAt.trim() : null;
  }

  if (value.policy !== undefined) {
    if (value.policy !== null) {
      const parsedPolicy = parseGatewayApiKeyPolicy(value.policy);

      if (parsedPolicy !== undefined) {
        override.policy = parsedPolicy;
      }
    } else {
      override.policy = null;
    }
  }

  validateLifecycleWindow(
    override.notBefore === null ? undefined : override.notBefore,
    override.expiresAt === null ? undefined : override.expiresAt
  );

  return override;
}

function parseStructuredGatewayApiKeys(value: string): GatewayApiKeyRecord[] | undefined {
  if (!value.trim().startsWith("[")) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key config JSON must be valid"
    );
  }

  if (!Array.isArray(parsed)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key config JSON must be an array"
    );
  }

  return parsed.map((entry) => {
    if (!isRecord(entry)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key records must be objects"
      );
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    const rawValue = typeof entry.value === "string" ? entry.value.trim() : "";
    const rawValueHash =
      typeof entry.valueHash === "string" ? entry.valueHash.trim().toLowerCase() : "";
    const status = entry.status;
    const notBefore =
      typeof entry.notBefore === "string" ? entry.notBefore.trim() : undefined;
    const expiresAt =
      typeof entry.expiresAt === "string" ? entry.expiresAt.trim() : undefined;

    if (id.length === 0 || label.length === 0) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key records must include non-empty id and label"
      );
    }

    const hasValue = rawValue.length > 0;
    const hasValueHash = rawValueHash.length > 0;

    if (hasValue === hasValueHash) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key records must define exactly one of value or valueHash"
      );
    }

    if (hasValueHash && !isSha256Hex(rawValueHash)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key record valueHash must be a lowercase 64-character SHA-256 hex digest"
      );
    }

    validateLifecycleWindow(notBefore, expiresAt);

    if (status !== "active" && status !== "revoked") {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key records must use a valid status"
      );
    }

    const policy = parseGatewayApiKeyPolicy(entry.policy);

    return {
      id,
      label,
    ...(hasValue ? { value: rawValue } : {}),
    ...(hasValueHash ? { valueHash: rawValueHash } : {}),
    status,
    ...(notBefore !== undefined ? { notBefore } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(policy !== undefined ? { policy } : {})
    };
  });
}

export function parseGatewayDynamicApiKeyRecord(
  value: unknown,
  existingGatewayApiKeys: readonly GatewayApiKeyRecord[] = []
): GatewayApiKeyRecord {
  if (!isRecord(value)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key record must be an object"
    );
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const rawValueHash =
    typeof value.valueHash === "string" ? value.valueHash.trim().toLowerCase() : "";
  const status = value.status;
  const notBefore =
    typeof value.notBefore === "string" ? value.notBefore.trim() : undefined;
  const expiresAt =
    typeof value.expiresAt === "string" ? value.expiresAt.trim() : undefined;
  const archivedAt =
    typeof value.archivedAt === "string" ? value.archivedAt.trim() : undefined;

  if (id.length === 0 || label.length === 0) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key records must include non-empty id and label"
    );
  }

  if (value.value !== undefined) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway dynamic API key records must not define plaintext value"
    );
  }

  if (rawValueHash.length === 0 || !isSha256Hex(rawValueHash)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key record valueHash must be a lowercase 64-character SHA-256 hex digest"
    );
  }

  validateLifecycleWindow(notBefore, expiresAt);

  if (archivedAt !== undefined && !isValidTimestamp(archivedAt)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key record archivedAt must be a valid timestamp"
    );
  }

  if (status !== "active" && status !== "revoked") {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key records must use a valid status"
    );
  }

  const policy = parseGatewayApiKeyPolicy(value.policy);
  const record: GatewayApiKeyRecord = {
    id,
    label,
    valueHash: rawValueHash,
    status,
    ...(notBefore !== undefined ? { notBefore } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(archivedAt !== undefined ? { archivedAt } : {}),
    ...(policy !== undefined ? { policy } : {})
  };

  validateGatewayApiKeyRecords([...existingGatewayApiKeys, record]);

  return record;
}

export function parseInternalAdminCredentials(
  value: string | undefined
): InternalAdminCredential[] {
  if (!value) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw createInvalidGatewayKeyConfigError(
      "Internal admin credentials config must be valid JSON"
    );
  }

  if (!Array.isArray(parsed)) {
    throw createInvalidGatewayKeyConfigError(
      "Internal admin credentials config must be an array"
    );
  }

  const ids = new Set<string>();
  const tokenHashes = new Set<string>();

  return parsed.map((entry) => {
    if (!isRecord(entry)) {
      throw createInvalidGatewayKeyConfigError(
        "Internal admin credential must be an object"
      );
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const tokenHash =
      typeof entry.tokenHash === "string"
        ? entry.tokenHash.trim().toLowerCase()
        : "";
    const actor = parseInternalAdminActor(entry.actor);
    const role = parseAdminRole(entry.role) ?? "admin";
    const scopes = entry.scopes !== undefined
      ? parseInternalAdminScopes(entry.scopes)
      : [...(ADMIN_ROLE_SCOPES[role] ?? DEFAULT_INTERNAL_ADMIN_SCOPES)];

    if (id.length === 0) {
      throw createInvalidGatewayKeyConfigError(
        "Internal admin credential id must be a non-empty string"
      );
    }

    if (!isSha256Hex(tokenHash)) {
      throw createInvalidGatewayKeyConfigError(
        "Internal admin credential tokenHash must be a lowercase 64-character SHA-256 hex digest"
      );
    }

    if (ids.has(id)) {
      throw createInvalidGatewayKeyConfigError(
        "Internal admin credential ids must be unique"
      );
    }

    if (tokenHashes.has(tokenHash)) {
      throw createInvalidGatewayKeyConfigError(
        "Internal admin credential token hashes must be unique"
      );
    }

    ids.add(id);
    tokenHashes.add(tokenHash);

    return {
      id,
      tokenHash,
      actor,
      role,
      scopes
    };
  });
}

function validateGatewayApiKeyRecords(records: GatewayApiKeyRecord[]) {
  const ids = new Set<string>();
  const secretMaterial = new Set<string>();

  for (const record of records) {
    if (ids.has(record.id)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key ids must be unique"
      );
    }

    const material =
      record.value !== undefined ? `value:${record.value}` : `valueHash:${record.valueHash}`;

    if (secretMaterial.has(material)) {
      throw createInvalidGatewayKeyConfigError(
        "Gateway API key entries must be unique"
      );
    }

    ids.add(record.id);
    secretMaterial.add(material);
  }
}

export function parseGatewayApiKeys(value: string): GatewayApiKeyRecord[] {
  const structuredRecords = parseStructuredGatewayApiKeys(value);

  if (structuredRecords) {
    validateGatewayApiKeyRecords(structuredRecords);
    return structuredRecords;
  }

  const entries = value.split(",").map((entry) => entry.trim());

  if (entries.some((entry) => entry.length === 0)) {
    throw createInvalidGatewayKeyConfigError(
      "Gateway API key entries must not be empty"
    );
  }

  const records = entries.map((entry, index) => ({
    id: `gak_${index + 1}`,
    label: `Gateway Key ${index + 1}`,
    value: entry,
    status: "active" as const
  }));

  validateGatewayApiKeyRecords(records);
  return records;
}

export function applyGatewayApiKeyMetadataOverride(
  gatewayApiKey: GatewayApiKeyRecord,
  override: GatewayApiKeyMetadataOverride | undefined
): GatewayApiKeyRecord {
  if (!override) {
    return gatewayApiKey;
  }

  const next: GatewayApiKeyRecord = {
    ...gatewayApiKey,
    ...(override.label !== undefined ? { label: override.label } : {}),
    ...(override.status !== undefined ? { status: override.status } : {})
  };

  if (override.notBefore !== undefined) {
    if (override.notBefore === null) {
      delete next.notBefore;
    } else {
      next.notBefore = override.notBefore;
    }
  }

  if (override.expiresAt !== undefined) {
    if (override.expiresAt === null) {
      delete next.expiresAt;
    } else {
      next.expiresAt = override.expiresAt;
    }
  }

  if (override.policy !== undefined) {
    if (override.policy === null) {
      delete next.policy;
    } else {
      next.policy = override.policy;
    }
  }

  validateLifecycleWindow(next.notBefore, next.expiresAt);

  return next;
}

export function deriveGatewayApiKeyStatusView(
  gatewayApiKey: GatewayApiKeyRecord,
  overlayState: GatewayKeyRevocationOverlayState,
  now?: number
): GatewayApiKeyStatusView {
  const lifecycleStatus = evaluateGatewayApiKeyLifecycle(gatewayApiKey, now);
  const effectiveStatus =
    lifecycleStatus === "archived"
      ? "archived"
      : overlayState.revoked || lifecycleStatus === "revoked"
      ? "revoked"
      : lifecycleStatus;

  return {
    keyId: gatewayApiKey.id,
    label: gatewayApiKey.label,
    configuredStatus: gatewayApiKey.status,
    ...(gatewayApiKey.notBefore ? { notBefore: gatewayApiKey.notBefore } : {}),
    ...(gatewayApiKey.expiresAt ? { expiresAt: gatewayApiKey.expiresAt } : {}),
    lifecycleStatus,
    overlayRevoked: overlayState.revoked,
    overlayUpdatedAt: overlayState.updatedAt,
    effectiveStatus,
    acceptedNow: effectiveStatus === "active"
  };
}

export function createGatewayApiKeyRegistrySnapshot(
  input: GatewayApiKeyRegistrySnapshotInput
): GatewayApiKeyRegistrySnapshot {
  if (input.ownership === "registry") {
    return {
      keyId: input.configuredKey.id,
      ownership: input.ownership,
      label: input.configuredStatus.label,
      configuredStatus: input.configuredStatus.configuredStatus,
      ...(input.configuredStatus.notBefore
        ? { notBefore: input.configuredStatus.notBefore }
        : {}),
      ...(input.configuredStatus.expiresAt
        ? { expiresAt: input.configuredStatus.expiresAt }
        : {}),
      lifecycleStatus: input.configuredStatus.lifecycleStatus,
      overlayRevoked: input.configuredStatus.overlayRevoked,
      overlayUpdatedAt: input.configuredStatus.overlayUpdatedAt,
      effectiveStatus: input.configuredStatus.effectiveStatus,
      acceptedNow: input.configuredStatus.acceptedNow,
      configured: input.configuredStatus,
      runtime: input.configuredStatus,
      registryOverride: null,
      registryOverrideApplied: false
    };
  }

  if (!input.runtimeKey || !input.runtimeStatus) {
    throw createInvalidGatewayKeyConfigError(
      "Configured key snapshots require runtime key and runtime status"
    );
  }

  return {
    keyId: input.configuredKey.id,
    ownership: input.ownership,
    label: input.runtimeStatus.label,
    configuredStatus: input.runtimeStatus.configuredStatus,
    ...(input.runtimeStatus.notBefore
      ? { notBefore: input.runtimeStatus.notBefore }
      : {}),
    ...(input.runtimeStatus.expiresAt
      ? { expiresAt: input.runtimeStatus.expiresAt }
      : {}),
    lifecycleStatus: input.runtimeStatus.lifecycleStatus,
    overlayRevoked: input.runtimeStatus.overlayRevoked,
    overlayUpdatedAt: input.runtimeStatus.overlayUpdatedAt,
    effectiveStatus: input.runtimeStatus.effectiveStatus,
    acceptedNow: input.runtimeStatus.acceptedNow,
    configured: {
      ...input.configuredStatus,
      label: input.configuredKey.label,
      configuredStatus: input.configuredKey.status,
      ...(input.configuredKey.notBefore
        ? { notBefore: input.configuredKey.notBefore }
        : {}),
      ...(input.configuredKey.expiresAt
        ? { expiresAt: input.configuredKey.expiresAt }
        : {})
    },
    runtime: input.runtimeStatus,
    registryOverride: input.registryOverride ?? null,
    registryOverrideApplied:
      input.registryOverride !== undefined && input.registryOverride !== null,
    ...(input.registryOverride
      ? { registryUpdatedAt: input.registryOverride.updatedAt }
      : {})
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
}

export async function validateInternalAdminCredential(
  bearerToken: string,
  credentials: readonly InternalAdminCredential[],
  requestId = "unknown_request"
): Promise<InternalAdminAuthorization> {
  const bearerTokenHash = await sha256Hex(bearerToken);
  const matchedCredential = credentials.find((credential) => {
    return credential.tokenHash === bearerTokenHash;
  });

  if (!matchedCredential) {
    throw createUnauthorizedError(requestId);
  }

  return {
    credentialId: matchedCredential.id,
    actor: matchedCredential.actor,
    role: matchedCredential.role,
    scopes: matchedCredential.scopes
  };
}

function hasStructuredAdminCredentialsConfig(
  value: string | undefined
): boolean {
  return typeof value === "string" && value.length > 0;
}

export async function assertInternalAdminAuthorization(
  authorization: string | undefined,
  adminToken: string | undefined,
  requestId: string
): Promise<void> {
  if (!adminToken) {
    throw new GatewayError("Internal admin token is not configured", {
      code: "config_missing_internal_admin_token",
      category: "configuration",
      httpStatus: 500,
      retryable: false,
      requestId
    });
  }

  if (
    !authorization ||
    !authorization.startsWith("Bearer ") ||
    authorization.length <= "Bearer ".length
  ) {
    throw createInvalidAdminTokenError(requestId);
  }

  const provided = authorization.slice("Bearer ".length);
  const providedHash = await sha256Hex(provided);
  const expectedHash = await sha256Hex(adminToken);

  if (providedHash !== expectedHash) {
    throw createInvalidAdminTokenError(requestId);
  }
}

export async function resolveInternalAdminAuthorization(
  request: InternalAdminAuthorizationRequest
): Promise<InternalAdminAuthorization | undefined> {
  if (!hasStructuredAdminCredentialsConfig(request.structuredCredentialsConfig)) {
    return undefined;
  }

  const bearerToken = extractBearerToken(request.authorization, request.requestId);
  const authorization = await validateInternalAdminCredential(
    bearerToken,
    request.adminCredentials,
    request.requestId
  );

  if (request.requiredScope) {
    requireInternalAdminScope(
      authorization,
      request.requiredScope,
      request.requestId
    );
  }

  return authorization;
}

export async function authorizeInternalAdminRequest(
  request: InternalAdminAuthorizationRequest
): Promise<InternalAdminAuthorization | undefined> {
  const authorization = await resolveInternalAdminAuthorization(request);

  if (authorization) {
    return authorization;
  }

  await assertInternalAdminAuthorization(
    request.authorization,
    request.adminToken,
    request.requestId
  );

  return undefined;
}

export function requireInternalAdminScope(
  authorization: InternalAdminAuthorization,
  scope: AdminScope,
  requestId = "unknown_request"
): InternalAdminAuthorization {
  if (!authorization.scopes.includes(scope)) {
    throw new GatewayError("Forbidden", {
      code: "auth_admin_scope_denied",
      category: "authentication",
      httpStatus: 403,
      retryable: false,
      requestId
    });
  }

  return authorization;
}

export function extractBearerToken(
  authorization: string | undefined,
  requestId = "unknown_request"
): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw createUnauthorizedError(requestId);
  }

  const bearerToken = authorization.slice("Bearer ".length);
  if (bearerToken.length === 0) {
    throw createUnauthorizedError(requestId);
  }

  return bearerToken;
}

export function validateGatewayApiKey(
  bearerToken: string,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId = "unknown_request"
): Promise<GatewayApiKeyRecord> {
  return (async () => {
    const matchedKey = await matchGatewayApiKeyByToken(
      bearerToken,
      gatewayApiKeys
    );

    if (!matchedKey) {
      throw createUnauthorizedError(requestId);
    }

    return assertGatewayApiKeyIsActive(matchedKey, requestId);
  })();
}

export async function matchGatewayApiKeyByToken(
  bearerToken: string,
  gatewayApiKeys: readonly GatewayApiKeyRecord[]
): Promise<GatewayApiKeyRecord | undefined> {
  const bearerTokenHash = await sha256Hex(bearerToken);

  return gatewayApiKeys.find((gatewayApiKey) => {
    if (gatewayApiKey.valueHash) {
      return gatewayApiKey.valueHash === bearerTokenHash;
    }

    return gatewayApiKey.value === bearerToken;
  });
}

export function assertGatewayApiKeyIsActive(
  gatewayApiKey: GatewayApiKeyRecord,
  requestId = "unknown_request"
): GatewayApiKeyRecord {
  const lifecycleStatus = evaluateGatewayApiKeyLifecycle(gatewayApiKey);

  if (lifecycleStatus === "revoked") {
    throw createUnauthorizedError(requestId);
  }

  if (lifecycleStatus === "not_yet_active") {
    throw createGatewayApiKeyNotYetActiveError(requestId);
  }

  if (lifecycleStatus === "expired") {
    throw createGatewayApiKeyExpiredError(requestId);
  }

  if (lifecycleStatus === "archived") {
    throw createUnauthorizedError(requestId);
  }

  return gatewayApiKey;
}

export function requireGatewayAuthorization(
  authorization: string | undefined,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId: string
): Promise<GatewayApiKeyRecord> {
  const bearerToken = extractBearerToken(authorization, requestId);
  return validateGatewayApiKey(bearerToken, gatewayApiKeys, requestId);
}

export function evaluateGatewayApiKeyLifecycle(
  gatewayApiKey: GatewayApiKeyRecord,
  now?: number
): GatewayApiKeyLifecycleStatus {
  if (gatewayApiKey.archivedAt !== undefined) {
    return "archived";
  }

  if (gatewayApiKey.status === "revoked") {
    return "revoked";
  }

  if (
    gatewayApiKey.notBefore === undefined &&
    gatewayApiKey.expiresAt === undefined
  ) {
    return "active";
  }

  const effectiveNow = now ?? Date.now();

  if (
    gatewayApiKey.notBefore !== undefined &&
    effectiveNow < Date.parse(gatewayApiKey.notBefore)
  ) {
    return "not_yet_active";
  }

  if (
    gatewayApiKey.expiresAt !== undefined &&
    effectiveNow >= Date.parse(gatewayApiKey.expiresAt)
  ) {
    return "expired";
  }

  return "active";
}
