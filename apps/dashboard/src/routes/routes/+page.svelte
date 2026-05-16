<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import type { RoutingHealthResponse } from "$lib/api.js";

  let { data } = $props<{
    data: { routingHealth: RoutingHealthResponse | null };
  }>();
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <h2 class="text-xl font-bold text-gray-100 mb-6">Routing Health</h2>

  {#if data.routingHealth}
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
                  >{route.healthyTargetCount}/{route.totalTargetCount}</td
                >
                <td class="px-4 py-3 text-gray-400">{route.strategy ?? "default"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Targets -->
    {#if data.routingHealth.targets}
      <div>
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Targets</h3>
        <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-gray-400 text-left">
                <th class="px-4 py-3">Target</th>
                <th class="px-4 py-3">Circuit State</th>
                <th class="px-4 py-3">Error Rate</th>
                <th class="px-4 py-3">Recovery Score</th>
              </tr>
            </thead>
            <tbody>
              {#each Object.entries(data.routingHealth.targets) as [name, target]}
                <tr class="border-b border-gray-800 last:border-0">
                  <td class="px-4 py-3 text-white font-mono text-xs">{name}</td>
                  <td class="px-4 py-3">
                    <span
                      class="px-2 py-1 rounded text-xs font-medium {target.circuitState ===
                      'closed'
                        ? 'bg-green-900 text-green-300'
                        : target.circuitState === 'open'
                          ? 'bg-red-900 text-red-300'
                          : 'bg-yellow-900 text-yellow-300'}"
                    >
                      {target.circuitState}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-gray-300">
                    {target.healthSnapshot?.errorRate !== undefined
                      ? `${(target.healthSnapshot.errorRate * 100).toFixed(1)}%`
                      : "-"}
                  </td>
                  <td class="px-4 py-3 text-gray-300">
                    {target.healthSnapshot?.recoveryScore !== undefined
                      ? `${(target.healthSnapshot.recoveryScore * 100).toFixed(0)}%`
                      : "-"}
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
