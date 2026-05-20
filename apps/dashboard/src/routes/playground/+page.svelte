<script lang="ts">
  import OpenAI from "openai";
  import type { EasyInputMessage } from "openai/resources/responses/responses";
  import { createClient, getStoredCredentials } from "$lib/auth.js";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Spinner } from "$lib/components/ui/spinner";
  import Send from "@lucide/svelte/icons/send";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import StopCircle from "@lucide/svelte/icons/stop-circle";
  import Settings2 from "@lucide/svelte/icons/settings-2";

  type Message = { role: "user" | "assistant"; content: string };

  const creds = getStoredCredentials();

  let models = $state<string[]>([]);
  let selectedModel = $state("");
  let instructions = $state("");
  let temperature = $state(0.7);
  let messages = $state<Message[]>([]);
  let input = $state("");
  let streaming = $state(false);
  let streamingContent = $state("");
  let errorMsg = $state("");
  let showSettings = $state(false);
  let initializing = $state(true);
  let scrollEl: HTMLElement | null = $state(null);
  let abortCtrl: AbortController | null = null;
  let inputEl: HTMLTextAreaElement | null = $state(null);

  async function loadModels() {
    if (!creds) return;

    // Source 1: /v1/models (includes routes + provider-declared models)
    try {
      const resp = await fetch(`${creds.url}/v1/models`, {
        headers: { Authorization: `Bearer ${creds.token}` }
      });
      if (resp.ok) {
        const body = await resp.json();
        const ids: string[] = (body?.data ?? []).map((m: any) => m.id);
        if (ids.length > 0) {
          models = ids.sort();
          selectedModel = models[0];
          return;
        }
      }
    } catch { /* fall through */ }

    // Source 2: admin config store — providers with models field
    try {
      const client = createClient(creds.url, creds.token);
      const snapshot = await client.getConfigStoreSnapshot();
      const sec = snapshot.sections["providers"];
      if (sec?.data && Array.isArray(sec.data)) {
        const providerModels: string[] = [];
        for (const p of sec.data as Array<{ id: string; models?: string[] }>) {
          for (const m of p.models ?? []) {
            providerModels.push(`${p.id}/${m}`);
          }
        }
        if (providerModels.length > 0) {
          models = providerModels.sort();
          selectedModel = models[0];
          return;
        }
      }
    } catch { /* fall through */ }

    // Source 3: admin config — routes
    try {
      const client = createClient(creds.url, creds.token);
      const config = await client.getConfig();
      const routeModels = config.routes.map(r => r.externalModel);
      if (routeModels.length > 0) {
        models = routeModels.sort();
        selectedModel = models[0];
      }
    } catch { /* empty */ }
  }

  function getOpenAIClient(): OpenAI | null {
    if (!creds) return null;
    const base = creds.url.replace(/\/$/, "");
    return new OpenAI({
      baseURL: base.endsWith("/v1") ? base : `${base}/v1`,
      apiKey: creds.token,
      dangerouslyAllowBrowser: true,
    });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  function buildInput(): EasyInputMessage[] {
    return messages.map(m => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
    }));
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    const client = getOpenAIClient();
    if (!client) return;

    errorMsg = "";
    messages = [...messages, { role: "user", content: text }];
    input = "";
    streaming = true;
    streamingContent = "";
    scrollToBottom();
    abortCtrl = new AbortController();

    try {
      const stream = await client.responses.create({
        model: selectedModel,
        input: [...buildInput()],
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        temperature,
        stream: true,
      }, { signal: abortCtrl.signal });

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          streamingContent += event.delta;
          scrollToBottom();
        }
        if (event.type === "response.error") {
          errorMsg = (event as any).error?.message ?? "Stream error";
          break;
        }
      }

      if (streamingContent) {
        messages = [...messages, { role: "assistant", content: streamingContent }];
      }
      streamingContent = "";
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        errorMsg = e instanceof Error ? e.message : "Request failed";
        if (streamingContent) {
          messages = [...messages, { role: "assistant", content: streamingContent }];
          streamingContent = "";
        }
      }
    } finally {
      streaming = false;
      abortCtrl = null;
      scrollToBottom();
      inputEl?.focus();
    }
  }

  function stopStreaming() {
    abortCtrl?.abort();
    if (streamingContent) {
      messages = [...messages, { role: "assistant", content: streamingContent }];
      streamingContent = "";
    }
    streaming = false;
    abortCtrl = null;
  }

  function clearChat() {
    messages = [];
    streamingContent = "";
    errorMsg = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  loadModels().finally(() => { initializing = false; });
</script>

<svelte:head><title>Playground - Airlock</title></svelte:head>

<div class="flex flex-col h-[calc(100vh-3.5rem)]">
  {#if !creds}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <h2 class="text-sm font-semibold mb-1">No Gateway Connected</h2>
        <p class="text-xs text-muted-foreground mb-3">Connect to a gateway to use the playground.</p>
        <Button size="sm" href="/login">Connect Gateway</Button>
      </div>
    </div>
  {:else if initializing}
    <div class="flex-1 flex items-center justify-center">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner class="size-4" />
        Loading models...
      </div>
    </div>
  {:else if models.length === 0}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm">
        <h2 class="text-sm font-semibold mb-1">No Models Available</h2>
        <p class="text-xs text-muted-foreground mb-3">Add models to your providers or configure routes.</p>
        <Button size="sm" href="/config/providers">Configure Providers</Button>
      </div>
    </div>
  {:else}
    <!-- Top bar -->
    <div class="flex items-center justify-between px-3 py-1.5 border-b">
      <div class="flex items-center gap-2">
        <select
          bind:value={selectedModel}
          class="border-input bg-background h-7 rounded-lg border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {#each models as m}
            <option value={m}>{m}</option>
          {/each}
        </select>
        <button
          onclick={() => showSettings = !showSettings}
          class="size-7 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Settings2 class="size-3.5" />
        </button>
      </div>
      <Button variant="ghost" size="xs" onclick={clearChat} disabled={messages.length === 0 && !streamingContent}>
        <Trash2 data-icon="inline-start" />Clear
      </Button>
    </div>

    <!-- Settings drawer -->
    {#if showSettings}
      <div class="border-b bg-muted/30 px-3 py-2">
        <div class="max-w-3xl mx-auto flex flex-wrap items-end gap-2">
          <div class="w-[72px]">
            <label class="text-[11px] text-muted-foreground">Temp</label>
            <input
              type="number"
              bind:value={temperature}
              min="0" max="2" step="0.1"
              class="border-input bg-background flex h-7 w-full rounded-lg border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div class="flex-1 min-w-[200px]">
            <label class="text-[11px] text-muted-foreground">Instructions</label>
            <input
              type="text"
              bind:value={instructions}
              placeholder="(optional)"
              class="border-input bg-background flex h-7 w-full rounded-lg border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>
    {/if}

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto" bind:this={scrollEl}>
      {#if messages.length === 0 && !streamingContent}
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <p class="text-sm font-medium mb-0.5">{selectedModel}</p>
            <p class="text-xs text-muted-foreground">What can I help you with?</p>
          </div>
        </div>
      {:else}
        <div class="max-w-3xl mx-auto px-3 py-4 flex flex-col gap-4">
          {#each messages as msg}
            {#if msg.role === "user"}
              <div class="flex justify-end">
                <div class="max-w-[80%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed">
                  {msg.content}
                </div>
              </div>
            {:else}
              <div class="flex justify-start">
                <div class="max-w-[80%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed">
                  {msg.content}
                </div>
              </div>
            {/if}
          {/each}
          {#if streamingContent}
            <div class="flex justify-start">
              <div class="max-w-[80%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed">
                {streamingContent}<span class="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse align-text-bottom ml-0.5 rounded-sm"></span>
              </div>
            </div>
          {/if}
          {#if errorMsg}
            <div class="flex justify-center">
              <div class="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive max-w-md">
                {errorMsg}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Input -->
    <div class="border-t bg-background">
      <div class="max-w-3xl mx-auto px-3 py-2.5">
        <div class="flex gap-2 items-end">
          <div class="flex-1">
            <Textarea
              bind:this={inputEl}
              bind:value={input}
              onkeydown={handleKeydown}
              placeholder="Message..."
              class="min-h-10 max-h-40 text-sm resize-none"
              disabled={streaming}
            />
          </div>
          {#if streaming}
            <Button variant="destructive" size="icon" onclick={stopStreaming} class="shrink-0 size-9">
              <StopCircle class="size-4" />
            </Button>
          {:else}
            <Button size="icon" onclick={handleSend} disabled={!input.trim()} class="shrink-0 size-9">
              <Send class="size-4" />
            </Button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
