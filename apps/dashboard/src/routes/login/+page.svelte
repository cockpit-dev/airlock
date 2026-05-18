<script lang="ts">
  import { page } from "$app/state";
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

  const googleOAuthEnabled = $derived(Boolean(page.data.googleOAuthEnabled));
</script>

<div class="min-h-screen bg-gray-950 flex items-center justify-center">
  <div
    class="bg-gray-900 rounded-lg p-8 w-full max-w-md border border-gray-800"
  >
    <h1 class="text-2xl font-bold text-white mb-2">Airlock Dashboard</h1>
    <p class="text-gray-400 text-sm mb-6">Sign in to manage your AI gateway</p>

    {#if googleOAuthEnabled}
      <form action="/auth/signin/google" method="POST" class="mb-6">
        <button
          type="submit"
          class="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-800 font-medium py-2.5 px-4 rounded-md transition-colors"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>
      </form>

      <div class="flex items-center gap-3 mb-6">
        <div class="flex-1 h-px bg-gray-800"></div>
        <span class="text-gray-500 text-xs">OR</span>
        <div class="flex-1 h-px bg-gray-800"></div>
      </div>
    {/if}

    <!-- Token Auth -->
    <div class="mb-4 rounded-md border border-gray-800 bg-gray-950/60 p-3">
      <p class="text-xs leading-5 text-gray-400">
        Google OAuth unlocks the dashboard session. Gateway management still
        requires connecting a gateway URL and an admin credential, because the
        admin API is enforced by the gateway itself.
      </p>
    </div>

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
