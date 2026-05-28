export const queryKeys = {
  status: ["status"] as const,
  metrics: ["metrics"] as const,
  config: ["config"] as const,
  routingHealth: ["routingHealth"] as const,
  keys: {
    all: ["keys"] as const,
    list: (params?: Record<string, string>) =>
      ["keys", "list", params] as const,
    detail: (id: string) => ["keys", id] as const,
    status: (id: string) => ["keys", id, "status"] as const,
    events: (id: string) => ["keys", id, "events"] as const
  },
  configStore: {
    snapshot: ["configStore", "snapshot"] as const,
    section: (section: string) => ["configStore", section] as const
  },
  providerModels: ["providerModels"] as const
};
