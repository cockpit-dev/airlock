<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import { createClient, getStoredCredentials } from "$lib/auth.js";

  type ProviderType = "openai" | "anthropic" | "gemini";

  type ProviderConfig = {
    id: string;
    type: ProviderType;
    apiKey: string;
    baseUrl: string;
    defaultModel?: string;
    defaultMaxTokens?: number;
    protocols?: string[];
    extendedHeaders?: Record<string, string>;
    extendedQueryParams?: Record<string, string>;
    extendedBodyInjections?: Record<string, unknown>;
  };

  type ProvidersConfig = ProviderConfig[];

  const providerTypes: ProviderType[] = ["openai", "anthropic", "gemini"];
  const providerTypeLabels: Record<ProviderType, string> = {
    openai: "OpenAI-compatible",
    anthropic: "Anthropic-compatible",
    gemini: "Gemini-compatible"
  };
  const providerDefaultUrls: Record<ProviderType, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com/v1beta"
  };
  const allProtocols = [
    "openai_chat",
    "openai_responses",
    "anthropic_messages"
  ];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let editProvider = $state<string | null>(null);
  let providers = $state<ProvidersConfig>([]);

  let newProviderKey = $state("");
  let newProviderType = $state<ProviderType>("openai");

  function providerFieldId(providerKey: string, field: string) {
    return `provider-${providerKey.replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}`;
  }

  function createProviderConfig(
    id: string,
    type: ProviderType
  ): ProviderConfig {
    return {
      id,
      type,
      apiKey: "",
      baseUrl: providerDefaultUrls[type],
      ...(type === "openai" ? { defaultModel: "gpt-4.1-mini" } : {}),
      ...(type === "anthropic" ? { defaultMaxTokens: 4096 } : {}),
      protocols: type === "anthropic" ? ["anthropic_messages"] : ["openai_chat"]
    };
  }

  async function loadConfig() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    try {
      const snapshot = await client.getConfigStoreSnapshot();
      const section = snapshot.sections["providers"];
      if (section?.data && Array.isArray(section.data)) {
        providers = section.data as ProvidersConfig;
      }
    } catch {
      // Config store may not be initialized yet; start with an empty catalog.
    } finally {
      loading = false;
    }
  }

  async function saveProviders(message = "Provider catalog saved") {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    saving = true;
    error = "";
    success = "";

    try {
      const providerIds = new Set<string>();
      for (const config of providers) {
        if (!config.id.trim()) throw new Error("Provider id is required");
        if (providerIds.has(config.id.trim())) {
          throw new Error(`Provider id is duplicated: ${config.id.trim()}`);
        }
        providerIds.add(config.id.trim());
        if (!config.apiKey.trim()) {
          throw new Error(`API key is required for ${config.id}`);
        }
        if (!config.baseUrl.trim()) {
          throw new Error(`Base URL is required for ${config.id}`);
        }
      }

      await client.putConfigStoreSection("providers", providers);
      success = message;
      editProvider = null;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save";
    } finally {
      saving = false;
    }
  }

  function addProvider() {
    const providerKey = newProviderKey.trim();
    if (!providerKey) {
      error = "Provider key is required";
      return;
    }
    if (providers.some((provider) => provider.id === providerKey)) {
      error = "Provider key already exists";
      return;
    }

    providers = [
      ...providers,
      createProviderConfig(providerKey, newProviderType)
    ];
    editProvider = providerKey;
    newProviderKey = "";
    error = "";
  }

  function deleteProvider(providerKey: string) {
    if (
      !confirm(`Delete provider ${providerKey}? Routes using it will fail.`)
    ) {
      return;
    }
    providers = providers.filter((provider) => provider.id !== providerKey);
    saveProviders("Provider deleted");
  }

  function updateProviderType(providerKey: string, type: ProviderType) {
    const current = providers.find((provider) => provider.id === providerKey);
    if (!current) return;
    providers = providers.map((provider) =>
      provider.id === providerKey
        ? {
            ...createProviderConfig(providerKey, type),
            apiKey: current.apiKey,
            baseUrl: current.baseUrl || providerDefaultUrls[type]
          }
        : provider
    );
  }

  function toggleProtocol(providerKey: string, protocol: string) {
    const currentProvider = providers.find(
      (provider) => provider.id === providerKey
    );
    if (!currentProvider) return;
    const current = currentProvider.protocols ?? [];
    const protocols = current.includes(protocol)
      ? current.filter((p) => p !== protocol)
      : [...current, protocol];
    providers = providers.map((provider) =>
      provider.id === providerKey ? { ...currentProvider, protocols } : provider
    );
  }

  function updateProviderField(
    providerKey: string,
    field: keyof ProviderConfig,
    value: unknown
  ) {
    const currentProvider = providers.find(
      (provider) => provider.id === providerKey
    );
    if (!currentProvider) return;
    providers = providers.map((provider) =>
      provider.id === providerKey
        ? { ...currentProvider, [field]: value }
        : provider
    );
  }

  loadConfig();
</script>

<Nav />

