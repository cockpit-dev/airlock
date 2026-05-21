<script lang="ts">
  import { createClient, getStoredCredentials } from "$lib/auth.js";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import Plus from "@lucide/svelte/icons/plus";
  import Save from "@lucide/svelte/icons/save";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  type Account = {
    email: string;
    role: string;
    enabled: boolean;
    createdAt: number;
  };
  type AccountsConfig = { accounts: Account[] };

  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let editAccountEmail = $state<string | null>(null);
  let showCreateForm = $state(false);
  let accounts = $state<Account[]>([]);
  let formEmail = $state("");
  let formRole = $state("viewer");
  let formEnabled = $state(true);
  const roleOptions = ["super_admin", "admin", "operator", "viewer"];
  function resetForm() {
    formEmail = "";
    formRole = "viewer";
    formEnabled = true;
  }
  async function loadConfig() {
    const c = getStoredCredentials();
    if (!c) return;
    const cl = createClient(c.url, c.token);
    try {
      const s = await cl.getConfigStoreSnapshot();
      const sec = s.sections["accounts"];
      if (
        sec?.data &&
        typeof sec.data === "object" &&
        "accounts" in (sec.data as Record<string, unknown>)
      )
        accounts = (sec.data as AccountsConfig).accounts;
    } catch {
    } finally {
      loading = false;
    }
  }
  async function saveAccounts() {
    const c = getStoredCredentials();
    if (!c) return;
    const cl = createClient(c.url, c.token);
    saving = true;
    error = "";
    success = "";
    try {
      await cl.putConfigStoreSection("accounts", { accounts });
      success = "Saved";
      editAccountEmail = null;
      showCreateForm = false;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed";
    } finally {
      saving = false;
    }
  }
  function startCreate() {
    resetForm();
    showCreateForm = true;
    editAccountEmail = null;
  }
  function startEdit(email: string) {
    const a = accounts.find((x) => x.email === email);
    if (!a) return;
    formEmail = a.email;
    formRole = a.role;
    formEnabled = a.enabled;
    editAccountEmail = email;
    showCreateForm = false;
  }
  function cancelEdit() {
    editAccountEmail = null;
    showCreateForm = false;
    resetForm();
  }
  function applyCreate() {
    if (!formEmail.trim()) {
      error = "Email required";
      return;
    }
    if (accounts.some((a) => a.email === formEmail.trim())) {
      error = "Exists";
      return;
    }
    error = "";
    accounts = [
      ...accounts,
      {
        email: formEmail.trim(),
        role: formRole,
        enabled: formEnabled,
        createdAt: Date.now()
      }
    ];
    showCreateForm = false;
    resetForm();
    saveAccounts();
  }
  function applyEdit() {
    if (!editAccountEmail || !formEmail.trim()) {
      error = "Email required";
      return;
    }
    error = "";
    accounts = accounts.map((a) =>
      a.email === editAccountEmail
        ? {
            ...a,
            email: formEmail.trim(),
            role: formRole,
            enabled: formEnabled
          }
        : a
    );
    editAccountEmail = null;
    resetForm();
    saveAccounts();
  }
  function toggleEnabled(email: string) {
    accounts = accounts.map((a) =>
      a.email === email ? { ...a, enabled: !a.enabled } : a
    );
    saveAccounts();
  }
  function deleteAccount(email: string) {
    if (!confirm(`Delete ${email}?`)) return;
    accounts = accounts.filter((a) => a.email !== email);
    saveAccounts();
  }
  function roleBadgeVariant(
    role: string
  ): "destructive" | "secondary" | "outline" | "default" {
    switch (role) {
      case "super_admin":
        return "destructive";
      case "admin":
        return "secondary";
      case "operator":
        return "outline";
      default:
        return "default";
    }
  }
  loadConfig();
</script>

<svelte:head><title>Accounts - Airlock</title></svelte:head>

<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item
      ><Breadcrumb.Link href="/config">Config</Breadcrumb.Link></Breadcrumb.Item
    >
    <Breadcrumb.Separator />
    <Breadcrumb.Item
      ><Breadcrumb.Page>Accounts</Breadcrumb.Page></Breadcrumb.Item
    >
  </Breadcrumb.List>
</Breadcrumb.Root>

