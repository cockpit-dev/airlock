<script lang="ts">
  import Nav from "$components/Nav.svelte";

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
      const client = createClient();
      if (!client) return;
      await client.archiveKey(k.id as string);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive key");
    }
  }

  async function handleRestore() {
    if (!k) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.restoreKey(k.id as string);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restore key");
    }
  }

  async function handleDelete() {
    if (!k || !confirm("Delete this key? This cannot be undone.")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.deleteKey(k.id as string);
      window.location.href = "/keys";
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete key");
    }
  }

  async function handleRevoke() {
    if (!k || !confirm("Revoke this key?")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.revokeKey(k.id as string);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Key Details</h2>
    <div class="flex gap-2">
      {#if k}
        {@const lifecycle = (k.lifecycleStatus ??
          k.status ??
          "active") as string}
        {#if lifecycle === "active"}
          <button
            onclick={handleRevoke}
            class="text-sm text-gray-400 hover:text-red-300 px-3 py-1.5 border border-gray-700 rounded-md transition-colors"
            >Revoke</button
          >
          <button
            onclick={handleArchive}
            class="text-sm text-gray-400 hover:text-yellow-300 px-3 py-1.5 border border-gray-700 rounded-md transition-colors"
            >Archive</button
          >
        {:else if lifecycle === "archived"}
          <button
            onclick={handleRestore}
            class="text-sm text-gray-400 hover:text-green-300 px-3 py-1.5 border border-gray-700 rounded-md transition-colors"
            >Restore</button
          >
        {/if}
        <button
          onclick={handleDelete}
          class="text-sm text-gray-400 hover:text-red-300 px-3 py-1.5 border border-gray-700 rounded-md transition-colors"
          >Delete</button
        >
      {/if}
    </div>
  </div>

  {#if k}
    <!-- Key Info -->
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p class="text-sm text-gray-500 mb-1">ID</p>
          <p class="text-white font-mono text-sm">{k.id as string}</p>
        </div>
        <div>
          <p class="text-sm text-gray-500 mb-1">Label</p>
          <p class="text-white text-sm">{(k.label as string) ?? "-"}</p>
        </div>
        <div>
          <p class="text-sm text-gray-500 mb-1">Status</p>
          {#if lifecycle === "active"}
            <span
              class="px-2 py-1 rounded text-xs font-medium bg-green-900 text-green-300"
              >{lifecycle}</span
            >
          {:else if lifecycle === "archived"}
            <span
              class="px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-400"
              >{lifecycle}</span
            >
          {:else if lifecycle === "revoked"}
            <span
              class="px-2 py-1 rounded text-xs font-medium bg-red-900 text-red-300"
              >{lifecycle}</span
            >
          {:else}
            <span
              class="px-2 py-1 rounded text-xs font-medium bg-yellow-900 text-yellow-300"
              >{lifecycle}</span
            >
          {/if}
        </div>
        <div>
          <p class="text-sm text-gray-500 mb-1">Created</p>
          <p class="text-white text-sm">{(k.createdAt as string) ?? "-"}</p>
        </div>
      </div>
    </div>

    <!-- Quota Status -->
    {#if status}
      {@const s = status as Record<string, unknown>}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h3 class="text-lg font-semibold text-gray-200 mb-4">Quota Status</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          {#each Object.entries(s) as [name, value]}
            <div class="bg-gray-800 rounded-lg p-3">
              <p class="text-xs text-gray-500">{name}</p>
              <p class="text-white font-medium">
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value ?? "-")}
              </p>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Audit Events -->
    {#if events.length > 0}
      <div
        class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
      >
        <div class="px-6 py-4 border-b border-gray-800">
          <h3 class="text-lg font-semibold text-gray-200">Audit Events</h3>
        </div>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-800 text-gray-400 text-left">
              <th class="px-4 py-3">Time</th>
              <th class="px-4 py-3">Operation</th>
              <th class="px-4 py-3">Actor</th>
              <th class="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each events as event}
              {@const e = event as Record<string, unknown>}
              <tr class="border-b border-gray-800 last:border-0">
                <td class="px-4 py-3 text-gray-400 text-xs font-mono"
                  >{(e.timestamp as string) ?? "-"}</td
                >
                <td class="px-4 py-3 text-white font-mono text-xs"
                  >{(e.operation as string) ?? "-"}</td
                >
                <td class="px-4 py-3 text-gray-300 text-xs"
                  >{(e.actor as string) ?? "-"}</td
                >
                <td class="px-4 py-3">
                  <span
                    class="px-2 py-1 rounded text-xs font-medium {e.status ===
                    'success'
                      ? 'bg-green-900 text-green-300'
                      : 'bg-red-900 text-red-300'}"
                  >
                    {(e.status as string) ?? "-"}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
      <p class="text-gray-400">Failed to load key details.</p>
    </div>
  {/if}
</main>
