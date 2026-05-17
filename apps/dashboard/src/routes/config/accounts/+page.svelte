<script lang="ts">
  import Nav from "$components/Nav.svelte";
  import { createClient, getStoredCredentials } from "$lib/auth.js";

  type Account = {
    email: string;
    role: string;
    enabled: boolean;
    createdAt: number;
  };

  type AccountsConfig = {
    accounts: Account[];
  };

  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let editAccountEmail = $state<string | null>(null);
  let showCreateForm = $state(false);

  let accounts = $state<Account[]>([]);

  // Create/edit form state
  let formEmail = $state("");
  let formRole = $state("viewer");
  let formEnabled = $state(true);

  const roleOptions = ["super_admin", "admin", "operator", "viewer"];
  const fieldIds = {
    email: "account-email",
    role: "account-role"
  };

  function resetForm() {
    formEmail = "";
    formRole = "viewer";
    formEnabled = true;
  }

  async function loadConfig() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    try {
      const snapshot = await client.getConfigStoreSnapshot();
      const section = snapshot.sections["accounts"];
      if (
        section?.data &&
        typeof section.data === "object" &&
        "accounts" in (section.data as Record<string, unknown>)
      ) {
        accounts = (section.data as AccountsConfig).accounts;
      }
    } catch {
      // Config store may not be initialized yet
    } finally {
      loading = false;
    }
  }

  async function saveAccounts() {
    const creds = getStoredCredentials();
    if (!creds) return;
    const client = createClient(creds.url, creds.token);
    saving = true;
    error = "";
    success = "";

    try {
      await client.putConfigStoreSection("accounts", { accounts });
      success = "Account configuration saved";
      editAccountEmail = null;
      showCreateForm = false;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save";
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
    const account = accounts.find((a) => a.email === email);
    if (!account) return;
    formEmail = account.email;
    formRole = account.role;
    formEnabled = account.enabled;
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
      error = "Email is required";
      return;
    }
    error = "";

    if (accounts.some((a) => a.email === formEmail.trim())) {
      error = "Account with this email already exists";
      return;
    }

    const newAccount: Account = {
      email: formEmail.trim(),
      role: formRole,
      enabled: formEnabled,
      createdAt: Date.now(),
    };

    accounts = [...accounts, newAccount];
    showCreateForm = false;
    resetForm();
    saveAccounts();
  }

  function applyEdit() {
    if (!editAccountEmail) return;
    if (!formEmail.trim()) {
      error = "Email is required";
      return;
    }
    error = "";

    accounts = accounts.map((a) =>
      a.email === editAccountEmail
        ? {
            ...a,
            email: formEmail.trim(),
            role: formRole,
            enabled: formEnabled,
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
    if (!confirm(`Delete account ${email}? This cannot be undone.`)) return;
    accounts = accounts.filter((a) => a.email !== email);
    saveAccounts();
  }

  function roleBadgeClass(role: string): string {
    switch (role) {
      case "super_admin":
        return "bg-red-900/50 text-red-300 border-red-800";
      case "admin":
        return "bg-orange-900/50 text-orange-300 border-orange-800";
      case "operator":
        return "bg-blue-900/50 text-blue-300 border-blue-800";
      default:
        return "bg-gray-800 text-gray-400 border-gray-700";
    }
  }

  loadConfig();
</script>

<Nav />

<main class="max-w-5xl mx-auto px-6 py-8">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-bold text-gray-100">Account Management</h2>
    <div class="flex gap-3">
      <a href="/config" class="text-sm text-blue-400 hover:text-blue-300"
        >&larr; Back to Config</a
      >
      <button
        type="button"
        class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium"
        onclick={startCreate}
      >
        + Add Account
      </button>
    </div>
  </div>

  {#if error}
    <div
      class="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm"
    >
      {error}
    </div>
  {/if}

  {#if success}
    <div
      class="bg-green-900/30 border border-green-800 rounded-lg p-3 mb-4 text-green-300 text-sm"
    >
      {success}
    </div>
  {/if}

  {#if loading}
    <div class="text-gray-400 text-center py-12">Loading accounts...</div>
  {:else}
    <!-- Create/Edit Form -->
    {#if showCreateForm || editAccountEmail}
      <div
        class="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4 space-y-4"
      >
        <h3 class="text-lg font-semibold text-white">
          {editAccountEmail ? "Edit Account" : "Add Account"}
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1" for={fieldIds.email}>Email</label>
            <input
              id={fieldIds.email}
              type="email"
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder="user@example.com"
              bind:value={formEmail}
              disabled={editAccountEmail !== null}
            />
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1" for={fieldIds.role}>Role</label>
            <select
              id={fieldIds.role}
              class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              bind:value={formRole}
            >
              {#each roleOptions as role}
                <option value={role}>{role}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="account-enabled"
            bind:checked={formEnabled}
            class="rounded bg-gray-800 border-gray-700"
          />
          <label for="account-enabled" class="text-sm text-gray-400"
            >Enabled</label
          >
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            class="px-4 py-2 text-gray-400 hover:text-white text-sm rounded border border-gray-700"
            onclick={cancelEdit}
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium disabled:opacity-50"
            onclick={editAccountEmail ? applyEdit : applyCreate}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    {/if}

    <!-- Accounts List -->
    <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-800 text-gray-400 text-left">
            <th class="px-4 py-3">Email</th>
            <th class="px-4 py-3">Role</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each accounts as account}
            <tr class="border-b border-gray-800 last:border-0">
              <td class="px-4 py-3 text-white font-mono text-xs">
                {account.email}
              </td>
              <td class="px-4 py-3">
                <span
                  class="px-2 py-0.5 rounded text-xs border {roleBadgeClass(account.role)}"
                >
                  {account.role}
                </span>
              </td>
              <td class="px-4 py-3">
                <button
                  type="button"
                  class="px-2 py-0.5 rounded text-xs {account.enabled
                    ? 'bg-green-900/50 text-green-300 hover:bg-green-900'
                    : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}"
                  onclick={() => toggleEnabled(account.email)}
                >
                  {account.enabled ? "Active" : "Disabled"}
                </button>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-700 rounded"
                    onclick={() => startEdit(account.email)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 text-xs text-red-400 hover:text-red-300 border border-red-900 rounded"
                    onclick={() => deleteAccount(account.email)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          {/each}

          {#if accounts.length === 0}
            <tr>
              <td
                colspan="4"
                class="px-4 py-8 text-center text-gray-500"
              >
                No accounts configured. Click "Add Account" to create one.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</main>
