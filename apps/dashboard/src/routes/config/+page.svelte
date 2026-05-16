<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import type { AdminConfigResponse } from "$lib/api.js";

  let { data } = $props<{ data: { config: AdminConfigResponse | null } }>();
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <h2 class="text-xl font-bold text-gray-100 mb-6">Configuration</h2>

  {#if data.config}
    <!-- Providers -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Providers</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        {#each Object.entries(data.config.providers) as [name, provider]}
          {@const p = provider as Record<string, unknown> | undefined}
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="font-medium text-white capitalize mb-1">{name}</p>
            {#if p?.baseUrl}
              <p class="text-sm text-gray-400 font-mono">{p.baseUrl as string}</p>
            {:else}
              <p class="text-sm text-gray-500">Not configured</p>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Routes -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Routes ({data.config.routes.length})</h3>
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 text-gray-400 text-left">
              <th class="px-4 py-3">External Model</th>
              <th class="px-4 py-3">Target</th>
              <th class="px-4 py-3">Fallbacks</th>
              <th class="px-4 py-3">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {#each data.config.routes as route}
              <tr class="border-b border-gray-800 last:border-0">
                <td class="px-4 py-3 text-white font-medium">{route.externalModel}</td>
                <td class="px-4 py-3 text-gray-300 font-mono text-xs"
                  >{route.target.provider}/{route.target.providerModel}</td
                >
                <td class="px-4 py-3 text-gray-400">{route.fallbacks?.length ?? 0}</td>
                <td class="px-4 py-3 text-gray-400">{route.strategy ?? "default"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Features -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Features</h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        {#each Object.entries(data.config.features) as [feature, enabled]}
          <div
            class="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center justify-between"
          >
            <span class="text-sm text-gray-300">{feature}</span>
            <span
              class="w-3 h-3 rounded-full {enabled ? 'bg-green-500' : 'bg-gray-700'}"
            ></span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Limits -->
    <div>
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Limits</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        {#each Object.entries(data.config.limits) as [name, value]}
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400">{name}</p>
            <p class="text-lg font-semibold text-white">{value as number}</p>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
      <p class="text-gray-400">Failed to load configuration.</p>
    </div>
  {/if}
</main>
