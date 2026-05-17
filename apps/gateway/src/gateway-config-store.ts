import type { DurableObjectStateLike } from "./durable-object-state.js";
import type { GatewayBindings } from "./env.js";

export interface StoredConfigSection {
  data: unknown;
  updatedAt: number;
  updatedBy: string;
  version: number;
}

export interface StoredConfigSnapshot {
  sections: Record<string, StoredConfigSection>;
  globalVersion: number;
}

export const CONFIG_SECTION_NAMES = [
  "providers",
  "routes",
  "model_groups",
  "limits",
  "features",
  "key_policies",
  "shaping",
  "signing"
] as const;

export type ConfigSectionName = (typeof CONFIG_SECTION_NAMES)[number];

const VALID_SECTIONS = new Set<string>(CONFIG_SECTION_NAMES);

function isValidSection(name: string): name is ConfigSectionName {
  return VALID_SECTIONS.has(name);
}

export interface DashboardProviderEntry {
  apiKey: string;
  baseUrl: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
  protocols?: string[];
  extendedHeaders?: Record<string, string>;
  extendedQueryParams?: Record<string, string>;
  extendedBodyInjections?: Record<string, unknown>;
}

export interface DashboardProvidersConfig {
  openai: DashboardProviderEntry;
  anthropic?: DashboardProviderEntry;
  gemini?: DashboardProviderEntry;
}

export interface DashboardRouteTarget {
  provider: string;
  providerModel: string;
}

export interface DashboardRouteConfig {
  externalModel: string;
  target: DashboardRouteTarget;
  fallbacks?: DashboardRouteTarget[];
  strategy?: string;
  shaping?: {
    headers?: Record<string, string>;
    queryParams?: Record<string, string>;
    bodyInjections?: Record<string, unknown>;
  };
}

export interface DashboardLimitsConfig {
  providerTimeoutMs?: number;
  maxRequestBodyBytes?: number;
  providerStreamIdleTimeoutMs?: number;
  providerMaxRetries?: number;
  providerRetryBackoffMs?: number;
  providerCircuitBreakerThreshold?: number;
  providerCircuitBreakerCooldownMs?: number;
  providerCircuitBreakerPersistent?: boolean;
}

export interface DashboardConfigOverlay {
  providers?: DashboardProvidersConfig;
  routes?: DashboardRouteConfig[];
  modelGroups?: Record<string, string[]>;
  limits?: DashboardLimitsConfig;
}

