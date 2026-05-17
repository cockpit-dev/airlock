<script lang="ts">
  import { page } from "$app/state";
  import { signOut as authSignOut } from "@auth/sveltekit/client";
  import { clearCredentials, getStoredCredentials } from "$lib/auth.js";

  const session = $derived(page.data.session);
  const creds = $derived(getStoredCredentials());
  const remoteGatewayUrl = $derived(creds?.url ?? null);
  const hasRemoteGatewayCredentials = $derived(Boolean(creds));
  const hasOAuthSession = $derived(Boolean(session?.user));
  const canManageGateway = $derived(hasRemoteGatewayCredentials);

  async function handleLogout() {
    clearCredentials();
    if (hasOAuthSession) {
      await authSignOut({ redirectTo: "/login" });
      return;
    }
    window.location.href = "/login";
  }
</script>

<nav class="bg-gray-900 text-white px-6 py-3 flex items-center justify-between">
  <div class="flex items-center gap-6">
    <a href="/" class="font-bold text-lg tracking-tight">Airlock</a>
    <div class="flex gap-4 text-sm">
      <a href="/" class="hover:text-gray-300">Dashboard</a>
      {#if canManageGateway}
        <a href="/keys" class="hover:text-gray-300">Keys</a>
        <a href="/routes" class="hover:text-gray-300">Routes</a>
        <a href="/config" class="hover:text-gray-300">Config</a>
        <a href="/config/providers" class="hover:text-gray-300">Providers</a>
        <a href="/config/routes" class="hover:text-gray-300">Routes</a>
        <a href="/config/accounts" class="hover:text-gray-300">Accounts</a>
      {/if}
    </div>
  </div>
  <div class="flex items-center gap-4 text-sm text-gray-400">
    {#if session?.user?.email}
      <span class="truncate max-w-48">{session.user.email}</span>
    {/if}
    {#if remoteGatewayUrl}
      <span class="truncate max-w-48">{remoteGatewayUrl}</span>
    {/if}
    <button onclick={handleLogout} class="hover:text-white">Logout</button>
  </div>
</nav>