<main class="max-w-5xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Provider Instances</h2>
    <a href="/config" class="text-sm text-blue-400 hover:text-blue-300"
      >&larr; Back to Config</a
    >
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
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-5">
      <div class="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3">
        <input
          type="text"
          class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
          placeholder="provider key, e.g. openai-prod"
          bind:value={newProviderKey}
        />
        <select
          class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          bind:value={newProviderType}
        >
          {#each providerTypes as type}
            <option value={type}>{providerTypeLabels[type]}</option>
          {/each}
        </select>
        <button
          type="button"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium"
          onclick={addProvider}
        >
          Add Provider
        </button>
      </div>
    </div>

    <div class="space-y-4">
      {#each providers as config (config.id)}
        {@const providerKey = config.id}
        <div
          class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
        >
          <button
            type="button"
            class="flex w-full items-center justify-between px-5 py-3 bg-gray-850 text-left cursor-pointer"
            onclick={() =>
              (editProvider =
                editProvider === providerKey ? null : providerKey)}
          >
            <div class="flex items-center gap-3">
              <span class="font-mono font-semibold text-white"
                >{providerKey}</span
              >
              <span
                class="px-2 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300"
                >{config.type}</span
              >
              {#if config.apiKey && config.baseUrl}
                <span
                  class="px-2 py-0.5 rounded text-xs bg-green-900/50 text-green-400"
                  >Configured</span
                >
              {:else}
                <span
                  class="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-500"
                  >Incomplete</span
                >
              {/if}
            </div>
            <span class="text-gray-500 text-sm"
              >{editProvider === providerKey ? "&#9650;" : "&#9660;"}</span
            >
          </button>

          {#if editProvider === providerKey}
            <div class="p-5 space-y-4 border-t border-gray-800">
              <div>
                <label
                  class="block text-sm text-gray-400 mb-1"
                  for={providerFieldId(providerKey, "type")}>Adapter Type</label
                >
                <select
                  id={providerFieldId(providerKey, "type")}
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  value={config.type}
                  onchange={(e) =>
                    updateProviderType(
                      providerKey,
                      (e.target as HTMLSelectElement).value as ProviderType
                    )}
                >
                  {#each providerTypes as type}
                    <option value={type}>{providerTypeLabels[type]}</option>
                  {/each}
                </select>
              </div>

              <div>
                <label
                  class="block text-sm text-gray-400 mb-1"
                  for={providerFieldId(providerKey, "apiKey")}>API Key</label
                >
                <input
                  id={providerFieldId(providerKey, "apiKey")}
                  type="password"
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="secret key"
                  value={config.apiKey}
                  oninput={(e) =>
                    updateProviderField(
                      providerKey,
                      "apiKey",
                      (e.target as HTMLInputElement).value
                    )}
                />
              </div>

              <div>
                <label
                  class="block text-sm text-gray-400 mb-1"
                  for={providerFieldId(providerKey, "baseUrl")}>Base URL</label
                >
                <input
                  id={providerFieldId(providerKey, "baseUrl")}
                  type="url"
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  value={config.baseUrl}
                  oninput={(e) =>
                    updateProviderField(
                      providerKey,
                      "baseUrl",
                      (e.target as HTMLInputElement).value
                    )}
                />
              </div>

              {#if config.type === "openai"}
                <div>
                  <label
                    class="block text-sm text-gray-400 mb-1"
                    for={providerFieldId(providerKey, "defaultModel")}
                    >Default Model</label
                  >
                  <input
                    id={providerFieldId(providerKey, "defaultModel")}
                    type="text"
                    class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                    placeholder="gpt-4.1-mini"
                    value={config.defaultModel ?? ""}
                    oninput={(e) =>
                      updateProviderField(
                        providerKey,
                        "defaultModel",
                        (e.target as HTMLInputElement).value
                      )}
                  />
                </div>
              {/if}

              {#if config.type === "anthropic"}
                <div>
                  <label
                    class="block text-sm text-gray-400 mb-1"
                    for={providerFieldId(providerKey, "defaultMaxTokens")}
                    >Default Max Tokens</label
                  >
                  <input
                    id={providerFieldId(providerKey, "defaultMaxTokens")}
                    type="number"
                    class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    value={config.defaultMaxTokens ?? 4096}
                    oninput={(e) =>
                      updateProviderField(
                        providerKey,
                        "defaultMaxTokens",
                        Number((e.target as HTMLInputElement).value)
                      )}
                  />
                </div>
              {/if}

              <div>
                <span
                  class="block text-sm text-gray-400 mb-2"
                  id={providerFieldId(providerKey, "protocols")}
                  >Supported Protocols</span
                >
                <div
                  class="flex flex-wrap gap-2"
                  role="group"
                  aria-labelledby={providerFieldId(providerKey, "protocols")}
                >
                  {#each allProtocols as protocol}
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded text-xs font-medium border transition-colors {(
                        config.protocols ?? []
                      ).includes(protocol)
                        ? 'bg-blue-900/50 border-blue-700 text-blue-300'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}"
                      onclick={() => toggleProtocol(providerKey, protocol)}
                    >
                      {protocol}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="flex justify-between pt-2">
                <button
                  type="button"
                  class="px-4 py-2 text-red-400 hover:text-red-300 text-sm rounded border border-red-900"
                  onclick={() => deleteProvider(providerKey)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium disabled:opacity-50"
                  onclick={() => saveProviders(`${providerKey} saved`)}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}

      {#if providers.length === 0}
        <div class="text-center py-12 text-gray-500">
          No provider instances configured.
        </div>
      {/if}
    </div>
  {/if}
</main>
