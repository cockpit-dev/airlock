<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";

  let { data } = $props<{ data: { keys: unknown } }>();

  let keys = $derived(
    Array.isArray(data.keys)
      ? data.keys
      : data.keys &&
          typeof data.keys === "object" &&
          "keys" in (data.keys as Record<string, unknown>)
        ? (data.keys as { keys: unknown[] }).keys
        : []
  );

  let showCreate = $state(false);
  let createLabel = $state("");
  let createError = $state("");
  let createLoading = $state(false);
  let createdSecrets = $state<{ id: string; label: string; secret: string }[]>(
    []
  );
  let copiedId = $state("");

  function generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return `airlok_${hex}`;
  }

  async function sha256Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    createError = "";
    createLoading = true;
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      const secret = generateSecret();
      const valueHash = await sha256Hex(secret);
      const id = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        id,
        label: createLabel.trim() || id,
        valueHash,
        status: "active"
      };
      await client.createKey(payload);
      createdSecrets = [
        ...createdSecrets,
        { id, label: createLabel.trim() || id, secret }
      ];
      createLabel = "";
    } catch (err) {
      createError = err instanceof Error ? err.message : "Failed to create key";
    } finally {
      createLoading = false;
    }
  }

  function copySecret(id: string, text: string) {
    navigator.clipboard.writeText(text);
    copiedId = id;
    setTimeout(() => {
      copiedId = "";
    }, 2000);
  }

  function dismissSecret(id: string) {
    createdSecrets = createdSecrets.filter((s) => s.id !== id);
  }
  async function handleDelete(keyId: string) {
    if (!confirm("Delete this key?")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.deleteKey(keyId);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }
  async function handleArchive(keyId: string) {
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.archiveKey(keyId);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }
  async function handleRestore(keyId: string) {
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.restoreKey(keyId);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  function statusColor(status: string): string {
    if (status === "active") return "bg-success";
    if (status === "archived") return "bg-muted-foreground";
    return "bg-warning";
  }
</script>

<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item>
      <Breadcrumb.Page>Keys</Breadcrumb.Page>
    </Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>

<div class="flex items-start justify-between mb-3 mt-1">
  <div>
    <h1 class="text-xl font-semibold tracking-tight">API Keys</h1>
    <p class="text-xs text-muted-foreground">Manage gateway access keys</p>
  </div>
  <Button size="sm" onclick={() => (showCreate = !showCreate)}>
    {showCreate ? "Cancel" : "+ Create Key"}
  </Button>
</div>

{#if createdSecrets.length > 0}
  {#each createdSecrets as cs (cs.id)}
    <Card.Root class="mb-2 border-success/30 bg-success/5">
      <Card.Content>
        <div class="flex items-center justify-between mb-1.5">
          <p class="text-sm font-medium">{cs.label}</p>
          <Button
            variant="ghost"
            size="xs"
            onclick={() => dismissSecret(cs.id)}
          >
            <X class="size-3" />
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <code
            class="flex-1 text-xs font-mono bg-background rounded-lg border px-3 py-2 break-all select-all"
            >{cs.secret}</code
          >
          <Button
            variant="outline"
            size="icon"
            onclick={() => copySecret(cs.id, cs.secret)}
          >
            {#if copiedId === cs.id}<Check
                class="size-4 text-success"
              />{:else}<Copy class="size-4" />{/if}
          </Button>
        </div>
      </Card.Content>
    </Card.Root>
  {/each}
{/if}

{#if showCreate}
  <Card.Root class="mb-3">
    <Card.Content>
      <form
        onsubmit={handleCreate}
        class="flex flex-col sm:flex-row gap-2 items-end"
      >
        <div class="flex-1 flex flex-col gap-1.5">
          <Label for="label">Label</Label>
          <Input
            id="label"
            type="text"
            bind:value={createLabel}
            placeholder="Optional label"
          />
        </div>
        <Button type="submit" size="sm" disabled={createLoading}>
          {createLoading ? "Creating..." : "Create"}
        </Button>
      </form>
      {#if createError}
        <p class="text-xs text-destructive mt-2">{createError}</p>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}

{#if keys.length > 0}
  <!-- Desktop -->
  <div class="hidden md:block">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>ID</Table.Head>
          <Table.Head>Label</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="text-right">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each keys as key}
          {@const k = key as Record<string, unknown>}
          {@const status = (k.lifecycleStatus ??
            k.status ??
            "active") as string}
          <Table.Row>
            <Table.Cell
              ><a href="/keys/{k.id}" class="font-mono text-xs hover:underline"
                >{k.id as string}</a
              ></Table.Cell
            >
            <Table.Cell class="text-muted-foreground"
              >{(k.label as string) ?? "-"}</Table.Cell
            >
            <Table.Cell>
              <Badge variant="secondary">
                <span
                  class="inline-block size-2 rounded-full {statusColor(status)}"
                ></span>
                {status}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <div class="flex justify-end gap-1">
                {#if status !== "archived"}
                  <Button
                    variant="ghost"
                    size="xs"
                    onclick={() => handleArchive(k.id as string)}
                    >Archive</Button
                  >
                {:else}
                  <Button
                    variant="ghost"
                    size="xs"
                    onclick={() => handleRestore(k.id as string)}
                    >Restore</Button
                  >
                {/if}
                <Button
                  variant="ghost"
                  size="xs"
                  class="text-destructive"
                  onclick={() => handleDelete(k.id as string)}>Delete</Button
                >
              </div>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <!-- Mobile -->
  <div class="flex flex-col gap-2 md:hidden">
    {#each keys as key}
      {@const k = key as Record<string, unknown>}
      {@const status = (k.lifecycleStatus ?? k.status ?? "active") as string}
      <Card.Root size="sm">
        <Card.Content>
          <div class="flex items-center justify-between mb-2">
            <a href="/keys/{k.id}" class="font-mono text-xs hover:underline"
              >{k.id as string}</a
            >
            <Badge variant="secondary">
              <span
                class="inline-block size-2 rounded-full {statusColor(status)}"
              ></span>
              {status}
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground mb-2">
            {(k.label as string) ?? "-"}
          </p>
          <div class="flex gap-1">
            {#if status !== "archived"}
              <Button
                variant="ghost"
                size="xs"
                onclick={() => handleArchive(k.id as string)}>Archive</Button
              >
            {:else}
              <Button
                variant="ghost"
                size="xs"
                onclick={() => handleRestore(k.id as string)}>Restore</Button
              >
            {/if}
            <Button
              variant="ghost"
              size="xs"
              class="text-destructive"
              onclick={() => handleDelete(k.id as string)}>Delete</Button
            >
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
{:else if data.keys}
  <Card.Root class="py-4 text-center">
    <Card.Content class="flex flex-col items-center justify-center">
      <KeyRound class="size-8 text-muted-foreground/50 mb-2" />
      <p class="text-xs text-muted-foreground">No API keys yet</p>
      <Button
        variant="link"
        size="sm"
        onclick={() => (showCreate = true)}
        class="mt-2">Create your first key</Button
      >
    </Card.Content>
  </Card.Root>
{:else}
  <Card.Root class="py-4 text-center">
    <Card.Content>
      <p class="text-sm text-muted-foreground">Failed to load keys.</p>
    </Card.Content>
  </Card.Root>
{/if}
