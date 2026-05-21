<script lang="ts">
  import { page } from "$app/state";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";

  let { data } = $props<{
    data: {
      key: unknown | null;
      status: unknown | null;
      events: unknown | null;
    };
  }>();

  let k = $derived(
    data.key && typeof data.key === "object"
      ? (data.key as Record<string, unknown>)
      : null
  );
  let lifecycle = $derived(
    k ? ((k.lifecycleStatus ?? k.status ?? "active") as string) : "active"
  );
  let status = $derived(
    data.status && typeof data.status === "object"
      ? (data.status as Record<string, unknown>)
      : null
  );
  let events = $derived(
    data.events &&
      typeof data.events === "object" &&
      "events" in (data.events as Record<string, unknown>)
      ? ((data.events as { events: unknown[] }).events ?? [])
      : Array.isArray(data.events)
        ? data.events
        : []
  );

  async function handleArchive() {
    if (!k || !confirm("Archive this key?")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.archiveKey(k.id as string);
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }
  async function handleRestore() {
    if (!k) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.restoreKey(k.id as string);
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }
  async function handleDelete() {
    if (!k || !confirm("Delete?")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.deleteKey(k.id as string);
      window.location.href = "/keys";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }
  async function handleRevoke() {
    if (!k || !confirm("Revoke?")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const c = createClient();
      if (!c) return;
      await c.revokeKey(k.id as string);
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }
  function statusDotColor(l: string): string {
    if (l === "active") return "bg-success";
    if (l === "archived") return "bg-muted-foreground";
    if (l === "revoked") return "bg-destructive";
    return "bg-warning";
  }
</script>

<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item>
      <Breadcrumb.Link href="/keys">Keys</Breadcrumb.Link>
    </Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item>
      <Breadcrumb.Page
        >{k
          ? (k.id as string).slice(0, 12) + "..."
          : page.params.id}</Breadcrumb.Page
      >
    </Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>

<div class="flex items-start justify-between gap-3 mb-3 mt-1">
  <h1 class="text-xl font-semibold tracking-tight">Key Details</h1>
  {#if k}
    <div class="flex gap-1.5">
      {#if lifecycle === "active"}
        <Button variant="outline" size="xs" onclick={handleRevoke}
          >Revoke</Button
        >
        <Button variant="outline" size="xs" onclick={handleArchive}
          >Archive</Button
        >
      {:else if lifecycle === "archived"}
        <Button size="xs" onclick={handleRestore}>Restore</Button>
      {/if}
      <Button variant="destructive" size="xs" onclick={handleDelete}
        >Delete</Button
      >
    </div>
  {/if}
</div>

{#if k}
  <Card.Root class="mb-3">
    <Card.Content>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p
            class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
          >
            ID
          </p>
          <p class="font-mono text-xs mt-0.5">{k.id as string}</p>
        </div>
        <div>
          <p
            class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
          >
            Label
          </p>
          <p class="text-xs mt-0.5">{(k.label as string) ?? "-"}</p>
        </div>
        <div>
          <p
            class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
          >
            Status
          </p>
          <div class="flex items-center gap-1.5 mt-0.5">
            <Badge variant="secondary">
              <span
                class="inline-block size-2 rounded-full {statusDotColor(
                  lifecycle
                )}"
              ></span>
              {lifecycle}
            </Badge>
          </div>
        </div>
        <div>
          <p
            class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
          >
            Created
          </p>
          <p class="text-xs mt-0.5">{(k.createdAt as string) ?? "-"}</p>
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  {#if status}
    {@const s = status as Record<string, unknown>}
    <Card.Root class="mb-3">
      <Card.Header>
        <Card.Title
          class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium"
          >Quota Status</Card.Title
        >
      </Card.Header>
      <Card.Content>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          {#each Object.entries(s) as [name, value]}
            <div class="rounded-md bg-muted/30 px-2.5 py-1.5">
              <p class="text-[10px] text-muted-foreground">{name}</p>
              <p class="text-xs font-medium">
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value ?? "-")}
              </p>
            </div>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if events.length > 0}
    <div>
      <p
        class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2"
      >
        Audit Events
      </p>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Time</Table.Head>
            <Table.Head>Operation</Table.Head>
            <Table.Head>Actor</Table.Head>
            <Table.Head>Status</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each events as event}
            {@const e = event as Record<string, unknown>}
            <Table.Row>
              <Table.Cell class="text-xs text-muted-foreground font-mono"
                >{(e.timestamp as string) ?? "-"}</Table.Cell
              >
              <Table.Cell class="font-mono text-xs"
                >{(e.operation as string) ?? "-"}</Table.Cell
              >
              <Table.Cell class="text-xs"
                >{(e.actor as string) ?? "-"}</Table.Cell
              >
              <Table.Cell>
                <Badge variant="secondary">
                  <span
                    class="inline-block size-2 rounded-full {e.status ===
                    'success'
                      ? 'bg-success'
                      : 'bg-destructive'}"
                  ></span>
                  {(e.status as string) ?? "-"}
                </Badge>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  {/if}
{:else}
  <Card.Root class="py-4 text-center">
    <Card.Content>
      <p class="text-sm text-muted-foreground">Failed to load key details.</p>
    </Card.Content>
  </Card.Root>
{/if}
