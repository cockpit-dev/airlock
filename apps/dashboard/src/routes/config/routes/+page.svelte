<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import { createClient, getStoredCredentials } from "$lib/auth.js";

  type ProviderTarget = {
    provider: string;
    providerModel: string;
  };

  type RouteConfig = {
    externalModel: string;
    target: ProviderTarget;
    fallbacks?: ProviderTarget[];
    strategy?: string;
    requiredKeyTier?: string;
    requiredKeyTags?: string[];
  };

  type RoutesConfig = RouteConfig[];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let editRouteIndex = $state<number | null>(null);
  let showCreateForm = $state(false);

  let routes = $state<RoutesConfig>([]);

  const providerOptions = ["openai", "anthropic", "gemini"];
  const strategyOptions = [
    "weighted",
    "lowest_cost",
    "health_priority",
    "priority",
    "health_score"
  ];

  // Create/edit form state
  let formExternalModel = $state("");
  let formTargetProvider = $state("openai");
  let formTargetModel = $state("");
  let formFallbacks = $state<ProviderTarget[]>([]);
  let formStrategy = $state("");
  let formRequiredKeyTier = $state("");
  let formRequiredKeyTags = $state("");

  const fieldIds = {
    externalModel: "route-external-model",
    targetStrategy: "route-target-strategy",
    targetProvider: "route-target-provider",
    targetModel: "route-target-model",
    requiredKeyTier: "route-required-key-tier",
    requiredKeyTags: "route-required-key-tags",
    fallbackTargets: "route-fallback-targets"
  };

  function resetForm() {
    formExternalModel = "";
    formTargetProvider = "openai";
    formTargetModel = "";
    formFallbacks = [];
    formStrategy = "";
    formRequiredKeyTier = "";
    formRequiredKeyTags = "";
  }

  function loadFormFromRoute(route: RouteConfig) {
    formExternalModel = route.externalModel;
    formTargetProvider = route.target.provider;
    formTargetModel = route.target.providerModel;
    formFallbacks = route.fallbacks ? route.fallbacks.map((f) => ({ ...f })) : [];
    formStrategy = route.strategy ?? "";
    formRequiredKeyTier = route.requiredKeyTier ?? "";
    formRequiredKeyTags = route.requiredKeyTags?.join(", ") ?? "";
  }

  async function loadConfig() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    try {
      const snapshot = await client.getConfigStoreSnapshot();
      const section = snapshot.sections["routes"];
      if (section?.data && Array.isArray(section.data)) {
        routes = section.data as RoutesConfig;
      }
    } catch {
      // Config store may not be initialized yet
    } finally {
      loading = false;
    }
  }

  async function saveRoutes() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    saving = true;
    error = "";
    success = "";

    try {
      await client.putConfigStoreSection("routes", routes);
      success = "Routes configuration saved";
      editRouteIndex = null;
      showCreateForm = false;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save";
    } finally {
      saving = false;
    }
  }

  function startCreate() {
    resetForm();
    showCreateForm = true;
    editRouteIndex = null;
  }

  function startEdit(index: number) {
    const route = routes[index];
    if (!route) return;
    loadFormFromRoute(route);
    editRouteIndex = index;
    showCreateForm = false;
  }

  function cancelEdit() {
    editRouteIndex = null;
    showCreateForm = false;
    resetForm();
  }

  function applyCreate() {
    if (!formExternalModel.trim() || !formTargetModel.trim()) {
      error = "External model and target model are required";
      return;
    }
    error = "";

    const newRoute: RouteConfig = {
      externalModel: formExternalModel.trim(),
      target: {
        provider: formTargetProvider,
        providerModel: formTargetModel.trim()
      },
      ...(formFallbacks.length > 0 ? { fallbacks: formFallbacks } : {}),
      ...(formStrategy ? { strategy: formStrategy } : {}),
      ...(formRequiredKeyTier.trim()
        ? { requiredKeyTier: formRequiredKeyTier.trim() }
        : {}),
      ...(formRequiredKeyTags.trim()
        ? {
            requiredKeyTags: formRequiredKeyTags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t)
          }
        : {})
    };

    routes = [...routes, newRoute];
    showCreateForm = false;
    resetForm();
    saveRoutes();
  }

  function applyEdit() {
    if (editRouteIndex === null) return;
    if (!formExternalModel.trim() || !formTargetModel.trim()) {
      error = "External model and target model are required";
      return;
    }
    error = "";

    const updatedRoute: RouteConfig = {
      externalModel: formExternalModel.trim(),
      target: {
        provider: formTargetProvider,
        providerModel: formTargetModel.trim()
      },
      ...(formFallbacks.length > 0 ? { fallbacks: formFallbacks } : {}),
      ...(formStrategy ? { strategy: formStrategy } : {}),
      ...(formRequiredKeyTier.trim()
        ? { requiredKeyTier: formRequiredKeyTier.trim() }
        : {}),
      ...(formRequiredKeyTags.trim()
        ? {
            requiredKeyTags: formRequiredKeyTags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t)
          }
        : {})
    };

    routes = routes.map((r, i) => (i === editRouteIndex ? updatedRoute : r));
    editRouteIndex = null;
    resetForm();
    saveRoutes();
  }

  function deleteRoute(index: number) {
    if (!confirm("Delete this route? This cannot be undone.")) return;
    routes = routes.filter((_, i) => i !== index);
    saveRoutes();
  }

  function addFallback() {
    formFallbacks = [...formFallbacks, { provider: "openai", providerModel: "" }];
  }

  function removeFallback(index: number) {
    formFallbacks = formFallbacks.filter((_, i) => i !== index);
  }

  function updateFallback(
    index: number,
    field: "provider" | "providerModel",
    value: string
  ) {
    formFallbacks = formFallbacks.map((f, i) =>
      i === index ? { ...f, [field]: value } : f
    );
  }

  loadConfig();
