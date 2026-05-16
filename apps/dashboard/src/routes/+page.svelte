<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import type {
    GatewayStatusResponse,
    MetricsSnapshot,
    RoutingHealthResponse
  } from "$lib/api.js";

  let { data } = $props<{
    data: {
      status: GatewayStatusResponse | null;
      metrics: MetricsSnapshot | null;
      routingHealth: RoutingHealthResponse | null;
    };
  }>();
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <h2 class="text-xl font-bold text-gray-100 mb-6">Dashboard</h2>

  {#if data.status}
    <!-- Status Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400">Mode</p>
        <p class="text-lg font-semibold text-white">{data.status.mode}</p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400">Routes</p>
        <p class="text-lg font-semibold text-white">{data.status.routes.length}</p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400">Keys</p>
        <p class="text-lg font-semibold text-white">
          {data.status.keys.total}
          <span class="text-sm text-gray-500"
            >({data.status.keys.registryOwned} registry)</span
          >
        </p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400">Circuit Breakers</p>
        <p class="text-lg font-semibold text-white">
          {data.status.circuitBreaker.openTargets}
          <span class="text-sm text-gray-500">open / {data.status.circuitBreaker.totalTargets} total</span>
        </p>
      </div>
    </div>

    <!-- Providers -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Providers</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        {#each data.status.providers as provider}
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p class="font-medium text-white">{provider.id}</p>
              <p class="text-sm text-gray-400">{provider.routeCount} route{provider.routeCount !== 1 ? 's' : ''}</p>
            </div>
            <span
              class="px-2 py-1 rounded text-xs font-medium {provider.configured
                ? 'bg-green-900 text-green-300'
                : 'bg-gray-800 text-gray-500'}"
            >
              {provider.configured ? "Configured" : "Not configured"}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Metrics -->
    {#if data.metrics}
      <div class="mb-8">
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Request Metrics</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400">Total Requests</p>
            <p class="text-2xl font-bold text-white">{data.metrics.requests.total}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400">Error Rate</p>
            <p class="text-2xl font-bold text-white">
              {data.metrics.requests.total > 0
                ? ((data.metrics.requests.errors / data.metrics.requests.total) * 100).toFixed(1)
                : 0}%
            </p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400">Avg Latency</p>
            <p class="text-2xl font-bold text-white">{data.metrics.requests.avgDurationMs.toFixed(0)}ms</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Routing Health -->
    {#if data.routingHealth?.routes}
      <div>
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Route Health</h3>
        <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-gray-400 text-left">
                <th class="px-4 py-3">Route</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Healthy / Total</th>
                <th class="px-4 py-3">Strategy</th>
              </tr>
            </thead>
            <tbody>
              {#each Object.entries(data.routingHealth.routes) as [name, route]}
                <tr class="border-b border-gray-800 last:border-0">
                  <td class="px-4 py-3 text-white font-medium">{name}</td>
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
                  <td class="px-4 py-3 text-gray-300"
                    >{route.healthyTargetCount} / {route.totalTargetCount}</td
                  >
                  <td class="px-4 py-3 text-gray-400">{route.strategy ?? "default"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
      <p class="text-gray-400">Failed to load gateway status. Check your connection.</p>
    </div>
  {/if}
</main>
