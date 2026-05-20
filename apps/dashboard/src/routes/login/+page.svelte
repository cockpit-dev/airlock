<script lang="ts">
  import { page } from "$app/state";
  import { verifyCredentials, storeCredentials } from "$lib/auth.js";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Separator } from "$lib/components/ui/separator";
  import Lock from "@lucide/svelte/icons/lock";

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

<div class="flex min-h-screen items-center justify-center bg-background px-4">
  <div class="w-full max-w-sm">
    <div class="flex flex-col items-center gap-2">
      <div class="flex items-center gap-2">
        <Lock class="size-6 text-brand" />
        <h1 class="text-xl font-semibold tracking-tight">Airlock Dashboard</h1>
      </div>
      <p class="text-xs text-muted-foreground">Sign in to manage your AI gateway</p>
    </div>

    <Card.Root class="mt-6">
      <Card.Content>
        <div class="flex flex-col gap-4">
          {#if googleOAuthEnabled}
            <form action="/auth/signin/google" method="POST">
              <Button type="submit" variant="outline" class="w-full">
                <svg data-icon="inline-start" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </Button>
            </form>
            <div class="relative flex items-center gap-2">
              <Separator class="flex-1" />
              <span class="text-[11px] uppercase text-muted-foreground">or</span>
              <Separator class="flex-1" />
            </div>
          {/if}

          <p class="text-[11px] leading-relaxed text-muted-foreground">Gateway management requires a gateway URL and admin credential.</p>

          <form onsubmit={handleSubmit} class="flex flex-col gap-3">
            <div class="flex flex-col gap-1.5">
              <Label for="url">Gateway URL</Label>
              <Input id="url" type="url" bind:value={url} placeholder="https://your-gateway.workers.dev" required />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="token">Admin Token</Label>
              <Input id="token" type="password" bind:value={token} placeholder="Bearer token" required />
            </div>
            {#if error}
              <p class="text-xs text-destructive">{error}</p>
            {/if}
            <Button type="submit" disabled={loading} class="w-full">
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </form>
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>
