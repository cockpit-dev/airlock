<script lang="ts">
  import { verifyCredentials, storeCredentials } from "$lib/auth.js";

  let url = $state("");
  let token = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    try {
      const valid = await verifyCredentials(url, token);
      if (valid) {
        storeCredentials(url, token);
        window.location.href = "/";
      } else {
        error = "Invalid credentials";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Connection failed";
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen bg-gray-950 flex items-center justify-center">
  <div class="bg-gray-900 rounded-lg p-8 w-full max-w-md border border-gray-800">
    <h1 class="text-2xl font-bold text-white mb-6">Airlock Dashboard</h1>

    <form onsubmit={handleSubmit} class="space-y-4">
      <div>
        <label for="url" class="block text-sm font-medium text-gray-300 mb-1"
          >Gateway URL</label
        >
        <input
          id="url"
          type="url"
          bind:value={url}
          placeholder="https://your-gateway.workers.dev"
          required
          class="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label for="token" class="block text-sm font-medium text-gray-300 mb-1"
          >Admin Token</label
        >
        <input
          id="token"
          type="password"
          bind:value={token}
          placeholder="Bearer token"
          required
          class="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {#if error}
        <p class="text-red-400 text-sm">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-md transition-colors"
      >
        {loading ? "Connecting..." : "Connect"}
      </button>
    </form>
  </div>
</div>
