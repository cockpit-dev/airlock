<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import { createClient, getStoredCredentials } from "$lib/auth.js";
  type ProviderConfig = {
    apiKey: string;
    baseUrl: string;
    defaultModel?: string;
    defaultMaxTokens?: number;
    protocols?: string[];
    extendedHeaders?: Record<string, string>;
    extendedQueryParams?: Record<string, string>;
    extendedBodyInjections?: Record<string, unknown>;
  };

  type ProvidersConfig = {
    openai: ProviderConfig;
    anthropic?: ProviderConfig;
    gemini?: ProviderConfig;
  };

  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let editProvider = $state<string | null>(null);

  let providers = $state<ProvidersConfig>({
    openai: { apiKey: "", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" }
  });

  let showAnthropic = $state(false);
  let showGemini = $state(false);

  const providerLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Google Gemini"
  };

  const providerDefaultUrls: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com/v1beta"
  };

  const allProtocols = ["openai_chat", "openai_responses", "anthropic_messages"];

  async function loadConfig() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    try {
      const snapshot = await client.getConfigStoreSnapshot();
      const section = snapshot.sections["providers"];
      if (section?.data && typeof section.data === "object") {
        const data = section.data as ProvidersConfig;
        if (data.openai) providers.openai = { ...providers.openai, ...data.openai };
        if (data.anthropic) {
          showAnthropic = true;
          providers.anthropic = { ...data.anthropic };
        }
        if (data.gemini) {
          showGemini = true;
          providers.gemini = { ...data.gemini };
        }
      }
    } catch {
      // Config store may not be initialized yet — show defaults
    } finally {
      loading = false;
    }
  }

  async function saveProvider(name: string) {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    saving = true;
    error = "";
    success = "";

    try {
      const config = providers[name as keyof ProvidersConfig];
      if (!config) throw new Error("Provider not found");
      if (!config.apiKey.trim()) throw new Error("API key is required");
      if (!config.baseUrl.trim()) throw new Error("Base URL is required");

      await client.putConfigStoreSection("providers", providers);
      success = `${providerLabels[name] ?? name} configuration saved`;
      editProvider = null;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save";
    } finally {
      saving = false;
    }
  }

  function addProvider(name: "anthropic" | "gemini") {
    if (name === "anthropic") {
      showAnthropic = true;
      if (!providers.anthropic) {
        providers.anthropic = {
          apiKey: "",
          baseUrl: providerDefaultUrls.anthropic,
          defaultMaxTokens: 4096,
          protocols: ["anthropic_messages"]
        };
      }
    }
    if (name === "gemini") {
      showGemini = true;
      if (!providers.gemini) {
        providers.gemini = {
          apiKey: "",
          baseUrl: providerDefaultUrls.gemini,
          protocols: ["openai_chat"]
        };
      }
    }
  }

  function toggleProtocol(provider: keyof ProvidersConfig, protocol: string) {
    if (!providers[provider]) return;
    const current = providers[provider]!.protocols ?? [];
    if (current.includes(protocol)) {
      providers[provider]!.protocols = current.filter((p) => p !== protocol);
    } else {
      providers[provider]!.protocols = [...current, protocol];
    }
  }

  loadConfig();
</script>

<Nav />

