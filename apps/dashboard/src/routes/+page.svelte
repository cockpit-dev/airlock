<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import type {
    GatewayStatusResponse,
    MetricsSnapshot,
    RoutingHealthResponse
  } from "$lib/api.js";
  import { onMount } from "svelte";

  let { data } = $props<{
    data: {
      status: GatewayStatusResponse | null;
      metrics: MetricsSnapshot | null;
      routingHealth: RoutingHealthResponse | null;
    };
  }>();

  let statusChartEl: HTMLCanvasElement | undefined = $state();
  let routeChartEl: HTMLCanvasElement | undefined = $state();

  onMount(async () => {
    const { Chart, ArcElement, DoughnutController, Tooltip, Legend } = await import("chart.js");
    Chart.register(ArcElement, DoughnutController, Tooltip, Legend);

    const m = data.metrics;
    if (m && statusChartEl) {
      const ok = m.requests - m.errors;
      new Chart(statusChartEl, {
        type: "doughnut",
        data: {
          labels: ["Success", "Error"],
          datasets: [{
            data: [ok, m.errors],
            backgroundColor: ["#22c55e", "#ef4444"],
            borderColor: ["#166534", "#991b1b"],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: "#9ca3af" } }
          }
        }
      });
    }

    const rh = data.routingHealth;
    if (rh && routeChartEl) {
      const routeEntries = Object.entries(rh.routes);
      if (routeEntries.length > 0) {
        const healthy = routeEntries.filter(([, r]) => r.healthStatus === "healthy").length;
        const degraded = routeEntries.filter(([, r]) => r.healthStatus === "degraded").length;
        const down = routeEntries.length - healthy - degraded;
        new Chart(routeChartEl, {
          type: "doughnut",
          data: {
            labels: ["Healthy", "Degraded", "Down"],
            datasets: [{
              data: [healthy, degraded, down],
              backgroundColor: ["#22c55e", "#eab308", "#ef4444"],
              borderColor: ["#166534", "#854d0e", "#991b1b"],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: true, labels: { color: "#9ca3af" } }
            }
          }
        });
      }
    }
  });
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Dashboard</h2>
    {#if data.status}
      <span class="text-xs text-gray-500 font-mono">fingerprint: {data.status.configFingerprint.slice(0, 12)}...</span>
    {/if}
  </div>

  {#if data.status}
    <!-- Status Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Mode</p>
        <p class="text-lg font-semibold text-white uppercase">{data.status.mode}</p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Routes</p>
        <p class="text-lg font-semibold text-white">{data.status.routes.length}</p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Keys</p>
        <p class="text-lg font-semibold text-white">
          {data.status.keys.total}
          <span class="text-sm text-gray-500">({data.status.keys.registryOwned} registry)</span>
        </p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <p class="text-sm text-gray-400 mb-1">Circuit Breakers</p>
        <p class="text-lg font-semibold text-white">
          <span class={data.status.circuitBreaker.openTargets.length > 0 ? "text-red-400" : "text-green-400"}>
            {data.status.circuitBreaker.openTargets.length}
          </span>
          <span class="text-sm text-gray-500">open / {data.status.circuitBreaker.totalTargets} total</span>
        </p>
      </div>
    </div>

    <!-- Metrics + Charts Row -->
    {#if data.metrics}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <!-- Metric Cards -->
        <div class="space-y-4">
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400 mb-1">Total Requests</p>
            <p class="text-2xl font-bold text-white">{data.metrics.requests.toLocaleString()}</p>
            <p class="text-xs text-gray-500 mt-1">window: {(data.metrics.window.durationMs / 1000).toFixed(0)}s</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400 mb-1">Error Rate</p>
            <p class="text-2xl font-bold text-white">
              <span class={data.metrics.errorRate > 0.05 ? "text-red-400" : data.metrics.errorRate > 0.01 ? "text-yellow-400" : "text-green-400"}>
                {(data.metrics.errorRate * 100).toFixed(1)}%
              </span>
            </p>
            <p class="text-xs text-gray-500 mt-1">{data.metrics.errors} errors</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400 mb-1">Avg Latency</p>
            <p class="text-2xl font-bold text-white">
              <span class={data.metrics.avgDurationMs > 3000 ? "text-red-400" : data.metrics.avgDurationMs > 1000 ? "text-yellow-400" : "text-green-400"}>
                {data.metrics.avgDurationMs}ms
              </span>
            </p>
          </div>
        </div>

        <!-- Success/Error Chart -->
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 class="text-sm font-medium text-gray-300 mb-3">Request Status</h4>
          <div class="h-48">
            <canvas bind:this={statusChartEl}></canvas>
          </div>
        </div>

        <!-- Route Health Chart -->
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 class="text-sm font-medium text-gray-300 mb-3">Route Health</h4>
          <div class="h-48">
            <canvas bind:this={routeChartEl}></canvas>
          </div>
        </div>
      </div>

      <!-- Status Code Distribution -->
      {#if Object.keys(data.metrics.statusCodes).length > 0}
        <div class="mb-8">
          <h3 class="text-lg font-semibold text-gray-200 mb-3">Status Codes</h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            {#each Object.entries(data.metrics.statusCodes).sort(([a], [b]) => Number(a) - Number(b)) as [code, count]}
              <div class="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
                <p class="text-lg font-bold {Number(code) < 300 ? 'text-green-400' : Number(code) < 400 ? 'text-yellow-400' : 'text-red-400'}">{code}</p>
                <p class="text-sm text-gray-400">{count}</p>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Per-Route Metrics -->
      {#if Object.keys(data.metrics.byRoute).length > 0}
        <div class="mb-8">
          <h3 class="text-lg font-semibold text-gray-200 mb-3">Route Metrics</h3>
          <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-800 text-gray-400 text-left">
                  <th class="px-4 py-3">Route</th>
                  <th class="px-4 py-3">Requests</th>
                  <th class="px-4 py-3">Errors</th>
                  <th class="px-4 py-3">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {#each Object.entries(data.metrics.byRoute) as [name, rm]}
                  <tr class="border-b border-gray-800 last:border-0">
                    <td class="px-4 py-3 text-white font-mono text-xs">{name}</td>
                    <td class="px-4 py-3 text-gray-300">{rm.requests.toLocaleString()}</td>
                    <td class="px-4 py-3">
                      <span class={rm.errors > 0 ? "text-red-400" : "text-gray-300"}>{rm.errors}</span>
                    </td>
                    <td class="px-4 py-3">
                      <span class={rm.avgDurationMs > 3000 ? "text-red-400" : rm.avgDurationMs > 1000 ? "text-yellow-400" : "text-gray-300"}>
                        {rm.avgDurationMs}ms
                      </span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    {/if}

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
