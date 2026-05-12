import { GatewayError, isProviderId, type ProviderId } from "@airlock/shared";

export type GatewayApiKeyStatus = "active" | "revoked";

export interface GatewayApiKeyPolicy {
  tier?: string;
  tags?: string[];
  allowedExternalModels?: string[];
  allowedProviders?: ProviderId[];
  allowedModelGroups?: string[];
}

export interface GatewayApiKeyRecord {
  id: string;
  label: string;
  value?: string;
  valueHash?: string;
  status: GatewayApiKeyStatus;
  policy?: GatewayApiKeyPolicy;
}

function createUnauthorizedError(requestId: string): GatewayError {
  return new GatewayError("Unauthorized", {
    code: "auth_invalid_api_key",
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

  return Object.keys(policy).length > 0 ? policy : {};
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
      ...(policy !== undefined ? { policy } : {})
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

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
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
    const bearerTokenHash = await sha256Hex(bearerToken);
    const matchedKey = gatewayApiKeys.find((gatewayApiKey) => {
      if (gatewayApiKey.valueHash) {
        return gatewayApiKey.valueHash === bearerTokenHash;
      }

      return gatewayApiKey.value === bearerToken;
    });

    if (!matchedKey) {
      throw createUnauthorizedError(requestId);
    }

    if (matchedKey.status !== "active") {
      throw createUnauthorizedError(requestId);
    }

    return matchedKey;
  })();
}

export function requireGatewayAuthorization(
  authorization: string | undefined,
  gatewayApiKeys: readonly GatewayApiKeyRecord[],
  requestId: string
): Promise<GatewayApiKeyRecord> {
  const bearerToken = extractBearerToken(authorization, requestId);
  return validateGatewayApiKey(bearerToken, gatewayApiKeys, requestId);
}
