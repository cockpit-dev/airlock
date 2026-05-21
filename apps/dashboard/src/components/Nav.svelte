<script lang="ts" module>
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import Lock from "@lucide/svelte/icons/lock";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import Route from "@lucide/svelte/icons/route";
  import ServerIcon from "@lucide/svelte/icons/server";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import UsersIcon from "@lucide/svelte/icons/users";

  const navData = {
    navMain: [
      {
        title: "Dashboard",
        url: "/",
        icon: LayoutDashboardIcon
      },
      {
        title: "Keys",
        url: "/keys",
        icon: KeyRoundIcon
      },
      {
        title: "Routes",
        url: "/routes",
        icon: Route
      },
      {
        title: "Playground",
        url: "/playground",
        icon: MessageSquareIcon
      }
    ],
    navConfig: [
      { title: "Providers", url: "/config/providers", icon: ServerIcon },
      { title: "Routes", url: "/config/routes", icon: Route },
      { title: "Accounts", url: "/config/accounts", icon: UsersIcon },
      { title: "API Keys", url: "/keys", icon: ShieldIcon }
    ],
    logo: Lock
  };
</script>

<script lang="ts">
  import { page } from "$app/state";
  import { signOut as authSignOut } from "@auth/sveltekit/client";
  import { clearCredentials, getStoredCredentials } from "$lib/auth.js";
  import {
    isDark as checkIsDark,
    toggleTheme as doToggleTheme
  } from "$lib/theme.svelte.js";
  import { onMount } from "svelte";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import * as Avatar from "$lib/components/ui/avatar/index.js";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import LogOutIcon from "@lucide/svelte/icons/log-out";

  const session = $derived(page.data.session);
  const creds = $derived(getStoredCredentials());
  const hasRemoteGatewayCredentials = $derived(Boolean(creds));
  const currentPath = $derived(page.url.pathname);
  const sidebar = Sidebar.useSidebar();

  let dark = $state(false);

  const items = $derived(
    navData.navMain.map((item) => {
      const isActive =
        item.url === "/"
          ? currentPath === "/"
          : currentPath.startsWith(item.url);
      return { ...item, isActive };
    })
  );
  const configItems = $derived(
    navData.navConfig.map((item) => {
      const isActive = currentPath.startsWith(item.url);
      return { ...item, isActive };
    })
  );

  onMount(() => {
    dark = checkIsDark();
  });

  function handleToggleTheme() {
    dark = doToggleTheme() === "dark";
  }

  async function handleLogout() {
    clearCredentials();
    if (session?.user) {
      await authSignOut({ redirectTo: "/login" });
      return;
    }
    window.location.href = "/login";
  }
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg">
          <div
            class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
          >
            <navData.logo class="size-4" />
          </div>
          <div class="grid flex-1 text-start text-sm leading-tight">
            <span class="truncate font-semibold">Airlock</span>
            <span class="truncate text-xs">AI Gateway</span>
          </div>
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content>
    {#if hasRemoteGatewayCredentials}
      <Sidebar.Group>
        <Sidebar.GroupLabel>Platform</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each items as item (item.title)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton tooltipContent={item.title}>
                {#snippet child({ props })}
                  <a href={item.url} {...props}>
                    <item.icon />
                    <span>{item.title}</span>
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
      <Sidebar.Group>
        <Sidebar.GroupLabel>Config</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each configItems as item (item.title)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton tooltipContent={item.title}>
                {#snippet child({ props })}
                  <a href={item.url} {...props}>
                    <item.icon />
                    <span>{item.title}</span>
                  </a>
                {/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}
  </Sidebar.Content>

  <Sidebar.Footer>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton
                size="lg"
                class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                {...props}
              >
                <Avatar.Root class="size-8 rounded-lg">
                  <Avatar.Fallback class="rounded-lg">
                    {session?.user?.email?.[0]?.toUpperCase() ?? "A"}
                  </Avatar.Fallback>
                </Avatar.Root>
                <div class="grid flex-1 text-start text-sm leading-tight">
                  <span class="truncate font-medium">
                    {session?.user?.email ?? (creds ? "Admin" : "Guest")}
                  </span>
                  <span class="truncate text-xs">
                    {creds ? "Online" : "Offline"}
                  </span>
                </div>
                <ChevronsUpDownIcon class="ms-auto size-4" />
              </Sidebar.MenuButton>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content
            class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
            side={sidebar.isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenu.Label class="p-0 font-normal">
              <div
                class="flex items-center gap-2 px-1 py-1.5 text-start text-sm"
              >
                <Avatar.Root class="size-8 rounded-lg">
                  <Avatar.Fallback class="rounded-lg">
                    {session?.user?.email?.[0]?.toUpperCase() ?? "A"}
                  </Avatar.Fallback>
                </Avatar.Root>
                <div class="grid flex-1 text-start text-sm leading-tight">
                  <span class="truncate font-medium">
                    {session?.user?.email ?? "Admin"}
                  </span>
                  <span class="truncate text-xs text-muted-foreground">
                    {creds?.url ?? "No gateway"}
                  </span>
                </div>
              </div>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={handleToggleTheme}>
              {#if dark}
                <SunIcon />
                Light Mode
              {:else}
                <MoonIcon />
                Dark Mode
              {/if}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={handleLogout}>
              <LogOutIcon />
              Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>

  <Sidebar.Rail />
</Sidebar.Root>
