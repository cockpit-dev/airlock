<script lang="ts">
  import { createClient, getStoredCredentials } from "$lib/auth.js";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import * as Card from "$lib/components/ui/card";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Save from "@lucide/svelte/icons/save";
  import X from "@lucide/svelte/icons/x";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";

  type ProviderType = "openai" | "anthropic" | "gemini";
  type ProviderConfig = {
    id: string;
    type: ProviderType;
    apiKey: string;
    baseUrl: string;
    defaultModel?: string;
    defaultMaxTokens?: number;
    models?: string[];
    protocols?: string[];
    extendedHeaders?: Record<string, string>;
    extendedQueryParams?: Record<string, string>;
    extendedBodyInjections?: Record<string, unknown>;
  };
  type ProvidersConfig = ProviderConfig[];

  const providerTypes: ProviderType[] = ["openai", "anthropic", "gemini"];
  const providerTypeLabels: Record<ProviderType, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini"
  };
  const providerDefaultUrls: Record<ProviderType, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com/v1beta"
  };
  const providerDefaultModels: Record<ProviderType, string[]> = {
    openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "o3", "o4-mini"],
    anthropic: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-20250514"],
    gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]
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
  let fetchingModels = $state<Record<string, boolean>>({});
  let editProvider = $state<string | null>(null);
  let providers = $state<ProvidersConfig>([]);
  let newProviderKey = $state("");
  let newProviderType = $state<ProviderType>("openai");

  function providerFieldId(pk: string, f: string) {
    return `provider-${pk.replace(/[^a-zA-Z0-9_-]/g, "-")}-${f}`;
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
      models: providerDefaultModels[type],
      ...(type === "anthropic" ? { defaultMaxTokens: 4096 } : {}),
      protocols: type === "anthropic" ? ["anthropic_messages"] : ["openai_chat"]
    };
  }
  async function loadConfig() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    try {
      const s = await client.getConfigStoreSnapshot();
      const sec = s.sections["providers"];
      if (sec?.data && Array.isArray(sec.data))
        providers = sec.data as ProvidersConfig;
    } catch {
    } finally {
      loading = false;
    }
  }
  async function saveProviders(message = "Saved") {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    saving = true;
    error = "";
    success = "";
    try {
      const ids = new Set<string>();
      for (const c of providers) {
        if (!c.id.trim()) throw new Error("ID required");
        if (ids.has(c.id.trim())) throw new Error(`Duplicate: ${c.id.trim()}`);
        ids.add(c.id.trim());
        if (!c.apiKey.trim()) throw new Error(`API key required for ${c.id}`);
        if (!c.baseUrl.trim()) throw new Error(`Base URL required for ${c.id}`);
      }
      await client.putConfigStoreSection("providers", providers);
      success = message;
      editProvider = null;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed";
    } finally {
      saving = false;
    }
  }
  function addProvider() {
    const pk = newProviderKey.trim();
    if (!pk) {
      error = "Key required";
      return;
    }
    if (providers.some((p) => p.id === pk)) {
      error = "Exists";
      return;
    }
    providers = [...providers, createProviderConfig(pk, newProviderType)];
    editProvider = pk;
    newProviderKey = "";
    error = "";
  }
  function deleteProvider(pk: string) {
    if (!confirm(`Delete ${pk}?`)) return;
    providers = providers.filter((p) => p.id !== pk);
    saveProviders("Deleted");
  }
  function updateProviderType(pk: string, type: ProviderType) {
    const cur = providers.find((p) => p.id === pk);
    if (!cur) return;
    providers = providers.map((p) =>
      p.id === pk
        ? {
            ...createProviderConfig(pk, type),
            apiKey: cur.apiKey,
            baseUrl: cur.baseUrl || providerDefaultUrls[type]
          }
        : p
    );
  }
  function toggleProtocol(pk: string, proto: string) {
    const cp = providers.find((p) => p.id === pk);
    if (!cp) return;
    const cur = cp.protocols ?? [];
    const protos = cur.includes(proto)
      ? cur.filter((p) => p !== proto)
      : [...cur, proto];
    providers = providers.map((p) =>
      p.id === pk ? { ...cp, protocols: protos } : p
    );
  }
  function updateField(
    pk: string,
    field: keyof ProviderConfig,
    value: unknown
  ) {
    const cp = providers.find((p) => p.id === pk);
    if (!cp) return;
    providers = providers.map((p) =>
      p.id === pk ? { ...cp, [field]: value } : p
    );
  }
  function addModel(pk: string) {
    const cp = providers.find((p) => p.id === pk);
    if (!cp) return;
    const models = [...(cp.models ?? []), ""];
    providers = providers.map((p) =>
      p.id === pk ? { ...cp, models } : p
    );
  }
  function removeModel(pk: string, index: number) {
    const cp = providers.find((p) => p.id === pk);
    if (!cp) return;
    const models = (cp.models ?? []).filter((_, i) => i !== index);
    providers = providers.map((p) =>
      p.id === pk ? { ...cp, models } : p
    );
  }
  function updateModel(pk: string, index: number, value: string) {
    const cp = providers.find((p) => p.id === pk);
    if (!cp) return;
    const models = (cp.models ?? []).map((m, i) => i === index ? value : m);
    providers = providers.map((p) =>
      p.id === pk ? { ...cp, models } : p
    );
  }
  async function fetchModels(pk: string) {
    const cp = providers.find((p) => p.id === pk);
    if (!cp?.baseUrl || !cp?.apiKey) {
      error = "Base URL and API key required to fetch models";
      return;
    }
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    fetchingModels = { ...fetchingModels, [pk]: true };
    error = "";
    try {
      const result = await client.fetchProviderModels(cp.baseUrl, cp.apiKey, cp.type);
      if (result.models.length > 0) {
        providers = providers.map((p) =>
          p.id === pk ? { ...cp, models: result.models } : p
        );
        success = `Fetched ${result.models.length} models from ${pk}`;
      } else {
        error = "No models found";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to fetch models";
    } finally {
      fetchingModels = { ...fetchingModels, [pk]: false };
    }
  }
  loadConfig();
</script>

<svelte:head><title>Providers - Airlock</title></svelte:head>

<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item><Breadcrumb.Link href="/config">Config</Breadcrumb.Link></Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item><Breadcrumb.Page>Providers</Breadcrumb.Page></Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>

<div class="flex items-center justify-between mb-3 mt-1">
  <h1 class="text-xl font-semibold tracking-tight">Provider Instances</h1>
</div>

{#if error}
  <div class="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 mb-3 text-xs text-destructive">{error}</div>
{/if}
{#if success}
  <div class="rounded-lg border border-success/30 bg-success/5 p-2.5 mb-3 text-xs text-success">{success}</div>
{/if}

{#if loading}
  <Card.Root class="py-4 text-center">
    <Card.Content><p class="text-sm text-muted-foreground">Loading...</p></Card.Content>
  </Card.Root>
{:else}
  <!-- Add Provider Form -->
  <Card.Root class="mb-3">
    <Card.Content>
      <div class="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2 items-end">
        <div class="grid gap-1">
          <Label for="new-pk">Provider Key</Label>
          <Input id="new-pk" type="text" placeholder="e.g. openai-prod" bind:value={newProviderKey} />
        </div>
        <div class="grid gap-1">
          <Label for="new-pt">Adapter</Label>
          <select
            id="new-pt"
            bind:value={newProviderType}
            class="border-input bg-background flex h-8 w-full rounded-lg border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {#each providerTypes as t}<option value={t}>{providerTypeLabels[t]}</option>{/each}
          </select>
        </div>
        <Button size="sm" onclick={addProvider}><Plus data-icon="inline-start" />Add</Button>
      </div>
    </Card.Content>
  </Card.Root>

  <!-- Provider List -->
  <div class="grid gap-2">
    {#each providers as config (config.id)}
      {@const pk = config.id}
      <Collapsible.Root
        open={editProvider === pk}
        onOpenChange={(v: boolean) => {
          editProvider = v ? pk : null;
          if (v && config.apiKey && config.baseUrl && !fetchingModels[pk]) {
            fetchModels(pk);
          }
        }}
      >
        <Card.Root>
          <Card.Header>
            <Collapsible.Trigger
              class="flex w-full items-center justify-between rounded-md -mx-1 -mt-1 px-1 py-1 hover:bg-muted/50 transition-colors"
            >
              <div class="flex items-center gap-2">
                <span class="size-2 rounded-full {config.apiKey && config.baseUrl ? 'bg-success' : 'bg-muted-foreground'}"></span>
                <span class="text-sm font-medium">{pk}</span>
                <Badge variant="secondary">{config.type}</Badge>
                {#if (config.models ?? []).length > 0}
                  <Badge variant="outline">{config.models!.length} models</Badge>
                {/if}
              </div>
              <ChevronDown
                class="size-3.5 text-muted-foreground transition-transform {editProvider === pk ? 'rotate-180' : ''}"
              />
            </Collapsible.Trigger>
          </Card.Header>
          <Collapsible.Content>
            <Card.Content class="grid gap-2.5">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div class="grid gap-1">
                  <Label for={providerFieldId(pk, "type")}>Adapter</Label>
                  <select
                    id={providerFieldId(pk, "type")}
                    value={config.type}
                    onchange={(e) =>
                      updateProviderType(
                        pk,
                        (e.target as HTMLSelectElement).value as ProviderType
                      )
                    }
                    class="border-input bg-background flex h-8 w-full rounded-lg border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {#each providerTypes as t}<option value={t}>{providerTypeLabels[t]}</option>{/each}
                  </select>
                </div>
                <div class="grid gap-1">
                  <Label for={providerFieldId(pk, "apiKey")}>API Key</Label>
                  <Input
                    id={providerFieldId(pk, "apiKey")}
                    type="password"
                    placeholder="secret"
                    value={config.apiKey}
                    oninput={(e) =>
                      updateField(pk, "apiKey", (e.target as HTMLInputElement).value)
                    }
                    onblur={() => {
                      if (config.apiKey && config.baseUrl && !fetchingModels[pk]) fetchModels(pk);
                    }}
                  />
                </div>
              </div>
              <div class="grid gap-1">
                <Label for={providerFieldId(pk, "baseUrl")}>Base URL</Label>
                <Input
                  id={providerFieldId(pk, "baseUrl")}
                  type="url"
                  value={config.baseUrl}
                  oninput={(e) =>
                    updateField(pk, "baseUrl", (e.target as HTMLInputElement).value)
                  }
                  onblur={() => {
                    if (config.apiKey && config.baseUrl && !fetchingModels[pk]) fetchModels(pk);
                  }}
                  class="font-mono text-xs"
                />
              </div>

              <!-- Models -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <Label class="text-xs">Models</Label>
                  <div class="flex gap-1">
                    <Button
                      variant="outline"
                      size="xs"
                      onclick={() => fetchModels(pk)}
                      disabled={fetchingModels[pk] || !config.apiKey || !config.baseUrl}
                    >
                      <RefreshCw data-icon="inline-start" class={fetchingModels[pk] ? "animate-spin" : ""} />
                      {fetchingModels[pk] ? "Fetching..." : "Auto Fetch"}
                    </Button>
                    <Button variant="ghost" size="xs" onclick={() => addModel(pk)}>
                      <Plus data-icon="inline-start" />Add
                    </Button>
                  </div>
                </div>
                <div class="grid gap-1.5">
                  {#each config.models ?? [] as model, i}
                    <div class="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={model}
                        placeholder="model-name"
                        oninput={(e) => updateModel(pk, i, (e.target as HTMLInputElement).value)}
                        class="border-input bg-background flex h-7 flex-1 rounded-lg border px-2 py-1 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
                      />
                      <Button variant="ghost" size="icon-xs" onclick={() => removeModel(pk, i)}>
                        <X />
                      </Button>
                    </div>
                  {/each}
                  {#if (config.models ?? []).length === 0}
                    <p class="text-xs text-muted-foreground py-1">No models added. Click Add to specify models this provider supports.</p>
                  {/if}
                </div>
              </div>

              {#if config.type === "anthropic"}
                <div class="grid gap-1">
                  <Label for={providerFieldId(pk, "defaultMaxTokens")}>Max Tokens</Label>
                  <Input
                    id={providerFieldId(pk, "defaultMaxTokens")}
                    type="number"
                    value={config.defaultMaxTokens ?? 4096}
                    oninput={(e) =>
                      updateField(pk, "defaultMaxTokens", Number((e.target as HTMLInputElement).value))
                    }
                  />
                </div>
              {/if}
              <div>
                <Label class="text-xs mb-1.5">Protocols</Label>
                <div class="flex flex-wrap gap-1.5 mt-0.5">
                  {#each allProtocols as proto}
                    <button
                      type="button"
                      onclick={() => toggleProtocol(pk, proto)}
                      class="cursor-pointer"
                    >
                      <Badge
                        variant={(config.protocols ?? []).includes(proto) ? "default" : "outline"}
                      >
                        {proto}
                      </Badge>
                    </button>
                  {/each}
                </div>
              </div>
            </Card.Content>
            <Card.Footer class="justify-between">
              <Button
                variant="destructive"
                size="xs"
                onclick={() => deleteProvider(pk)}
              >
                <Trash2 data-icon="inline-start" />Delete
              </Button>
              <Button
                size="xs"
                onclick={() => saveProviders(`${pk} saved`)}
                disabled={saving}
              >
                <Save data-icon="inline-start" />{saving ? "Saving..." : "Save"}
              </Button>
            </Card.Footer>
          </Collapsible.Content>
        </Card.Root>
      </Collapsible.Root>
    {/each}
    {#if providers.length === 0}
      <Card.Root class="py-4 text-center">
        <Card.Content><p class="text-sm text-muted-foreground">No providers configured.</p></Card.Content>
      </Card.Root>
    {/if}
  </div>
{/if}
