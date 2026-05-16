<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import type { RoutingHealthResponse } from "$lib/api.js";

  let { data } = $props<{
    data: { routingHealth: RoutingHealthResponse | null };
  }>();

  function stateLabel(state: Record<string, unknown>): string {
    if (typeof state === "string") return state;
    if (state && "state" in state) return String(state.state);
    return "unknown";
  }

  function stateColor(state: string): string {
    if (state === "closed") return "bg-green-900 text-green-300";
    if (state === "open") return "bg-red-900 text-red-300";
    return "bg-yellow-900 text-yellow-300";
  }
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <h2 class="text-xl font-bold text-gray-100 mb-6">Routing Health</h2>

  {#if data.routingHealth}
    <!-- Health Overview -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Total Routes</p>
        <p class="text-2xl font-bold text-white">{Object.keys(data.routingHealth.routes).length}</p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Healthy</p>
        <p class="text-2xl font-bold text-green-400">
          {Object.values(data.routingHealth.routes).filter(r => r.healthStatus === "healthy").length}
        </p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Degraded</p>
        <p class="text-2xl font-bold text-yellow-400">
          {Object.values(data.routingHealth.routes).filter(r => r.healthStatus === "degraded").length}
        </p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Down</p>
        <p class="text-2xl font-bold text-red-400">
          {Object.values(data.routingHealth.routes).filter(r => r.healthStatus === "down").length}
        </p>
      </div>
    </div>

    <!-- Circuit Breaker Config -->
    {#if data.routingHealth.config}
      <div class="mb-8">
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Circuit Breaker Policy</h3>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span class="text-gray-400">Threshold</span>
              <p class="text-white">{data.routingHealth.config.circuitBreakerPolicy.threshold} failures</p>
            </div>
            <div>
              <span class="text-gray-400">Cooldown</span>
              <p class="text-white">{(data.routingHealth.config.circuitBreakerPolicy.cooldownMs / 1000).toFixed(0)}s</p>
            </div>
            {#if data.routingHealth.config.circuitBreakerPolicy.errorRateWindowMs}
              <div>
                <span class="text-gray-400">Error Rate Window</span>
                <p class="text-white">{(data.routingHealth.config.circuitBreakerPolicy.errorRateWindowMs / 1000).toFixed(0)}s</p>
              </div>
            {/if}
            {#if data.routingHealth.config.circuitBreakerPolicy.errorRateThreshold != null}
              <div>
                <span class="text-gray-400">Error Rate Threshold</span>
                <p class="text-white">{(data.routingHealth.config.circuitBreakerPolicy.errorRateThreshold * 100).toFixed(0)}%</p>
              </div>
            {/if}
            <div>
              <span class="text-gray-400">Backend</span>
              <p class="text-white">{data.routingHealth.config.persistentBackend ? "Persistent (DO)" : "In-memory"}</p>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Routes -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Routes</h3>
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 text-gray-400 text-left">
              <th class="px-4 py-3">Route</th>
              <th class="px-4 py-3">Health</th>
              <th class="px-4 py-3">Targets</th>
              <th class="px-4 py-3">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(data.routingHealth.routes) as [name, route]}
              <tr class="border-b border-gray-800 last:border-0">
                <td class="px-4 py-3 text-white font-medium font-mono text-xs">{name}</td>
                <td class="px-4 py-3">
                  <span
                    class="px-2 py-1 rounded text-xs font-medium {route.healthStatus ===
                    'healthy'
                      ? 'bg-green-900 text-green-300'
                      : route.healthStatus === 'degraded'
                        ? 'bg-yellow-900 text-yellow-300'
                        : 'bg-red-900 text-red-300'}"
                  >
                    {route.healthStatus}
                  </span>
                </td>
                <td class="px-4 py-3 text-gray-300">
                  {route.healthyTargetCount}/{route.totalTargetCount}
                  {#if route.totalTargetCount > 0}
                    <span class="text-gray-500 text-xs ml-1">({((route.healthyTargetCount / route.totalTargetCount) * 100).toFixed(0)}%)</span>
                  {/if}
                </td>
                <td class="px-4 py-3">
                  <span class="px-2 py-1 rounded text-xs bg-purple-900/50 text-purple-300">{route.strategy ?? "default"}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Targets Detail -->
    {#if data.routingHealth.targets && Object.keys(data.routingHealth.targets).length > 0}
      <div>
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Target Details</h3>
        <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-gray-400 text-left">
                <th class="px-4 py-3">Target</th>
                <th class="px-4 py-3">Circuit State</th>
                <th class="px-4 py-3">Error Rate</th>
                <th class="px-4 py-3">Recovery Score</th>
                <th class="px-4 py-3">Data Freshness</th>
              </tr>
            </thead>
            <tbody>
              {#each Object.entries(data.routingHealth.targets) as [name, target]}
                {@const state = stateLabel(target.circuitState)}
                <tr class="border-b border-gray-800 last:border-0">
                  <td class="px-4 py-3 text-white font-mono text-xs">{name}</td>
                  <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded text-xs font-medium {stateColor(state)}">
                      {state}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    {#if target.metrics?.errorRate != null}
                      <span class={target.metrics.errorRate > 0.1 ? "text-red-400" : target.metrics.errorRate > 0.01 ? "text-yellow-400" : "text-green-400"}>
                        {(target.metrics.errorRate * 100).toFixed(1)}%
                      </span>
                    {:else}
                      <span class="text-gray-600">-</span>
                    {/if}
                  </td>
                  <td class="px-4 py-3">
                    {#if target.metrics?.recoveryScore != null}
                      <span class="text-gray-300">{(target.metrics.recoveryScore * 100).toFixed(0)}%</span>
                    {:else}
                      <span class="text-gray-600">-</span>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-gray-400 text-xs">
                    {#if target.metrics?.freshness}
                      <span>lat: {target.metrics.freshness.latencyFreshMs ?? "-"}ms</span>
                      <span class="mx-1">|</span>
                      <span>fail: {target.metrics.freshness.failureFreshMs ?? "-"}ms</span>
                    {:else}
                      -
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
      <p class="text-gray-400">Failed to load routing health data.</p>
    </div>
  {/if}
</main>
