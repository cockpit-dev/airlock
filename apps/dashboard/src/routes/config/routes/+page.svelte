<script lang="ts">
  import { createClient, getStoredCredentials } from "$lib/auth.js";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import Plus from "@lucide/svelte/icons/plus";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Save from "@lucide/svelte/icons/save";
  import X from "@lucide/svelte/icons/x";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  type ProviderTarget = { provider: string; providerModel: string };
  type RouteConfig = { externalModel: string; target: ProviderTarget; fallbacks?: ProviderTarget[]; strategy?: string; requiredKeyTier?: string; requiredKeyTags?: string[] };
  type RoutesConfig = RouteConfig[];
  type ProvidersConfig = Array<{ id: string; type: string; models?: string[] }>;

  let loading = $state(true); let saving = $state(false); let error = $state(""); let success = $state("");
  let editRouteIndex = $state<number | null>(null); let showCreateForm = $state(false);
  let routes = $state<RoutesConfig>([]); let providerKeys = $state<string[]>([]);
  let providerModelsMap = $state<Record<string, string[]>>({});
  const strategyOptions = ["weighted", "lowest_cost", "health_priority", "priority", "health_score"];
  let formExternalModel = $state(""); let formTargetProvider = $state(""); let formTargetModel = $state("");
  let formFallbacks = $state<ProviderTarget[]>([]); let formStrategy = $state(""); let formRequiredKeyTier = $state(""); let formRequiredKeyTags = $state("");

  const currentProviderModels = $derived(providerModelsMap[formTargetProvider] ?? []);

  function resetForm() { formExternalModel = ""; formTargetProvider = providerKeys[0] ?? ""; formTargetModel = ""; formFallbacks = []; formStrategy = ""; formRequiredKeyTier = ""; formRequiredKeyTags = ""; }
  function loadFormFromRoute(r: RouteConfig) { formExternalModel = r.externalModel; formTargetProvider = r.target.provider; formTargetModel = r.target.providerModel; formFallbacks = r.fallbacks ? r.fallbacks.map(f => ({...f})) : []; formStrategy = r.strategy ?? ""; formRequiredKeyTier = r.requiredKeyTier ?? ""; formRequiredKeyTags = r.requiredKeyTags?.join(", ") ?? ""; }
  async function loadConfig() {
    const c = getStoredCredentials(); if (!c) return; const cl = createClient(c.url, c.token);
    try {
      const s = await cl.getConfigStoreSnapshot();
      const sec = s.sections["routes"];
      if (sec?.data && Array.isArray(sec.data)) routes = sec.data as RoutesConfig;
      const ps = s.sections["providers"];
      if (ps?.data && Array.isArray(ps.data)) {
        const provs = ps.data as ProvidersConfig;
        providerKeys = provs.map(p => p.id);
        providerModelsMap = {};
        for (const p of provs) {
          if (p.models?.length) providerModelsMap[p.id] = p.models;
        }
        if (!formTargetProvider && providerKeys[0]) formTargetProvider = providerKeys[0];
      }
    } catch {} finally { loading = false; }
  }
  async function saveRoutes() { const c = getStoredCredentials(); if (!c) return; const cl = createClient(c.url, c.token); saving = true; error = ""; success = ""; try { await cl.putConfigStoreSection("routes", routes); success = "Saved"; editRouteIndex = null; showCreateForm = false; } catch (e) { error = e instanceof Error ? e.message : "Failed"; } finally { saving = false; } }
  function startCreate() { resetForm(); showCreateForm = true; editRouteIndex = null; }
  function startEdit(i: number) { loadFormFromRoute(routes[i]); editRouteIndex = i; showCreateForm = false; }
  function cancelEdit() { editRouteIndex = null; showCreateForm = false; resetForm(); }
  function buildRoute(): RouteConfig { return { externalModel: formExternalModel.trim(), target: { provider: formTargetProvider, providerModel: formTargetModel.trim() }, ...(formFallbacks.length > 0 ? { fallbacks: formFallbacks } : {}), ...(formStrategy ? { strategy: formStrategy } : {}), ...(formRequiredKeyTier.trim() ? { requiredKeyTier: formRequiredKeyTier.trim() } : {}), ...(formRequiredKeyTags.trim() ? { requiredKeyTags: formRequiredKeyTags.split(",").map(t => t.trim()).filter(t => t) } : {}) }; }
  function applyCreate() { if (!formExternalModel.trim() || !formTargetProvider.trim() || !formTargetModel.trim()) { error = "All fields required"; return; } error = ""; routes = [...routes, buildRoute()]; showCreateForm = false; resetForm(); saveRoutes(); }
  function applyEdit() { if (editRouteIndex === null) return; if (!formExternalModel.trim() || !formTargetProvider.trim() || !formTargetModel.trim()) { error = "All fields required"; return; } error = ""; routes = routes.map((r, i) => i === editRouteIndex ? buildRoute() : r); editRouteIndex = null; resetForm(); saveRoutes(); }
  function deleteRoute(i: number) { if (!confirm("Delete?")) return; routes = routes.filter((_, j) => j !== i); saveRoutes(); }
  function addFallback() { formFallbacks = [...formFallbacks, { provider: providerKeys[0] ?? "", providerModel: "" }]; }
  function removeFallback(i: number) { formFallbacks = formFallbacks.filter((_, j) => j !== i); }
  function updateFallback(i: number, f: "provider"|"providerModel", v: string) { formFallbacks = formFallbacks.map((fb, j) => j === i ? {...fb, [f]: v} : fb); }
  loadConfig();
</script>

<svelte:head><title>Routes - Airlock</title></svelte:head>

