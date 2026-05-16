<script lang="ts">
  import { clearCredentials, getStoredCredentials } from "$lib/auth.js";

  const creds = $derived(getStoredCredentials());

  function handleLogout() {
    clearCredentials();
    window.location.href = "/login";
  }
</script>

<nav class="bg-gray-900 text-white px-6 py-3 flex items-center justify-between">
  <div class="flex items-center gap-6">
    <a href="/" class="font-bold text-lg tracking-tight">Airlock</a>
    <div class="flex gap-4 text-sm">
      <a href="/" class="hover:text-gray-300">Dashboard</a>
      <a href="/keys" class="hover:text-gray-300">Keys</a>
      <a href="/routes" class="hover:text-gray-300">Routes</a>
      <a href="/config" class="hover:text-gray-300">Config</a>
      <a href="/config/providers" class="hover:text-gray-300">Providers</a>
      <a href="/config/routes" class="hover:text-gray-300">Routes</a>
      <a href="/config/accounts" class="hover:text-gray-300">Accounts</a>
    </div>
  </div>
  <div class="flex items-center gap-4 text-sm text-gray-400">
    {#if creds}
      <span class="truncate max-w-48">{creds.url}</span>
    {/if}
    <button onclick={handleLogout} class="hover:text-white">Logout</button>
  </div>
</nav>
