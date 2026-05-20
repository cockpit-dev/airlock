<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import type { AdminConfigResponse } from "$lib/api.js";
  import { getStoredCredentials } from "$lib/auth.js";

  let { data } = $props<{ data: { config: AdminConfigResponse | null } }>();
  const hasCreds = $derived(Boolean(getStoredCredentials()));
  const providerLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Google Gemini"
  };
</script>

<div class="mb-4">
  <h1 class="text-xl font-semibold tracking-tight">Configuration</h1>
  <p class="text-xs text-muted-foreground">Gateway settings and resources</p>
</div>

<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
  <a href="/config/providers" class="group">
    <Card.Root class="hover:bg-muted/50 transition-colors">
      <Card.Content class="text-center py-3">
        <p class="text-sm font-medium">Providers</p>
        <p class="text-[11px] text-muted-foreground">API keys & models</p>
      </Card.Content>
    </Card.Root>
  </a>
  <a href="/config/routes" class="group">
    <Card.Root class="hover:bg-muted/50 transition-colors">
      <Card.Content class="text-center py-3">
        <p class="text-sm font-medium">Routes</p>
        <p class="text-[11px] text-muted-foreground">Model routing & fallbacks</p>
      </Card.Content>
    </Card.Root>
  </a>
  <a href="/config/accounts" class="group">
    <Card.Root class="hover:bg-muted/50 transition-colors">
      <Card.Content class="text-center py-3">
        <p class="text-sm font-medium">Accounts</p>
        <p class="text-[11px] text-muted-foreground">Users & roles</p>
      </Card.Content>
    </Card.Root>
  </a>
  <a href="/keys" class="group">
    <Card.Root class="hover:bg-muted/50 transition-colors">
      <Card.Content class="text-center py-3">
        <p class="text-sm font-medium">API Keys</p>
        <p class="text-[11px] text-muted-foreground">Gateway keys</p>
      </Card.Content>
    </Card.Root>
  </a>
</div>

{#if data.config}
  <!-- Providers -->
  <div class="mb-4">
    <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Providers</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {#each data.config.providers as provider}
        <Card.Root size="sm">
          <Card.Content>
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="inline-block size-2 rounded-full {provider.configured ? 'bg-success' : 'bg-muted-foreground'}"></span>
                <p class="text-sm font-medium">{provider.id}</p>
              </div>
              <Badge variant={provider.configured ? "default" : "secondary"}>
                {provider.configured ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div class="flex flex-col gap-1 text-xs">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Adapter</span><span>{providerLabels[provider.type] ?? provider.type}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Base URL</span>
                <span class="font-mono text-[11px] truncate ml-2">{provider.baseUrl}</span>
              </div>
              {#if "defaultModel" in provider}
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Model</span>
                  <span class="font-mono text-[11px]">{provider.defaultModel}</span>
                </div>
              {/if}
              {#if "defaultMaxTokens" in provider}
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Max Tokens</span>
                  <span>{provider.defaultMaxTokens.toLocaleString()}</span>
                </div>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  </div>

  <!-- Routes -->
  <div class="mb-4">
    <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Routes ({data.config.routes.length})</p>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Model</Table.Head>
          <Table.Head>Target</Table.Head>
          <Table.Head>Fallbacks</Table.Head>
          <Table.Head>Strategy</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.config.routes as route}
          <Table.Row>
            <Table.Cell class="font-mono text-xs font-medium">{route.externalModel}</Table.Cell>
            <Table.Cell><span class="text-xs">{route.target.provider}</span>
              <span class="text-muted-foreground">/</span>
              <span class="font-mono text-[11px]">{route.target.providerModel}</span></Table.Cell>
            <Table.Cell>{#if route.fallbacks?.length}{#each route.fallbacks as fb}<span class="text-[11px]"><span class="text-muted-foreground">{fb.provider}</span>/<span class="font-mono">{fb.providerModel}</span></span>{/each}{:else}<span class="text-muted-foreground text-xs">-</span>{/if}</Table.Cell>
            <Table.Cell class="text-xs text-muted-foreground">{route.strategy ?? "default"}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <!-- Model Groups -->
  {#if Object.keys(data.config.modelGroups).length > 0}
    <div class="mb-4">
      <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Model Groups</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {#each Object.entries(data.config.modelGroups) as [group, models]}
          <Card.Root size="sm">
            <Card.Content>
              <p class="text-sm font-medium mb-1.5">{group}</p>
              <div class="flex flex-wrap gap-1">
                {#each models as model}<Badge variant="outline">{model}</Badge>{/each}
              </div>
            </Card.Content>
          </Card.Root>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Features -->
  <div class="mb-4">
    <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Features</p>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {#each Object.entries(data.config.features) as [feature, value]}
        {@const enabled = typeof value === "boolean" ? value : value.enabled}
        <Card.Root size="sm">
          <Card.Content class="flex items-center justify-between">
            <span class="text-xs">{feature}</span>
            <Switch checked={enabled} disabled />
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  </div>

  <!-- Keys -->
  <div class="mb-4">
    <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Keys</p>
    <div class="grid grid-cols-3 gap-2">
      <Card.Root>
        <Card.Content class="text-center">
          <p class="text-2xl font-bold tracking-tight">{data.config.keys.total}</p>
          <p class="text-[10px] text-muted-foreground">Total</p>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="text-center">
          <p class="text-2xl font-bold tracking-tight">{data.config.keys.configured}</p>
          <p class="text-[10px] text-muted-foreground">Configured</p>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="text-center">
          <p class="text-2xl font-bold tracking-tight">{data.config.keys.registryOwned}</p>
          <p class="text-[10px] text-muted-foreground">Registry</p>
        </Card.Content>
      </Card.Root>
    </div>
  </div>

  <!-- Limits -->
  <div>
    <p class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Limits</p>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {#each Object.entries(data.config.limits) as [name, value]}
        <Card.Root size="sm">
          <Card.Content>
            <p class="text-[10px] text-muted-foreground">{name}</p>
            <p class="text-xs font-semibold">
              {typeof value === "number" && value >= 1000
                ? value >= 1_000_000
                  ? (value / 1_000_000).toFixed(1) + "MB"
                  : (value / 1000).toFixed(0) + "ms"
                : String(value)}
            </p>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  </div>
{:else if !hasCreds}
  <Card.Root class="border-warning/30 bg-warning/5">
    <Card.Content>
      <p class="text-sm">Connect to a gateway admin endpoint to view configuration.</p>
      <Button href="/login" size="sm" class="mt-2">Connect Gateway</Button>
    </Card.Content>
  </Card.Root>
{:else}
  <Card.Root class="border-destructive/30 bg-destructive/5">
    <Card.Content>
      <p class="text-sm text-destructive">Failed to load configuration.</p>
    </Card.Content>
  </Card.Root>
{/if}