<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item><Breadcrumb.Link href="/config">Config</Breadcrumb.Link></Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item><Breadcrumb.Page>Routes</Breadcrumb.Page></Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>

<div class="flex items-center justify-between mb-3 mt-1">
  <h1 class="text-xl font-semibold tracking-tight">Route Configuration</h1>
  {#if !loading && providerKeys.length > 0}
    <Button size="sm" onclick={startCreate}><Plus data-icon="inline-start" />Add Route</Button>
  {/if}
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
{:else if providerKeys.length === 0}
  <Card.Root>
    <Card.Content>
      <p class="text-sm">Configure a provider first.</p>
      <Button variant="outline" size="sm" href="/config/providers" class="mt-2">Add Provider</Button>
    </Card.Content>
  </Card.Root>
{:else}
  {#if showCreateForm}
    {@render routeForm("Create Route", applyCreate)}
  {/if}

  <div class="grid gap-1.5">
    {#each routes as route, index}
      {#if editRouteIndex === index}
        {@render routeForm("Edit Route", applyEdit)}
      {:else}
        <Card.Root size="sm">
          <Card.Content class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium font-mono">{route.externalModel}</span>
              <ArrowRight class="size-3 text-muted-foreground" />
              <span class="text-xs">{route.target.provider}</span>
              <span class="font-mono text-[11px] text-muted-foreground">{route.target.providerModel}</span>
              {#if route.fallbacks && route.fallbacks.length > 0}
                <Badge variant="outline">+{route.fallbacks.length} fb</Badge>
              {/if}
              {#if route.strategy}
                <Badge variant="secondary">{route.strategy}</Badge>
              {/if}
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="xs" onclick={() => startEdit(index)}>
                <Pencil data-icon="inline-start" />Edit
              </Button>
              <Button variant="destructive" size="xs" onclick={() => deleteRoute(index)}>
                <Trash2 data-icon="inline-start" />Delete
              </Button>
            </div>
          </Card.Content>
        </Card.Root>
      {/if}
    {/each}
    {#if routes.length === 0 && !showCreateForm}
      <Card.Root class="py-4 text-center">
        <Card.Content><p class="text-sm text-muted-foreground">No routes configured.</p></Card.Content>
      </Card.Root>
    {/if}
  </div>
{/if}

{#snippet routeForm(title: string, onSave: () => void)}
  <Card.Root class="mb-3">
    <Card.Header>
      <h3 class="text-sm font-semibold">{title}</h3>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div class="grid gap-1">
          <Label for="re">External Model</Label>
          <Input id="re" type="text" placeholder="gpt-4.1-mini" bind:value={formExternalModel} class="font-mono" />
        </div>
        <div class="grid gap-1">
          <Label for="rs">Strategy</Label>
          <select id="rs" bind:value={formStrategy}
            class="border-input bg-background flex h-8 w-full rounded-lg border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <option value="">Default</option>{#each strategyOptions as s}<option value={s}>{s}</option>{/each}
          </select>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div class="grid gap-1">
          <Label for="rtp">Target Provider</Label>
          <select id="rtp" bind:value={formTargetProvider}
            class="border-input bg-background flex h-8 w-full rounded-lg border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {#each providerKeys as p}<option value={p}>{p}</option>{/each}
          </select>
        </div>
        <div class="grid gap-1">
          <Label for="rtm">Target Model</Label>
          <input id="rtm" type="text" placeholder="gpt-4.1-mini" list="target-model-suggestions" bind:value={formTargetModel}
            class="border-input bg-background flex h-8 w-full rounded-lg border px-2.5 py-1 text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50 placeholder:text-muted-foreground" />
          <datalist id="target-model-suggestions">
            {#each currentProviderModels as m}
              <option value={m} />
            {/each}
          </datalist>
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <Label class="text-xs">Fallbacks</Label>
          <Button variant="ghost" size="xs" onclick={addFallback}><Plus data-icon="inline-start" />Add</Button>
        </div>
        {#each formFallbacks as fb, i}
          <div class="flex items-center gap-1.5 mb-1.5">
            <select value={fb.provider} onchange={e => updateFallback(i, "provider", (e.target as HTMLSelectElement).value)}
              class="border-input bg-background flex h-7 rounded-lg border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              {#each providerKeys as p}<option value={p}>{p}</option>{/each}
            </select>
            <input type="text" placeholder="model" list="fb-model-suggestions-{i}" value={fb.providerModel} oninput={e => updateFallback(i, "providerModel", (e.target as HTMLInputElement).value)}
              class="border-input bg-background flex h-7 flex-1 rounded-lg border px-2 py-1 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50 placeholder:text-muted-foreground" />
            <datalist id="fb-model-suggestions-{i}">
              {#each providerModelsMap[fb.provider] ?? [] as m}
                <option value={m} />
              {/each}
            </datalist>
            <Button variant="ghost" size="icon-xs" onclick={() => removeFallback(i)}>
              <X />
            </Button>
          </div>
        {/each}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div class="grid gap-1">
          <Label for="rkt">Required Key Tier</Label>
          <Input id="rkt" type="text" placeholder="(optional)" bind:value={formRequiredKeyTier} />
        </div>
        <div class="grid gap-1">
          <Label for="rktag">Required Key Tags</Label>
          <Input id="rktag" type="text" placeholder="tag1, tag2" bind:value={formRequiredKeyTags} />
        </div>
      </div>
    </Card.Content>
    <Card.Footer class="justify-end gap-1.5">
      <Button variant="outline" size="sm" onclick={cancelEdit}>Cancel</Button>
      <Button size="sm" onclick={onSave} disabled={saving}>
        <Save data-icon="inline-start" />{saving ? "Saving..." : "Save"}
      </Button>
    </Card.Footer>
  </Card.Root>
{/snippet}
