<script lang="ts">
  import Nav from "$components/Nav.svelte";

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

  async function handleCreate(e: Event) {
    e.preventDefault();
    createError = "";
    createLoading = true;
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.createKey({ label: createLabel });
      window.location.reload();
    } catch (err) {
      createError = err instanceof Error ? err.message : "Failed to create key";
    } finally {
      createLoading = false;
    }
  }

  async function handleDelete(keyId: string) {
    if (!confirm("Delete this key? This cannot be undone.")) return;
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.deleteKey(keyId);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete key");
    }
  }

  async function handleArchive(keyId: string) {
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.archiveKey(keyId);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive key");
    }
  }

  async function handleRestore(keyId: string) {
    try {
      const { createClient } = await import("$lib/auth.js");
      const client = createClient();
      if (!client) return;
      await client.restoreKey(keyId);
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restore key");
    }
  }
</script>

<Nav />

<main class="max-w-7xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Gateway Keys</h2>
    <button
      onclick={() => (showCreate = !showCreate)}
      class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-md transition-colors"
    >
      {showCreate ? "Cancel" : "Create Key"}
    </button>
  </div>

  {#if showCreate}
    <form
      onsubmit={handleCreate}
      class="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6"
    >
      <div class="flex gap-4 items-end">
        <div class="flex-1">
          <label
            for="label"
            class="block text-sm font-medium text-gray-300 mb-1">Label</label
          >
          <input
            id="label"
            type="text"
            bind:value={createLabel}
            placeholder="Key label (optional)"
            class="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={createLoading}
          class="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-md transition-colors"
        >
          {createLoading ? "Creating..." : "Create"}
        </button>
      </div>
      {#if createError}
        <p class="text-red-400 text-sm mt-2">{createError}</p>
      {/if}
    </form>
  {/if}

  {#if keys.length > 0}
    <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-800 text-gray-400 text-left">
            <th class="px-4 py-3">ID</th>
            <th class="px-4 py-3">Label</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each keys as key}
            {@const k = key as Record<string, unknown>}
            {@const status = (k.lifecycleStatus ??
              k.status ??
              "active") as string}
            <tr class="border-b border-gray-800 last:border-0">
              <td class="px-4 py-3">
                <a
                  href="/keys/{k.id}"
                  class="text-blue-400 hover:text-blue-300 font-mono text-xs"
                  >{k.id as string}</a
                >
              </td>
              <td class="px-4 py-3 text-gray-300"
                >{(k.label as string) ?? "-"}</td
              >
              <td class="px-4 py-3">
                <span
                  class="px-2 py-1 rounded text-xs font-medium {status ===
                  'active'
                    ? 'bg-green-900 text-green-300'
                    : status === 'archived'
                      ? 'bg-gray-800 text-gray-400'
                      : 'bg-yellow-900 text-yellow-300'}"
                >
                  {status}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-2">
                  {#if status !== "archived"}
                    <button
                      onclick={() => handleArchive(k.id as string)}
                      class="text-gray-400 hover:text-yellow-300 text-xs"
                      >Archive</button
                    >
                  {:else}
                    <button
                      onclick={() => handleRestore(k.id as string)}
                      class="text-gray-400 hover:text-green-300 text-xs"
                      >Restore</button
                    >
                  {/if}
                  <button
                    onclick={() => handleDelete(k.id as string)}
                    class="text-gray-400 hover:text-red-300 text-xs"
                    >Delete</button
                  >
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if data.keys}
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
      <p class="text-gray-400">No keys found.</p>
    </div>
  {:else}
    <div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
      <p class="text-gray-400">Failed to load keys.</p>
    </div>
  {/if}
</main>
