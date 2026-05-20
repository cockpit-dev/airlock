import type { Hono } from "hono";

import { requireAdminScope } from "../admin-auth.js";
import {
  CONFIG_SECTION_NAMES,
  deleteConfigStoreSection,
  fetchConfigStoreSnapshot,
  putConfigStoreSection,
  type ConfigSectionName,
  type StoredConfigSnapshot
} from "../gateway-config-store.js";
import type { GatewayBindings } from "../env.js";

type AppVariables = {
  requestId: string;
  requestStartedAt: number;
};

type GatewayApp = Hono<{
  Bindings: GatewayBindings;
  Variables: AppVariables;
}>;

const MASK_PREFIX = "****";

export function maskApiKey(key: string): string {
  if (key.length <= 4) return MASK_PREFIX;
  return MASK_PREFIX + key.slice(-4);
}

const MASKED_KEY_RE = /^\*{4}/;

export function maskSensitiveFieldsInSection(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "apiKey" in entry
      ) {
        const record = entry as Record<string, unknown>;
        return {
          ...record,
          apiKey:
            typeof record.apiKey === "string"
              ? maskApiKey(record.apiKey)
              : MASK_PREFIX
        };
      }
      return entry;
    });
  }
  return data;
}

export function maskSnapshot(snapshot: StoredConfigSnapshot): StoredConfigSnapshot {
  const sections = { ...snapshot.sections };
  if (sections.providers) {
    sections.providers = {
      ...sections.providers,
      data: maskSensitiveFieldsInSection(sections.providers.data)
    };
  }
  return { ...snapshot, sections };
}

export function mergeMaskedApiKeys(
  newData: unknown,
  existingData: unknown
): unknown {
  if (!Array.isArray(newData) || !Array.isArray(existingData)) return newData;

  const existingById = new Map<string, Record<string, unknown>>();
  for (const entry of existingData) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "id" in entry
    ) {
      existingById.set(
        (entry as Record<string, unknown>).id as string,
        entry as Record<string, unknown>
      );
    }
  }

  return newData.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const record = entry as Record<string, unknown>;
    const apiKey = record.apiKey;
    if (
      typeof apiKey === "string" &&
      MASKED_KEY_RE.test(apiKey) &&
      record.id
    ) {
      const existing = existingById.get(record.id as string);
      if (existing?.apiKey && typeof existing.apiKey === "string") {
        return { ...record, apiKey: existing.apiKey };
      }
    }
    return record;
  });
}

export function registerAdminConfigManageRoutes(app: GatewayApp): void {
  app.get("/_airlock/config/manage", async (context) => {
    await requireAdminScope(context, "config.read");
    const namespace = context.env.AIRLOCK_CONFIG_STORE;
    if (!namespace) {
      return context.json(
        { error: "Config store not configured" },
        { status: 503 }
      );
    }

    const snapshot = await fetchConfigStoreSnapshot(namespace);
    return context.json(maskSnapshot(snapshot));
  });

  app.get("/_airlock/config/manage/:section", async (context) => {
    await requireAdminScope(context, "config.read");
    const section = context.req.param("section");
    if (
      !section ||
      !CONFIG_SECTION_NAMES.includes(section as ConfigSectionName)
    ) {
      return context.json(
        { error: `Invalid section: ${section}` },
        { status: 400 }
      );
    }

    const namespace = context.env.AIRLOCK_CONFIG_STORE;
    if (!namespace) {
      return context.json(
        { error: "Config store not configured" },
        { status: 503 }
      );
    }

    const snapshot = await fetchConfigStoreSnapshot(namespace);
    const sectionData = snapshot.sections[section];
    if (!sectionData) {
      return context.json({ error: "Section not found" }, { status: 404 });
    }

    const maskedData = maskSensitiveFieldsInSection(sectionData.data);
    return context.json({ ...sectionData, data: maskedData });
  });

  app.put("/_airlock/config/manage/:section", async (context) => {
    await requireAdminScope(context, "config.write");
    const section = context.req.param("section");
    if (
      !section ||
      !CONFIG_SECTION_NAMES.includes(section as ConfigSectionName)
    ) {
      return context.json(
        { error: `Invalid section: ${section}` },
        { status: 400 }
      );
    }

    const namespace = context.env.AIRLOCK_CONFIG_STORE;
    if (!namespace) {
      return context.json(
        { error: "Config store not configured" },
        { status: 503 }
      );
    }

    const contentType = context.req.header("content-type");
    if (!contentType?.includes("application/json")) {
      return context.json(
        { error: "Content-Type must be application/json" },
        { status: 415 }
      );
    }

    let data: unknown;
    try {
      data = await context.req.json();
    } catch {
      return context.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (section === "providers") {
      const snapshot = await fetchConfigStoreSnapshot(namespace);
      const existingProviders = snapshot.sections.providers?.data;
      data = mergeMaskedApiKeys(data, existingProviders);
    }

    const actor = context.req.header("x-airlock-admin-actor") ?? "system";
    const result = await putConfigStoreSection(
      namespace,
      section as ConfigSectionName,
      data,
      actor
    );

    return context.json(result);
  });

  app.delete("/_airlock/config/manage/:section", async (context) => {
    await requireAdminScope(context, "config.write");
    const section = context.req.param("section");
    if (
      !section ||
      !CONFIG_SECTION_NAMES.includes(section as ConfigSectionName)
    ) {
      return context.json(
        { error: `Invalid section: ${section}` },
        { status: 400 }
      );
    }

    const namespace = context.env.AIRLOCK_CONFIG_STORE;
    if (!namespace) {
      return context.json(
        { error: "Config store not configured" },
        { status: 503 }
      );
    }

    await deleteConfigStoreSection(namespace, section as ConfigSectionName);
    return context.json({ deleted: true, section });
  });
}
