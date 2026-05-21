<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import { Badge } from "$lib/components/ui/badge";
  import type { RoutingHealthResponse } from "$lib/api.js";

  let { data } = $props<{
    data: { routingHealth: RoutingHealthResponse | null };
  }>();

  function stateLabel(state: Record<string, unknown>): string {
    if (typeof state === "string") return state;
    if (state && "state" in state) return String(state.state);
    return "unknown";
  }
  function stateDotColor(state: string): string {
    if (state === "closed") return "bg-success";
    if (state === "open") return "bg-destructive";
    return "bg-warning";
  }
  function healthDot(status: string): string {
    if (status === "healthy") return "bg-success";
    if (status === "degraded") return "bg-warning";
    return "bg-destructive";
  }
</script>

<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item>
      <Breadcrumb.Page>Routes</Breadcrumb.Page>
    </Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>

<div class="mb-3 mt-1">
  <h1 class="text-xl font-semibold tracking-tight">Routing Health</h1>
  <p class="text-xs text-muted-foreground">
    Circuit breaker and target availability
  </p>
</div>

{#if data.routingHealth}
  <div class="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
    <Card.Root>
      <Card.Content>
        <p
          class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium"
        >
          Total
        </p>
        <p class="text-2xl font-bold tracking-tight">
          {Object.keys(data.routingHealth.routes).length}
        </p>
      </Card.Content>
    </Card.Root>
    <Card.Root class="border-t-2 border-t-success">
      <Card.Content>
        <p
          class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium"
        >
          Healthy
        </p>
        <p class="text-2xl font-bold tracking-tight text-success">
          {Object.values(data.routingHealth.routes).filter(
            (r) => r.healthStatus === "healthy"
          ).length}
        </p>
      </Card.Content>
    </Card.Root>
    <Card.Root class="border-t-2 border-t-warning">
      <Card.Content>
        <p
          class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium"
        >
          Degraded
        </p>
        <p class="text-2xl font-bold tracking-tight text-warning">
          {Object.values(data.routingHealth.routes).filter(
            (r) => r.healthStatus === "degraded"
          ).length}
        </p>
      </Card.Content>
    </Card.Root>
    <Card.Root class="border-t-2 border-t-destructive">
      <Card.Content>
        <p
          class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium"
        >
          Down
        </p>
        <p class="text-2xl font-bold tracking-tight text-destructive">
          {Object.values(data.routingHealth.routes).filter(
            (r) => r.healthStatus === "down"
          ).length}
        </p>
      </Card.Content>
    </Card.Root>
  </div>

  {#if data.routingHealth.config}
    <Card.Root class="mb-4">
      <Card.Header>
        <Card.Title
          class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium"
          >Circuit Breaker Policy</Card.Title
        >
      </Card.Header>
      <Card.Content>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p class="text-[10px] text-muted-foreground">Threshold</p>
            <p class="text-sm font-medium">
              {data.routingHealth.config.circuitBreakerPolicy.threshold} failures
            </p>
          </div>
          <div>
            <p class="text-[10px] text-muted-foreground">Cooldown</p>
            <p class="text-sm font-medium">
              {(
                data.routingHealth.config.circuitBreakerPolicy.cooldownMs / 1000
              ).toFixed(0)}s
            </p>
          </div>
          {#if data.routingHealth.config.circuitBreakerPolicy.errorRateWindowMs}
            <div>
              <p class="text-[10px] text-muted-foreground">Error Rate Window</p>
              <p class="text-sm font-medium">
                {(
                  data.routingHealth.config.circuitBreakerPolicy
                    .errorRateWindowMs / 1000
                ).toFixed(0)}s
              </p>
            </div>
          {/if}
          {#if data.routingHealth.config.circuitBreakerPolicy.errorRateThreshold != null}
            <div>
              <p class="text-[10px] text-muted-foreground">
                Error Rate Threshold
              </p>
              <p class="text-sm font-medium">
                {(
                  data.routingHealth.config.circuitBreakerPolicy
                    .errorRateThreshold * 100
                ).toFixed(0)}%
              </p>
            </div>
          {/if}
          <div>
            <p class="text-[10px] text-muted-foreground">Backend</p>
            <p class="text-sm font-medium">
              {data.routingHealth.config.persistentBackend
                ? "Persistent (DO)"
                : "In-memory"}
            </p>
          </div>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <div class="mb-4">
    <p
      class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2"
    >
      Routes
    </p>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Route</Table.Head>
          <Table.Head>Health</Table.Head>
          <Table.Head>Targets</Table.Head>
          <Table.Head>Strategy</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each Object.entries(data.routingHealth.routes) as [name, route]}
          <Table.Row>
            <Table.Cell class="font-mono text-xs font-medium">{name}</Table.Cell
            >
            <Table.Cell>
              <Badge variant="secondary">
                <span
                  class="inline-block size-2 rounded-full {healthDot(
                    route.healthStatus
                  )}"
                ></span>
                {route.healthStatus}
              </Badge>
            </Table.Cell>
            <Table.Cell class="text-xs"
              >{route.healthyTargetCount}/{route.totalTargetCount}
              {#if route.totalTargetCount > 0}<span
                  class="text-muted-foreground"
                  >({(
                    (route.healthyTargetCount / route.totalTargetCount) *
                    100
                  ).toFixed(0)}%)</span
                >{/if}</Table.Cell
            >
            <Table.Cell class="text-xs text-muted-foreground"
              >{route.strategy ?? "default"}</Table.Cell
            >
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  {#if data.routingHealth.targets && Object.keys(data.routingHealth.targets).length > 0}
    <div>
      <p
        class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2"
      >
        Target Details
      </p>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Target</Table.Head>
            <Table.Head>Circuit</Table.Head>
            <Table.Head>Error Rate</Table.Head>
            <Table.Head>Recovery</Table.Head>
            <Table.Head>Freshness</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each Object.entries(data.routingHealth.targets) as [name, target]}
            {@const state = stateLabel(target.circuitState)}
            <Table.Row>
              <Table.Cell class="font-mono text-xs">{name}</Table.Cell>
              <Table.Cell>
                <Badge variant="secondary">
                  <span
                    class="inline-block size-2 rounded-full {stateDotColor(
                      state
                    )}"
                  ></span>
                  {state}
                </Badge>
              </Table.Cell>
              <Table.Cell class="text-xs"
                >{#if target.metrics?.errorRate != null}<span
                    class={target.metrics.errorRate > 0.1
                      ? "text-destructive"
                      : target.metrics.errorRate > 0.01
                        ? "text-warning"
                        : "text-success"}
                    >{(target.metrics.errorRate * 100).toFixed(1)}%</span
                  >{:else}<span class="text-muted-foreground">-</span
                  >{/if}</Table.Cell
              >
              <Table.Cell class="text-xs"
                >{#if target.metrics?.recoveryScore != null}{(
                    target.metrics.recoveryScore * 100
                  ).toFixed(0)}%{:else}<span class="text-muted-foreground"
                    >-</span
                  >{/if}</Table.Cell
              >
              <Table.Cell class="text-xs text-muted-foreground"
                >{#if target.metrics?.freshness}lat: {target.metrics.freshness
                    .latencyFreshMs ?? "-"}ms / fail: {target.metrics.freshness
                    .failureFreshMs ?? "-"}ms{:else}-{/if}</Table.Cell
              >
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
{:else}
  <Card.Root class="py-4 text-center">
    <Card.Content>
      <p class="text-sm text-muted-foreground">
        Failed to load routing health.
      </p>
    </Card.Content>
  </Card.Root>
{/if}
