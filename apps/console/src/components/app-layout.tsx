import { type ReactNode, useCallback, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  ListBox,
  ListBoxItem,
  Separator,
  Switch,
  Tooltip,
  useMediaQuery,
  useOverlayState,
  useTheme,
} from "@heroui/react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiGitBranch,
  FiHome,
  FiKey,
  FiLock,
  FiLogOut,
  FiMessageSquare,
  FiMoon,
  FiServer,
  FiSettings,
  FiSun,
  FiUsers,
} from "react-icons/fi";
import { clearCredentials, getStoredCredentials } from "../lib/auth";

const platformNav = [
  { label: "Dashboard", icon: FiHome, href: "/" },
  { label: "Keys", icon: FiKey, href: "/keys" },
  { label: "Routes", icon: FiGitBranch, href: "/routes" },
  { label: "Playground", icon: FiMessageSquare, href: "/playground" },
];

const configNav = [
  { label: "Providers", icon: FiServer, href: "/config/providers" },
  { label: "Routes", icon: FiSettings, href: "/config/routes" },
  { label: "Accounts", icon: FiUsers, href: "/config/accounts" },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const creds = getStoredCredentials();
  const isOnline = !!creds?.url;

  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark" || theme === "system";
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [collapsed, setCollapsed] = useState(false);
  const drawerState = useOverlayState();

  const isActive = useCallback(
    (href: string) => {
      if (href === "/") return currentPath === "/";
      return currentPath.startsWith(href);
    },
    [currentPath]
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
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  }, [theme, setTheme]);

  const handleLogout = useCallback(() => {
    clearCredentials();
    navigate({ to: "/login" });
  }, [navigate]);

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 px-4 h-14 border-b border-divider shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground shrink-0">
          <FiLock size={16} />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight animate-fade-in">
            Airlock
          </span>
        )}
        {isDesktop && (
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            className="ml-auto text-default-400 hover:text-default-600"
            onPress={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? (
              <FiChevronRight size={16} />
            ) : (
              <FiChevronLeft size={16} />
            )}
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <NavSection
          label="PLATFORM"
          items={platformNav}
          collapsed={collapsed}
          isActive={isActive}
          onNavigate={handleNavigate}
        />

        <Separator className="my-3" />

        <NavSection
          label="CONFIG"
          items={configNav}
          collapsed={collapsed}
          isActive={isActive}
          onNavigate={handleNavigate}
        />
      </nav>

      <div className="border-t border-divider p-2 shrink-0">
        <UserFooter
          collapsed={collapsed}
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
      <div className="flex h-screen bg-content1">
        <header className="fixed top-0 left-0 right-0 z-30 flex items-center gap-3 h-14 px-4 border-b border-divider bg-content2/80 backdrop-blur-md">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={drawerState.open}
            className="text-default-400 hover:text-default-600"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </Button>
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary text-primary-foreground">
            <FiLock size={14} />
          </div>
          <span className="font-bold text-base tracking-tight">Airlock</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline
                  ? "bg-success animate-pulse-dot"
                  : "bg-default-300"
              }`}
            />
            <span className="text-xs text-default-400">
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
        </header>

        <Drawer.Root state={drawerState}>
          <Drawer.Backdrop />
          <Drawer.Content placement="left" className="w-72">
            <Drawer.Header className="p-0 h-full">
              <div className="flex flex-col w-full h-full bg-content2">
                {sidebarContent}
              </div>
            </Drawer.Header>
          </Drawer.Content>
        </Drawer.Root>

        <main className="flex-1 overflow-auto pt-14">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-content1">
      <aside
        className={`flex flex-col border-r border-divider bg-content2 shrink-0 transition-all duration-300 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {sidebarContent}
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavSection({
  label,
  items,
  collapsed,
  isActive,
  onNavigate,
}: {
  label: string;
  items: readonly { readonly label: string; readonly icon: typeof FiHome; readonly href: string }[];
  collapsed: boolean;
  isActive: (href: string) => boolean;
  onNavigate: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {!collapsed && (
        <span className="px-2 pt-2 pb-1 text-[10px] font-semibold text-default-400 uppercase tracking-wider">
          {label}
        </span>
      )}
      <ListBox
        variant="default"
        aria-label={`${label} navigation`}
        onAction={(key) => onNavigate(key as string)}
        items={items}
        className="gap-0.5"
      >
        {(item) => {
          const active = isActive(item.href);
          const inner = (
            <ListBoxItem
              key={item.href}
              textValue={item.label}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-primary/10 text-primary border-l-2 border-primary"
                  : "hover:bg-default-100 text-default-600 border-l-2 border-transparent"
              }`}
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && (
                <span className="truncate animate-fade-in">{item.label}</span>
              )}
            </ListBoxItem>
          );

          if (collapsed) {
            return (
              <Tooltip.Root key={item.href}>
                <Tooltip.Trigger>{inner}</Tooltip.Trigger>
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
  onLogout,
}: {
  collapsed: boolean;
  isOnline: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger>
        <Button
          variant="ghost"
          className={`w-full justify-start gap-2 px-2 h-auto py-2 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <div className="relative shrink-0">
            <Avatar.Root size="sm" color="accent">
              <Avatar.Fallback>A</Avatar.Fallback>
            </Avatar.Root>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-content2 ${
                isOnline
                  ? "bg-success animate-pulse-dot"
                  : "bg-default-300"
              }`}
            />
          </div>
          {!collapsed && (
            <div className="flex flex-col items-start text-left animate-fade-in">
              <span className="text-sm font-medium">Admin</span>
              <span className="text-xs text-default-400">
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          )}
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "theme") onToggleTheme();
            else if (key === "logout") onLogout();
          }}
        >
          <Dropdown.Item key="theme" textValue="Toggle theme">
            <div className="flex items-center justify-between w-full">
              <span className="flex items-center gap-2">
                {isDark ? <FiSun size={16} /> : <FiMoon size={16} />}
                {isDark ? "Light Mode" : "Dark Mode"}
              </span>
              <Switch.Root isSelected={isDark} size="sm">
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </div>
          </Dropdown.Item>
          <Dropdown.Item key="logout" textValue="Log out">
            <span className="flex items-center gap-2 text-danger">
              <FiLogOut size={16} />
              Log out
            </span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  );
}

