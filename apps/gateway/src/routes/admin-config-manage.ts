import type { Hono } from "hono";

import { requireAdminScope } from "../admin-auth.js";
import {
  CONFIG_SECTION_NAMES,
  deleteConfigStoreSection,
  fetchConfigStoreSnapshot,
  putConfigStoreSection,
  type ConfigSectionName
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
    return context.json(snapshot);
  });

  app.get("/_airlock/config/manage/:section", async (context) => {
    await requireAdminScope(context, "config.read");
    const section = context.req.param("section");
    if (!section || !CONFIG_SECTION_NAMES.includes(section as ConfigSectionName)) {
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
      return context.json(
        { error: "Section not found" },
        { status: 404 }
      );
    }

    return context.json(sectionData);
  });

  app.put("/_airlock/config/manage/:section", async (context) => {
    await requireAdminScope(context, "config.write");
    const section = context.req.param("section");
    if (!section || !CONFIG_SECTION_NAMES.includes(section as ConfigSectionName)) {
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
      return context.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
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
    if (!section || !CONFIG_SECTION_NAMES.includes(section as ConfigSectionName)) {
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