<div class="flex items-center justify-between mb-3 mt-1">
  <h1 class="text-xl font-semibold tracking-tight">Account Management</h1>
  {#if !loading}
    <Button size="sm" onclick={startCreate}
      ><Plus data-icon="inline-start" />Add Account</Button
    >
  {/if}
</div>

{#if error}
  <div
    class="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 mb-3 text-xs text-destructive"
  >
    {error}
  </div>
{/if}
{#if success}
  <div
    class="rounded-lg border border-success/30 bg-success/5 p-2.5 mb-3 text-xs text-success"
  >
    {success}
  </div>
{/if}

{#if loading}
  <Card.Root class="py-4 text-center">
    <Card.Content
      ><p class="text-sm text-muted-foreground">Loading...</p></Card.Content
    >
  </Card.Root>
{:else}
  {#if showCreateForm || editAccountEmail}
    <Card.Root class="mb-3">
      <Card.Header>
        <h3 class="text-sm font-semibold">
          {editAccountEmail ? "Edit Account" : "Add Account"}
        </h3>
      </Card.Header>
      <Card.Content class="grid gap-2.5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div class="grid gap-1">
            <Label for="ae">Email</Label>
            <Input
              id="ae"
              type="email"
              placeholder="user@example.com"
              bind:value={formEmail}
              disabled={editAccountEmail !== null}
            />
          </div>
          <div class="grid gap-1">
            <Label for="ar">Role</Label>
            <select
              id="ar"
              bind:value={formRole}
              class="border-input bg-background flex h-8 w-full rounded-lg border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {#each roleOptions as r}<option value={r}>{r}</option>{/each}
            </select>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Switch bind:checked={formEnabled} />
          <Label class="!gap-0 text-xs">Enabled</Label>
        </div>
      </Card.Content>
      <Card.Footer class="justify-end gap-1.5">
        <Button variant="outline" size="sm" onclick={cancelEdit}>Cancel</Button>
        <Button
          size="sm"
          onclick={editAccountEmail ? applyEdit : applyCreate}
          disabled={saving}
        >
          <Save data-icon="inline-start" />{saving ? "Saving..." : "Save"}
        </Button>
      </Card.Footer>
    </Card.Root>
  {/if}

  <!-- Desktop: Table -->
  <div class="hidden md:block">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>Email</Table.Head>
          <Table.Head>Role</Table.Head>
          <Table.Head>Status</Table.Head>
          <Table.Head class="text-right">Actions</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each accounts as account}
          <Table.Row>
            <Table.Cell class="font-mono text-xs">{account.email}</Table.Cell>
            <Table.Cell>
              <Badge variant={roleBadgeVariant(account.role)}
                >{account.role}</Badge
              >
            </Table.Cell>
            <Table.Cell>
              <button
                onclick={() => toggleEnabled(account.email)}
                class="flex items-center gap-1.5 cursor-pointer"
              >
                <span
                  class="size-2 rounded-full {account.enabled
                    ? 'bg-success'
                    : 'bg-muted-foreground'}"
                ></span>
                <span class="text-xs"
                  >{account.enabled ? "Active" : "Disabled"}</span
                >
              </button>
            </Table.Cell>
            <Table.Cell>
              <div class="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onclick={() => startEdit(account.email)}
                >
                  <Pencil data-icon="inline-start" />Edit
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onclick={() => deleteAccount(account.email)}
                >
                  <Trash2 data-icon="inline-start" />Delete
                </Button>
              </div>
            </Table.Cell>
          </Table.Row>
        {/each}
        {#if accounts.length === 0}
          <Table.Row>
            <Table.Cell
              colspan={4}
              class="py-4 text-center text-sm text-muted-foreground"
            >
              No accounts configured.
            </Table.Cell>
          </Table.Row>
        {/if}
      </Table.Body>
    </Table.Root>
  </div>

  <!-- Mobile: Card list -->
  <div class="md:hidden grid gap-2">
    {#each accounts as account}
      <Card.Root size="sm">
        <Card.Content>
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs">{account.email}</span>
            <Badge variant={roleBadgeVariant(account.role)}
              >{account.role}</Badge
            >
          </div>
          <div class="flex items-center justify-between">
            <button
              onclick={() => toggleEnabled(account.email)}
              class="flex items-center gap-1.5 cursor-pointer"
            >
              <span
                class="size-2 rounded-full {account.enabled
                  ? 'bg-success'
                  : 'bg-muted-foreground'}"
              ></span>
              <span class="text-xs"
                >{account.enabled ? "Active" : "Disabled"}</span
              >
            </button>
            <div class="flex gap-1">
              <Button
                variant="ghost"
                size="xs"
                onclick={() => startEdit(account.email)}
              >
                <Pencil data-icon="inline-start" />Edit
              </Button>
              <Button
                variant="destructive"
                size="xs"
                onclick={() => deleteAccount(account.email)}
              >
                <Trash2 data-icon="inline-start" />Delete
              </Button>
            </div>
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
    {#if accounts.length === 0}
      <Card.Root class="py-4 text-center">
        <Card.Content
          ><p class="text-sm text-muted-foreground">
            No accounts configured.
          </p></Card.Content
        >
      </Card.Root>
    {/if}
  </div>
{/if}