</script>

<Nav />

<main class="max-w-5xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Route Configuration</h2>
    <div class="flex gap-3">
      <a href="/config" class="text-sm text-blue-400 hover:text-blue-300"
        >&larr; Back to Config</a
      >
      <button
        type="button"
        class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium"
        onclick={startCreate}
      >
        + Add Route
      </button>
    </div>
  </div>

  {#if error}
    <div
      class="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm"
    >
      {error}
    </div>
  {/if}

  {#if success}
    <div
      class="bg-green-900/30 border border-green-800 rounded-lg p-3 mb-4 text-green-300 text-sm"
    >
      {success}
    </div>
  {/if}

  {#if loading}
    <div class="text-gray-400 text-center py-12">Loading configuration...</div>
  {:else}
    <!-- Create Form -->
    {#if showCreateForm}
      {@render routeForm("Create Route", applyCreate)}
    {/if}

    <!-- Routes List -->
    <div class="space-y-3">
      {#each routes as route, index}
        {#if editRouteIndex === index}
          {@render routeForm("Edit Route", applyEdit)}
        {:else}
          <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <div
              class="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-850"
            >
              <div class="flex items-center gap-4">
                <span class="font-mono text-white font-medium text-sm"
                  >{route.externalModel}</span
                >
                <span class="text-gray-500">&rarr;</span>
                <span class="px-2 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300"
                  >{route.target.provider}</span
                >
                <span class="font-mono text-xs text-gray-300"
                  >{route.target.providerModel}</span
                >
                {#if route.fallbacks && route.fallbacks.length > 0}
                  <span class="text-gray-500 text-xs"
                    >+{route.fallbacks.length} fallback{route.fallbacks.length > 1
                      ? "s"
                      : ""}</span
                  >
                {/if}
                {#if route.strategy}
                  <span
                    class="px-2 py-0.5 rounded text-xs bg-purple-900/50 text-purple-300"
                    >{route.strategy}</span
                  >
                {/if}
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-700 rounded"
                  onclick={() => startEdit(index)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="px-2 py-1 text-xs text-red-400 hover:text-red-300 border border-red-900 rounded"
                  onclick={() => deleteRoute(index)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        {/if}
      {/each}

      {#if routes.length === 0 && !showCreateForm}
        <div class="text-center py-12 text-gray-500">
          No routes configured. Click "Add Route" to create one.
        </div>
      {/if}
    </div>
  {/if}
</main>

{#snippet routeForm(title: string, onSave: () => void)}
  <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4 space-y-4">
    <h3 class="text-lg font-semibold text-white">{title}</h3>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-gray-400 mb-1" for={fieldIds.externalModel}>External Model</label>
        <input
          id={fieldIds.externalModel}
          type="text"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
          placeholder="gpt-4.1-mini"
          bind:value={formExternalModel}
        />
      </div>

      <div>
        <label class="block text-sm text-gray-400 mb-1" for={fieldIds.targetStrategy}>Target Strategy</label>
        <select
          id={fieldIds.targetStrategy}
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          bind:value={formStrategy}
        >
          <option value="">Default</option>
          {#each strategyOptions as strategy}
            <option value={strategy}>{strategy}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-gray-400 mb-1" for={fieldIds.targetProvider}>Target Provider</label>
        <select
          id={fieldIds.targetProvider}
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          bind:value={formTargetProvider}
        >
          {#each providerOptions as provider}
            <option value={provider}>{provider}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-400 mb-1" for={fieldIds.targetModel}>Target Model</label>
        <input
          id={fieldIds.targetModel}
          type="text"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
          placeholder="gpt-4.1-mini"
          bind:value={formTargetModel}
        />
      </div>
    </div>

    <!-- Fallbacks -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-400" id={fieldIds.fallbackTargets}>Fallback Targets</span>
        <button
          type="button"
          class="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 border border-blue-900 rounded"
          onclick={addFallback}
        >
          + Add Fallback
        </button>
      </div>
      <div aria-labelledby={fieldIds.fallbackTargets}>
      {#each formFallbacks as fb, i}
        <div class="flex items-center gap-2 mb-2">
          <select
            class="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
            value={fb.provider}
            onchange={(e) =>
              updateFallback(i, "provider", (e.target as HTMLSelectElement).value)}
          >
            {#each providerOptions as provider}
              <option value={provider}>{provider}</option>
            {/each}
          </select>
          <input
            type="text"
            class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-blue-500"
            placeholder="model-name"
            value={fb.providerModel}
            oninput={(e) =>
              updateFallback(
                i,
                "providerModel",
                (e.target as HTMLInputElement).value
              )}
          />
          <button
            type="button"
            class="px-2 py-1 text-xs text-red-400 hover:text-red-300"
            onclick={() => removeFallback(i)}
          >
            &times;
          </button>
        </div>
      {/each}
      </div>
    </div>

    <!-- Key Access Policy -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block text-sm text-gray-400 mb-1" for={fieldIds.requiredKeyTier}>Required Key Tier</label>
        <input
          id={fieldIds.requiredKeyTier}
          type="text"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="(optional)"
          bind:value={formRequiredKeyTier}
        />
      </div>

      <div>
        <label class="block text-sm text-gray-400 mb-1" for={fieldIds.requiredKeyTags}>Required Key Tags</label>
        <input
          id={fieldIds.requiredKeyTags}
          type="text"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="tag1, tag2 (comma separated)"
          bind:value={formRequiredKeyTags}
        />
      </div>
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <button
        type="button"
        class="px-4 py-2 text-gray-400 hover:text-white text-sm rounded border border-gray-700"
        onclick={cancelEdit}
      >
        Cancel
      </button>
      <button
        type="button"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium disabled:opacity-50"
        onclick={onSave}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  </div>
{/snippet}