<main class="max-w-5xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Provider Configuration</h2>
    <a href="/config" class="text-sm text-blue-400 hover:text-blue-300"
      >&larr; Back to Config</a
    >
  </div>

  {#if error}
    <div class="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm">
      {error}
    </div>
  {/if}

  {#if success}
    <div class="bg-green-900/30 border border-green-800 rounded-lg p-3 mb-4 text-green-300 text-sm">
      {success}
    </div>
  {/if}

  {#if loading}
    <div class="text-gray-400 text-center py-12">Loading configuration...</div>
  {:else}
    <!-- OpenAI (always shown) -->
    {#snippet providerCard(name: string, config: ProviderConfig)}
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div
          class="flex items-center justify-between px-5 py-3 bg-gray-850 cursor-pointer"
          onclick={() => (editProvider = editProvider === name ? null : name)}
        >
          <div class="flex items-center gap-3">
            <span class="font-semibold text-white"
              >{providerLabels[name] ?? name}</span
            >
            {#if config.apiKey}
              <span
                class="px-2 py-0.5 rounded text-xs bg-green-900/50 text-green-400"
                >Configured</span
              >
            {:else}
              <span class="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-500"
                >Not configured</span
              >
            {/if}
          </div>
          <span class="text-gray-500 text-sm"
            >{editProvider === name ? "&#9650;" : "&#9660;"}</span
          >
        </div>

        {#if editProvider === name}
          <div class="p-5 space-y-4 border-t border-gray-800">
            <div>
              <label class="block text-sm text-gray-400 mb-1">API Key</label>
              <input
                type="password"
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="sk-..."
                bind:value={config.apiKey}
              />
            </div>

            <div>
              <label class="block text-sm text-gray-400 mb-1">Base URL</label>
              <input
                type="url"
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                bind:value={config.baseUrl}
              />
            </div>

            {#if name === "openai"}
              <div>
                <label class="block text-sm text-gray-400 mb-1"
                  >Default Model</label
                >
                <input
                  type="text"
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  placeholder="gpt-4.1-mini"
                  bind:value={config.defaultModel}
                />
              </div>
            {/if}

            {#if name === "anthropic"}
              <div>
                <label class="block text-sm text-gray-400 mb-1"
                  >Default Max Tokens</label
                >
                <input
                  type="number"
                  class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="4096"
                  bind:value={config.defaultMaxTokens}
                />
              </div>
            {/if}

            <!-- Protocols -->
            <div>
              <label class="block text-sm text-gray-400 mb-2"
                >Supported Protocols</label
              >
              <div class="flex flex-wrap gap-2">
                {#each allProtocols as protocol}
                  <button
                    class="px-3 py-1.5 rounded text-xs font-medium border transition-colors {(config.protocols ?? []).includes(protocol)
                      ? 'bg-blue-900/50 border-blue-700 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}"
                    onclick={() =>
                      toggleProtocol(
                        name as keyof ProvidersConfig,
                        protocol
                      )}
                  >
                    {protocol}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Extended Headers -->
            <div>
              <label class="block text-sm text-gray-400 mb-1"
                >Extended Headers (JSON)</label
              >
              <textarea
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                rows="2"
                placeholder={'{"X-Custom-Header": "value"}'}
                oninput={(e) => {
                  try {
                    config.extendedHeaders = JSON.parse(
                      (e.target as HTMLTextAreaElement).value
                    );
                  } catch {
                    /* keep previous value */
                  }
                }}
              ></textarea>
            </div>

            <!-- Extended Query Params -->
            <div>
              <label class="block text-sm text-gray-400 mb-1"
                >Extended Query Params (JSON)</label
              >
              <textarea
                class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                rows="2"
                placeholder={'{"key": "value"}'}
                oninput={(e) => {
                  try {
                    config.extendedQueryParams = JSON.parse(
                      (e.target as HTMLTextAreaElement).value
                    );
                  } catch {
                    /* keep previous value */
                  }
                }}
              ></textarea>
            </div>

            <div class="flex justify-end pt-2">
              <button
                class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium disabled:opacity-50"
                onclick={() => saveProvider(name)}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/snippet}

    <div class="space-y-4">
      {@render providerCard("openai", providers.openai)}

      {#if showAnthropic && providers.anthropic}
        {@render providerCard("anthropic", providers.anthropic)}
      {/if}

      {#if showGemini && providers.gemini}
        {@render providerCard("gemini", providers.gemini)}
      {/if}

      <!-- Add Provider Buttons -->
      <div class="flex gap-3 pt-4">
        {#if !showAnthropic}
          <button
            class="px-4 py-2 border border-gray-700 rounded text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            onclick={() => addProvider("anthropic")}
          >
            + Add Anthropic
          </button>
        {/if}
        {#if !showGemini}
          <button
            class="px-4 py-2 border border-gray-700 rounded text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            onclick={() => addProvider("gemini")}
          >
            + Add Gemini
          </button>
        {/if}
      </div>
    </div>
  {/if}
</main>
