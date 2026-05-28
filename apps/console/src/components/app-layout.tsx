import { type ReactNode, useCallback, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Label,
  ListBox,
  ListBoxItem,
  Separator,
  Switch,
  Tooltip,
  useMediaQuery,
  useOverlayState
} from "@heroui/react";
import type { Selection } from "@heroui/react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiGitBranch,
  FiHome,
  FiKey,
  FiLock,
  FiLogOut,
  FiMenu,
  FiMessageSquare,
  FiMoon,
  FiServer,
  FiSettings,
  FiSun,
  FiUsers
} from "react-icons/fi";
import { clearCredentials, getStoredCredentials } from "../lib/auth";
import { useConsoleTheme } from "./theme-sync";

const platformNav = [
  { id: "/", label: "Dashboard", icon: FiHome, href: "/" },
  { id: "/keys", label: "Keys", icon: FiKey, href: "/keys" },
  { id: "/routes", label: "Routes", icon: FiGitBranch, href: "/routes" },
  {
    id: "/playground",
    label: "Playground",
    icon: FiMessageSquare,
    href: "/playground"
  }
];

const configNav = [
  {
    id: "/config/providers",
    label: "Providers",
    icon: FiServer,
    href: "/config/providers"
  },
  {
    id: "/config/routes",
    label: "Routes",
    icon: FiSettings,
    href: "/config/routes"
  },
  {
    id: "/config/accounts",
    label: "Accounts",
    icon: FiUsers,
    href: "/config/accounts"
  }
];

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const creds = getStoredCredentials();
  const isOnline = !!creds?.url;

  const { isDark, setTheme } = useConsoleTheme();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [collapsed, setCollapsed] = useState(false);
  const drawerState = useOverlayState();

  const isActive = useCallback(
    (href: string) => {
      if (href === "/") return currentPath === "/";
      return currentPath === href || currentPath.startsWith(`${href}/`);
    },
    [currentPath]
  );

  const getActiveKey = useCallback(
    (
      items: readonly {
        readonly id: string;
        readonly href: string;
      }[]
    ) => items.find((item) => isActive(item.href))?.id,
    [isActive]
  );

  const handleNavigate = useCallback(
    (key: string) => {
      navigate({ to: key as string });
      if (!isDesktop) {
        drawerState.close();
      }
    },
    [navigate, isDesktop, drawerState]
  );

  const toggleTheme = useCallback(() => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
  }, [isDark, setTheme]);

  const handleLogout = useCallback(() => {
    clearCredentials();
    navigate({ to: "/login" });
  }, [navigate]);

  const renderSidebarContent = (isCollapsed: boolean) => (
    <>
      <div className="flex items-center gap-2.5 px-3 h-12 border-b border-border shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-2xl bg-accent text-accent-foreground shrink-0">
          <FiLock size={14} />
        </div>
        {!isCollapsed && (
          <span className="font-bold text-base tracking-tight animate-fade-in">
            Airlock
          </span>
        )}
        {isDesktop && (
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="ml-auto text-muted hover:text-foreground h-6 w-6 min-w-6"
            onPress={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? (
              <FiChevronRight size={14} />
            ) : (
              <FiChevronLeft size={14} />
            )}
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-1.5 px-1.5">
        <NavSection
          label="PLATFORM"
          items={platformNav}
          collapsed={isCollapsed}
          activeKey={getActiveKey(platformNav)}
          isActive={isActive}
          onNavigate={handleNavigate}
        />

        <Separator className="my-2" />

        <NavSection
          label="CONFIG"
          items={configNav}
          collapsed={isCollapsed}
          activeKey={getActiveKey(configNav)}
          isActive={isActive}
          onNavigate={handleNavigate}
        />
      </nav>

      <div className="border-t border-border p-1.5 shrink-0">
        <UserFooter
          collapsed={isCollapsed}
          isOnline={isOnline}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      </div>
    </>
  );

  if (!isDesktop) {
    return (
      <div className="flex h-screen bg-background">
        <header className="fixed top-0 left-0 right-0 z-30 flex items-center gap-2 h-12 px-3 border-b border-border bg-surface-secondary/80 backdrop-blur-md">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label="Open navigation"
            onPress={drawerState.open}
            className="text-muted hover:text-foreground"
          >
            <FiMenu size={18} />
          </Button>
          <div className="flex items-center justify-center w-6 h-6 rounded-2xl bg-accent text-accent-foreground">
            <FiLock size={12} />
          </div>
          <span className="font-bold text-sm tracking-tight">Airlock</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isOnline ? "bg-success animate-pulse-dot" : "bg-default"
              }`}
            />
            <span className="text-[11px] text-muted">
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
        </header>

        <Drawer.Backdrop
          isOpen={drawerState.isOpen}
          onOpenChange={drawerState.setOpen}
        >
          <Drawer.Content placement="left" className="w-64">
            <Drawer.Dialog
              aria-label="Navigation"
              className="w-64 max-w-[80vw] p-0"
            >
              <div className="flex h-full w-full flex-col bg-surface-secondary">
                {renderSidebarContent(false)}
              </div>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>

        <main className="flex-1 overflow-auto pt-12">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <aside
        className={`flex flex-col border-r border-border bg-surface-secondary shrink-0 transition-all duration-300 ${
          collapsed ? "w-14" : "w-52"
        }`}
      >
        {renderSidebarContent(collapsed)}
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavSection({
  label,
  items,
  collapsed,
  activeKey,
  isActive,
  onNavigate
}: {
  label: string;
  items: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: typeof FiHome;
    readonly href: string;
  }[];
  collapsed: boolean;
  activeKey?: string;
  isActive: (href: string) => boolean;
  onNavigate: (key: string) => void;
}) {
  const selectedKeys = activeKey ? [activeKey] : [];

  const handleSelectionChange = useCallback(
    (selection: Selection) => {
      if (selection === "all") return;

      const [key] = Array.from(selection);
      if (typeof key === "string") {
        onNavigate(key);
      }
    },
    [onNavigate]
  );

  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && (
        <span className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
          {label}
        </span>
      )}
      <ListBox
        variant="default"
        aria-label={`${label} navigation`}
        selectionMode="single"
        selectedKeys={selectedKeys}
        onSelectionChange={handleSelectionChange}
        items={items}
        className="gap-0"
      >
        {(item) => {
          const active = isActive(item.href);
          const inner = (
            <ListBoxItem
              id={item.id}
              key={item.id}
              textValue={item.label}
              aria-current={active ? "page" : undefined}
              className="text-muted data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent-soft-foreground"
            >
              <item.icon size={16} className="shrink-0" />
              {!collapsed && <Label className="truncate">{item.label}</Label>}
            </ListBoxItem>
          );

          if (collapsed) {
            return (
              <Tooltip.Root key={item.href}>
                <Tooltip.Trigger aria-label={item.label}>
                  {inner}
                </Tooltip.Trigger>
                <Tooltip.Content placement="right" showArrow>
                  {item.label}
                </Tooltip.Content>
              </Tooltip.Root>
            );
          }

          return inner;
        }}
      </ListBox>
    </div>
  );
}

function UserFooter({
  collapsed,
  isOnline,
  isDark,
  onToggleTheme,
  onLogout
}: {
  collapsed: boolean;
  isOnline: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  return (
    <Dropdown.Root>
      <Button
        aria-label="Open user menu"
        fullWidth
        variant="ghost"
        size="sm"
        className={collapsed ? "px-0" : "justify-start px-2"}
      >
        <div className="relative shrink-0">
          <Avatar.Root size="sm" color="accent">
            <Avatar.Fallback className="text-xs">A</Avatar.Fallback>
          </Avatar.Root>
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-surface-secondary ${
              isOnline ? "bg-success animate-pulse-dot" : "bg-default"
            }`}
          />
        </div>
        {!collapsed && (
          <span className="flex min-w-0 flex-col items-start text-left">
            <span className="text-[13px] font-medium leading-tight">Admin</span>
            <span className="text-[11px] text-muted leading-tight">
              {isOnline ? "Online" : "Offline"}
            </span>
          </span>
        )}
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "theme") onToggleTheme();
            else if (key === "logout") onLogout();
          }}
        >
          <Dropdown.Item id="theme" key="theme" textValue="Toggle theme">
            <div className="flex items-center justify-between w-full">
              <Label className="flex items-center gap-2 text-[13px]">
                {isDark ? <FiSun size={14} /> : <FiMoon size={14} />}
                {isDark ? "Light Mode" : "Dark Mode"}
              </Label>
              <Switch.Root isSelected={isDark} size="sm">
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </div>
          </Dropdown.Item>
          <Dropdown.Item id="logout" key="logout" textValue="Log out">
            <Label className="flex items-center gap-2 text-danger text-[13px]">
              <FiLogOut size={14} />
              Log out
            </Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  );
}