export class GatewayConfigStoreDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/version") {
      return this.handleGetVersion();
    }

    if (request.method === "GET" && path === "/sections") {
      return this.handleListSections();
    }

    if (request.method === "GET" && path === "/full") {
      return this.handleGetFull();
    }

    const sectionMatch = path.match(/^\/sections\/([a-z_]+)$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1] ?? "";
      if (!isValidSection(sectionName)) {
        return Response.json(
          { error: `Invalid section: ${sectionName}` },
          { status: 400 }
        );
      }

      if (request.method === "GET") {
        return this.handleGetSection(sectionName);
      }

      if (request.method === "PUT") {
        return this.handlePutSection(sectionName, request);
      }

      if (request.method === "DELETE") {
        return this.handleDeleteSection(sectionName);
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private async handleGetVersion(): Promise<Response> {
    const version = await this.state.storage.get<number>("global_version");
    return Response.json({ version: version ?? 0 });
  }

  private async handleListSections(): Promise<Response> {
    const sections: Record<string, { version: number; updatedAt: number }> = {};
    for (const name of CONFIG_SECTION_NAMES) {
      const section = await this.state.storage.get<StoredConfigSection>(
        `section:${name}`
      );
      if (section) {
        sections[name] = {
          version: section.version,
          updatedAt: section.updatedAt
        };
      }
    }
    const globalVersion =
      (await this.state.storage.get<number>("global_version")) ?? 0;
    return Response.json({ sections, globalVersion });
  }

  private async handleGetFull(): Promise<Response> {
    const snapshot = await this.loadSnapshot();
    return Response.json(snapshot);
  }

  private async handleGetSection(
    name: ConfigSectionName
  ): Promise<Response> {
    const section = await this.state.storage.get<StoredConfigSection>(
      `section:${name}`
    );
    if (!section) {
      return Response.json({ error: "Section not found" }, { status: 404 });
    }
    return Response.json(section);
  }

  private async handlePutSection(
    name: ConfigSectionName,
    request: Request
  ): Promise<Response> {
    let data: unknown;
    try {
      data = await request.json();
    } catch {
      return Response.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const actorHeader = request.headers.get("x-airlock-admin-actor") ?? "system";
    const globalVersion =
      (await this.state.storage.get<number>("global_version")) ?? 0;
    const existingSection = await this.state.storage.get<StoredConfigSection>(
      `section:${name}`
    );
    const sectionVersion = (existingSection?.version ?? 0) + 1;
    const nextGlobalVersion = globalVersion + 1;

    const section: StoredConfigSection = {
      data,
      updatedAt: Date.now(),
      updatedBy: actorHeader,
      version: sectionVersion
    };

    // DO runtime batches sequential puts within the same handler into
    // a single transaction, so these writes are effectively atomic.
    await this.state.storage.put(`section:${name}`, section);
    await this.state.storage.put("global_version", nextGlobalVersion);

    return Response.json({ ...section, globalVersion: nextGlobalVersion });
  }

  private async handleDeleteSection(
    name: ConfigSectionName
  ): Promise<Response> {
    const existingSection = await this.state.storage.get<StoredConfigSection>(
      `section:${name}`
    );
    if (!existingSection) {
      return Response.json({ error: "Section not found" }, { status: 404 });
    }

    const globalVersion =
      (await this.state.storage.get<number>("global_version")) ?? 0;
    await this.state.storage.delete(`section:${name}`);
    await this.state.storage.put("global_version", globalVersion + 1);

    return Response.json({
      deleted: true,
      section: name,
      globalVersion: globalVersion + 1
    });
  }

  private async loadSnapshot(): Promise<StoredConfigSnapshot> {
    const sections: Record<string, StoredConfigSection> = {};
    for (const name of CONFIG_SECTION_NAMES) {
      const section = await this.state.storage.get<StoredConfigSection>(
        `section:${name}`
      );
      if (section) {
        sections[name] = section;
      }
    }
    const globalVersion =
      (await this.state.storage.get<number>("global_version")) ?? 0;
    return { sections, globalVersion };
  }
}

export async function fetchConfigStoreVersion(
  namespace: NonNullable<GatewayBindings["AIRLOCK_CONFIG_STORE"]>
): Promise<number> {
  const id = namespace.idFromName("global");
  const stub = namespace.get(id);
  const response = await stub.fetch(
    new Request("https://airlock.internal/version")
  );
  const body = (await response.json()) as { version: number };
  return body.version;
}

export async function fetchConfigStoreSnapshot(
  namespace: NonNullable<GatewayBindings["AIRLOCK_CONFIG_STORE"]>
): Promise<StoredConfigSnapshot> {
  const id = namespace.idFromName("global");
  const stub = namespace.get(id);
  const response = await stub.fetch(
    new Request("https://airlock.internal/full")
  );
  return (await response.json()) as StoredConfigSnapshot;
}

export async function putConfigStoreSection(
  namespace: NonNullable<GatewayBindings["AIRLOCK_CONFIG_STORE"]>,
  section: ConfigSectionName,
  data: unknown,
  actor?: string
): Promise<StoredConfigSection & { globalVersion: number }> {
  const id = namespace.idFromName("global");
  const stub = namespace.get(id);
  const response = await stub.fetch(
    new Request(`https://airlock.internal/sections/${section}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(actor ? { "x-airlock-admin-actor": actor } : {})
      },
      body: JSON.stringify(data)
    })
  );

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(
      `Failed to write config section ${section}: ${error.error ?? response.statusText}`
    );
  }

  return (await response.json()) as StoredConfigSection & { globalVersion: number };
}

export async function deleteConfigStoreSection(
  namespace: NonNullable<GatewayBindings["AIRLOCK_CONFIG_STORE"]>,
  section: ConfigSectionName
): Promise<void> {
  const id = namespace.idFromName("global");
  const stub = namespace.get(id);
  const response = await stub.fetch(
    new Request(`https://airlock.internal/sections/${section}`, {
      method: "DELETE"
    })
  );

  if (!response.ok && response.status !== 404) {
    const error = (await response.json()) as { error?: string };
    throw new Error(
      `Failed to delete config section ${section}: ${error.error ?? response.statusText}`
    );
  }
}
