export class AirlockClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options?.headers
      }
    });

    if (response.status === 401) {
      throw new AuthError("Unauthorized");
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        body?.error?.message ?? `HTTP ${response.status}`,
        response.status
      );
    }

    return response.json() as Promise<T>;
  }

  // Health
  getStatus() {
    return this.request<GatewayStatusResponse>("/_airlock/status");
  }

  getMetrics() {
    return this.request<MetricsSnapshot>("/_airlock/metrics");
  }

  getConfig() {
    return this.request<AdminConfigResponse>("/_airlock/config");
  }

  getRoutingHealth() {
    return this.request<RoutingHealthResponse>("/_airlock/routing/health");
  }

  // Keys
  listKeys(params?: Record<string, string>) {
    const query = params ? "?" + new URLSearchParams(params).toString() : "";
    return this.request<unknown>(`/_airlock/keys${query}`);
  }

  getKey(keyId: string) {
    return this.request<unknown>(`/_airlock/keys/${keyId}`);
  }

  createKey(payload: unknown) {
    return this.request<unknown>("/_airlock/keys", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  deleteKey(keyId: string, payload?: unknown) {
    return this.request<unknown>(`/_airlock/keys/${keyId}`, {
      method: "DELETE",
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  }

  rotateKey(keyId: string, payload?: unknown) {
    return this.request<unknown>(`/_airlock/keys/${keyId}/rotate`, {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  }

  archiveKey(keyId: string, payload?: unknown) {
    return this.request<unknown>(`/_airlock/keys/${keyId}/archive`, {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  }

  restoreKey(keyId: string, payload?: unknown) {
    return this.request<unknown>(`/_airlock/keys/${keyId}/restore`, {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  }

  revokeKey(keyId: string, payload?: unknown) {
    return this.request<unknown>(`/_airlock/keys/${keyId}/revocation`, {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
  }

  getKeyStatus(keyId: string) {
    return this.request<unknown>(`/_airlock/keys/${keyId}/status`);
  }

  getKeyEvents(keyId: string) {
    return this.request<unknown>(`/_airlock/keys/${keyId}/events`);
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Response types — matching gateway admin API response shapes exactly.

export interface GatewayStatusResponse {
  configFingerprint: string;
  mode: string;
  routes: Array<{
    externalModel: string;
    primaryTarget: { provider: string; providerModel: string };
    fallbackCount: number;
    targetSelection?: { strategy: string; hasRequestClassAffinity: boolean };
    requiredKeyTier?: string;
    requiredKeyTags?: string[];
  }>;
  providers: Array<{ id: string; configured: boolean; routeCount: number }>;
  keys: { total: number; configured: number; registryOwned: number };
  circuitBreaker: {
    totalTargets: number;
    openTargets: string[];
    halfOpenTargets: string[];
  };
  config: {
    providerTimeoutMs: number;
    providerMaxRetries: number;
    providerStreamIdleTimeoutMs: number;
    maxRequestBodyBytes: number;
    routingLatencyFreshnessMs: number;
    routingCostFreshnessMs: number;
    routingFailureFreshnessMs: number;
    routingRecoveryWindowMs: number;
    circuitBreakerThreshold?: number;
    circuitBreakerCooldownMs?: number;
  };
}

export interface MetricsSnapshot {
  window: { durationMs: number; collectedSince: string };
  requests: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
  statusCodes: Record<number, number>;
  byRoute: Record<string, { requests: number; errors: number; avgDurationMs: number }>;
}

export interface AdminConfigResponse {
  providers: {
    openai: { baseUrl: string; defaultModel: string; configured: true };
    anthropic?: { baseUrl: string; defaultMaxTokens: number; configured: true };
    gemini?: { baseUrl: string; configured: true };
  };
  routes: Array<{
    externalModel: string;
    target: { provider: string; providerModel: string };
    fallbacks?: Array<{ provider: string; providerModel: string }>;
    strategy?: string;
  }>;
  modelGroups: Record<string, string[]>;
  keys: { total: number; configured: number; registryOwned: number };
  features: {
    circuitBreaker: { enabled: boolean; persistent: boolean };
    quota: boolean;
    tokenQuota: boolean;
    concurrency: boolean;
    registry: boolean;
    ipRateLimit: boolean;
    telemetry: boolean;
    cors: boolean;
    requestLogging: boolean;
  };
  limits: {
    providerTimeoutMs: number;
    maxRequestBodyBytes: number;
    providerStreamIdleTimeoutMs: number;
    maxRetries: number;
    retryBackoffMs: number;
  };
}

export interface RoutingHealthResponse {
  targets: Record<string, {
    circuitState: Record<string, unknown>;
    healthSnapshot: Record<string, unknown>;
    metrics: {
      errorRate: number;
      recoveryScore: number;
      freshness: {
        latencyFreshMs: number | null;
        costFreshMs: number | null;
        failureFreshMs: number | null;
      };
    };
  }>;
  routes: Record<string, {
    strategy: string;
    targets: string[];
    healthStatus: "healthy" | "degraded" | "down";
    healthyTargetCount: number;
    totalTargetCount: number;
    costs?: Record<string, number>;
    weights?: Record<string, number>;
    latencySloMs?: Record<string, number>;
  }>;
  config: {
    circuitBreakerPolicy: {
      threshold: number;
      cooldownMs: number;
      errorRateWindowMs?: number;
      errorRateThreshold?: number;
      minAttemptsInWindow?: number;
    };
    freshnessWindows: {
      latencyFreshnessMs: number;
      costFreshnessMs: number;
      failureFreshnessMs: number;
      recoveryWindowMs: number;
    };
    persistentBackend: boolean;
  };
}
