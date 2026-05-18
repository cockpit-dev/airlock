<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import type { AdminConfigResponse } from "$lib/api.js";
  import { getStoredCredentials } from "$lib/auth.js";

  let { data } = $props<{ data: { config: AdminConfigResponse | null } }>();
  const hasRemoteGatewayCredentials = $derived(Boolean(getStoredCredentials()));

  const providerLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Google Gemini"
  };
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <h2 class="text-xl font-bold text-gray-100 mb-6">Configuration</h2>

  {#if data.config}
    <!-- Providers -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Providers</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        {#each data.config.providers as provider}
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-5">
            <div class="flex items-center justify-between mb-3">
              <p class="font-semibold text-white">
                {provider.id}
              </p>
              {#if provider.configured}
                <span
                  class="px-2 py-1 rounded text-xs font-medium bg-green-900 text-green-300"
                  >Active</span
                >
              {:else}
                <span
                  class="px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-500"
                  >Not configured</span
                >
              {/if}
            </div>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-400">Adapter</span>
                <span class="text-gray-300"
                  >{providerLabels[provider.type] ?? provider.type}</span
                >
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Base URL</span>
                <span class="text-gray-300 font-mono text-xs"
                  >{provider.baseUrl}</span
                >
              </div>
              {#if "defaultModel" in provider}
                <div class="flex justify-between">
                  <span class="text-gray-400">Default Model</span>
                  <span class="text-gray-300 font-mono text-xs"
                    >{provider.defaultModel}</span
                  >
                </div>
              {/if}
              {#if "defaultMaxTokens" in provider}
                <div class="flex justify-between">
                  <span class="text-gray-400">Max Tokens</span>
                  <span class="text-gray-300"
                    >{provider.defaultMaxTokens.toLocaleString()}</span
                  >
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Routes -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">
        Routes ({data.config.routes.length})
      </h3>
      <div
        class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
      >
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
                <td class="px-4 py-3 text-white font-medium font-mono"
                  >{route.externalModel}</td
                >
                <td class="px-4 py-3">
                  <div class="text-gray-300">
                    <span
                      class="px-1.5 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300"
                      >{route.target.provider}</span
                    >
                    <span class="text-gray-500 mx-1">/</span>
                    <span class="font-mono text-xs"
                      >{route.target.providerModel}</span
                    >
                  </div>
                </td>
                <td class="px-4 py-3 text-gray-400">
                  {#if route.fallbacks && route.fallbacks.length > 0}
                    <div class="space-y-1">
                      {#each route.fallbacks as fb}
                        <div class="text-xs">
                          <span
                            class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300"
                            >{fb.provider}</span
                          >
                          <span class="text-gray-500">/</span>
                          <span class="font-mono">{fb.providerModel}</span>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <span class="text-gray-600">none</span>
                  {/if}
                </td>
                <td class="px-4 py-3">
                  {#if route.strategy}
                    <span
                      class="px-2 py-1 rounded text-xs bg-purple-900/50 text-purple-300"
                      >{route.strategy}</span
                    >
                  {:else}
                    <span class="text-gray-600">default</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Model Groups -->
    {#if Object.keys(data.config.modelGroups).length > 0}
      <div class="mb-8">
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Model Groups</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each Object.entries(data.config.modelGroups) as [group, models]}
            <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <p class="font-medium text-white mb-2">{group}</p>
              <div class="flex flex-wrap gap-1">
                {#each models as model}
                  <span
                    class="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-300 font-mono"
                    >{model}</span
                  >
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Features -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Features</h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        {#each Object.entries(data.config.features) as [feature, value]}
          {@const enabled = typeof value === "boolean" ? value : value.enabled}
          <div
            class="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center justify-between"
          >
            <span class="text-sm text-gray-300">{feature}</span>
            <span
              class="w-3 h-3 rounded-full {enabled
                ? 'bg-green-500'
                : 'bg-gray-700'}"
            ></span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Keys Summary -->
    <div class="mb-8">
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Keys</h3>
      <div class="grid grid-cols-3 gap-4">
        <div
          class="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center"
        >
          <p class="text-2xl font-bold text-white">{data.config.keys.total}</p>
          <p class="text-sm text-gray-400">Total</p>
        </div>
        <div
          class="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center"
        >
          <p class="text-2xl font-bold text-white">
            {data.config.keys.configured}
          </p>
          <p class="text-sm text-gray-400">Configured</p>
        </div>
        <div
          class="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center"
        >
          <p class="text-2xl font-bold text-white">
            {data.config.keys.registryOwned}
          </p>
          <p class="text-sm text-gray-400">Registry</p>
        </div>
      </div>
    </div>

    <!-- Limits -->
    <div>
      <h3 class="text-lg font-semibold text-gray-200 mb-3">Limits</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        {#each Object.entries(data.config.limits) as [name, value]}
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <p class="text-sm text-gray-400">{name}</p>
            <p class="text-lg font-semibold text-white">
              {typeof value === "number" && value >= 1000
                ? value >= 1_000_000
                  ? (value / 1_000_000).toFixed(1) + "MB"
                  : (value / 1000).toFixed(0) + "ms"
                : String(value)}
            </p>
          </div>
        {/each}
      </div>
    </div>
  {:else if !hasRemoteGatewayCredentials}
    <div class="rounded-xl border border-amber-800/70 bg-amber-950/40 p-5">
      <p class="text-sm leading-6 text-amber-100/80">
        Connect this dashboard to a gateway admin endpoint before viewing active
        runtime configuration.
      </p>
      <a
        href="/login"
        class="mt-3 inline-flex rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-900/40"
      >
        Connect Gateway
      </a>
    </div>
  {:else}
    <div class="rounded-xl border border-red-900/70 bg-red-950/30 p-5">
      <p class="text-sm leading-6 text-red-200/80">
        Failed to load active gateway configuration.
      </p>
    </div>
  {/if}
</main>
