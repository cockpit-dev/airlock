import type { AdminConfigResponse, GatewayApiKeyPolicy } from "./api";

export interface GatewayKeyCreateInput {
  label: string;
  plainTextKey: string;
  blockedExternalModels?: string[];
  reason?: string;
}

export interface GatewayKeyCreatePayload {
  id: string;
  label: string;
  valueHash: string;
  status: "active";
  policy?: GatewayApiKeyPolicy;
  reason?: string;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateGatewayKeyValue(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `airlok_${bytesToHex(bytes)}`;
}

export async function hashGatewayKeyValue(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
}

export function getConfiguredModels(config: AdminConfigResponse): string[] {
  const models: string[] = [];
  const seen = new Set<string>();
  const add = (model: string | undefined) => {
    const normalized = model?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    models.push(normalized);
  };

  for (const route of config.routes) {
    add(route.externalModel);
  }

  for (const provider of config.providers) {
    for (const model of provider.models ?? []) {
      add(`${provider.id}/${model}`);
    }
  }

  return models;
}

export function buildUpdatedKeyPolicy(
  currentPolicy: GatewayApiKeyPolicy | undefined,
  blockedExternalModels: readonly string[]
): GatewayApiKeyPolicy | undefined {
  const next: GatewayApiKeyPolicy = { ...(currentPolicy ?? {}) };
  const blocked = uniqueNonEmpty(blockedExternalModels);

  delete next.allowedExternalModels;
  delete next.allowedModelGroups;

  if (blocked.length > 0) {
    next.blockedExternalModels = blocked;
  } else {
    delete next.blockedExternalModels;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export async function buildGatewayKeyCreatePayload({
  label,
  plainTextKey,
  blockedExternalModels,
  reason,
}: GatewayKeyCreateInput): Promise<GatewayKeyCreatePayload> {
  const trimmedLabel = label.trim() || "Console key";
  const policy = buildUpdatedKeyPolicy(undefined, blockedExternalModels ?? []);
  const payload: GatewayKeyCreatePayload = {
    id: globalThis.crypto.randomUUID(),
    label: trimmedLabel,
    valueHash: await hashGatewayKeyValue(plainTextKey),
    status: "active",
  };

  if (policy) payload.policy = policy;
  if (reason?.trim()) payload.reason = reason.trim();

  return payload;
}
