import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayBindings } from "./env.js";

const workflowMocks = vi.hoisted(() => ({
  createAdminKeyGovernanceRuntime: vi.fn(),
  resolveAdminMutationActorCommand: vi.fn()
}));

vi.mock("./admin-key-governance-runtime.js", () => ({
  createAdminKeyGovernanceRuntime: workflowMocks.createAdminKeyGovernanceRuntime
}));

vi.mock("./admin-actor.js", () => ({
  resolveAdminMutationActorCommand:
    workflowMocks.resolveAdminMutationActorCommand
}));

import { createAdminKeyGovernanceWorkflow } from "./admin-key-governance-workflow.js";

function createEnv(): GatewayBindings {
  return {
    AIRLOCK_MODE: "free",
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_FREE: 0.1,
    AIRLOCK_TELEMETRY_SUCCESS_SAMPLE_RATE_SCALE: 1,
    AIRLOCK_GATEWAY_API_KEYS: "gateway-secret",
    AIRLOCK_PROVIDER_TIMEOUT_MS: 1000,
    AIRLOCK_PROVIDER_MAX_RETRIES: 0,
    AIRLOCK_PROVIDER_RETRY_BACKOFF_MS: 0,
    AIRLOCK_PROVIDER_STREAM_IDLE_TIMEOUT_MS: 15_000,
    AIRLOCK_MAX_REQUEST_BODY_BYTES: 10_485_760,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_THRESHOLD: 3,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: 30000,
    AIRLOCK_PROVIDER_CIRCUIT_BREAKER_PERSISTENT: false,
    AIRLOCK_GATEWAY_KEY_REGISTRY_ENABLED: false,
    AIRLOCK_INTERNAL_ADMIN_ACTOR_REQUIRED: false,
    OPENAI_API_KEY: "openai-secret",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_DEFAULT_MODEL: "gpt-4.1-mini",
    AIRLOCK_ROUTING_LATENCY_FRESHNESS_MS: 30_000,
    AIRLOCK_ROUTING_COST_FRESHNESS_MS: 30_000,
    AIRLOCK_ROUTING_FAILURE_FRESHNESS_MS: 30_000,
    AIRLOCK_ROUTING_RECOVERY_WINDOW_MS: 30_000
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createAdminKeyGovernanceWorkflow", () => {
  it("reuses the same read runtime across repeated read executions", async () => {
    const readRuntime = {
      read: {
        marker: "read"
      }
    };

    workflowMocks.createAdminKeyGovernanceRuntime.mockReturnValue(readRuntime);

    const workflow = createAdminKeyGovernanceWorkflow(createEnv(), "req_123");

    const first = await workflow.withRead((runtime) => runtime);
    const second = await workflow.withRead((runtime) => runtime);

    expect(first).toBe(readRuntime);
    expect(second).toBe(readRuntime);
    expect(workflowMocks.createAdminKeyGovernanceRuntime).toHaveBeenCalledTimes(
      1
    );
    expect(workflowMocks.createAdminKeyGovernanceRuntime).toHaveBeenCalledWith(
      createEnv(),
      "req_123"
    );
  });

  it("resolves the mutation actor command and builds an actor-scoped runtime", async () => {
    const env = createEnv();
    const request = new Request("http://localhost/_airlock/keys");
    const actorContext = {
      actor: "ops@example.com",
      actorSource: "credential" as const
    };
    const mutationPayload = {
      keyIds: ["key_dynamic"]
    };
    const mutationRuntime = {
      write: {
        marker: "write"
      }
    };

    workflowMocks.resolveAdminMutationActorCommand.mockResolvedValue({
      actorContext,
      payload: mutationPayload
    });
    workflowMocks.createAdminKeyGovernanceRuntime.mockReturnValue(
      mutationRuntime
    );

    const workflow = createAdminKeyGovernanceWorkflow(env, "req_123");

    const result = await workflow.withMutation(
      request,
      { keyIds: ["ignored"] },
      "Gateway dynamic key bulk delete payload is invalid",
      ({ mutation, runtime }) => {
        return {
          mutation,
          runtime
        };
      }
    );

    expect(workflowMocks.resolveAdminMutationActorCommand).toHaveBeenCalledWith(
      request,
      env,
      { keyIds: ["ignored"] },
      "req_123",
      "Gateway dynamic key bulk delete payload is invalid"
    );
    expect(workflowMocks.createAdminKeyGovernanceRuntime).toHaveBeenCalledWith(
      env,
      "req_123",
      actorContext
    );
    expect(result).toEqual({
      mutation: {
        actorContext,
        payload: mutationPayload
      },
      runtime: mutationRuntime
    });
  });
});
