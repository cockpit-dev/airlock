import { type ReactNode, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Avatar,
  Button,
  Dropdown,
  ListBox,
  ListBoxItem,
  Separator,
  Switch,
} from "@heroui/react";
import {
  FiHome,
  FiKey,
  FiGitBranch,
  FiMessageSquare,
  FiServer,
  FiUsers,
  FiSettings,
  FiLogOut,
  FiMenu,
  FiX,
  FiSun,
  FiMoon,
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

const allNav = [...platformNav, ...configNav];

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const creds = getStoredCredentials();
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains("dark")
  );
  const [collapsed, setCollapsed] = useState(false);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }

  function handleLogout() {
    clearCredentials();
    navigate({ to: "/login" });
  }

  function isActive(href: string) {
    if (href === "/") return currentPath === "/";
    return currentPath.startsWith(href);
  }

  return (
    <div className="flex h-screen bg-content1">
      <aside
        className={`flex flex-col border-r border-divider transition-all duration-200 ${
          collapsed ? "w-16" : "w-60"
        } bg-content2`}
      >
        <div className="flex items-center gap-2 px-4 h-14 border-b border-divider">
          {!collapsed && (
            <span className="font-bold text-lg tracking-tight">Airlock</span>
          )}
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            className="ml-auto"
            onPress={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <FiMenu size={16} /> : <FiX size={16} />}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {!collapsed && (
            <span className="px-2 text-xs font-semibold text-default-400 uppercase tracking-wider">
              Platform
            </span>
          )}
          <ListBox
            variant="default"
            aria-label="Platform navigation"
            onAction={(key) => navigate({ to: key as string })}
            items={platformNav}
          >
            {(item) => (
              <ListBoxItem
                key={item.href}
                textValue={item.label}
                className={
                  isActive(item.href)
                    ? "bg-primary/10 text-primary rounded-lg"
                    : "rounded-lg"
                }
              >
                <div className="flex items-center gap-2">
                  <item.icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </div>
              </ListBoxItem>
            )}
          </ListBox>

          <Separator className="my-2" />

          {!collapsed && (
            <span className="px-2 text-xs font-semibold text-default-400 uppercase tracking-wider">
              Config
            </span>
          )}
          <ListBox
            variant="default"
            aria-label="Config navigation"
            onAction={(key) => navigate({ to: key as string })}
            items={configNav}
          >
            {(item) => (
              <ListBoxItem
                key={item.href}
                textValue={item.label}
                className={
                  isActive(item.href)
                    ? "bg-primary/10 text-primary rounded-lg"
                    : "rounded-lg"
                }
              >
                <div className="flex items-center gap-2">
                  <item.icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </div>
              </ListBoxItem>
            )}
          </ListBox>
        </nav>

        <div className="border-t border-divider p-2">
          <Dropdown.Root>
            <Dropdown.Trigger>
              <Button variant="ghost" className="w-full justify-start gap-2 px-2">
                <Avatar.Root size="sm" color="accent">
                  <Avatar.Fallback>A</Avatar.Fallback>
                </Avatar.Root>
                {!collapsed && (
                  <div className="flex flex-col items-start text-left">
                    <span className="text-sm">Admin</span>
                    <span className="text-xs text-default-400">
                      {creds?.url ? "Online" : "Offline"}
                    </span>
                  </div>
                )}
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "theme") toggleTheme();
                  else if (key === "logout") handleLogout();
                }}
              >
                <Dropdown.Item key="theme" textValue="Toggle theme">
                  <div className="flex items-center justify-between w-full">
                    <span className="flex items-center gap-2">
                      {dark ? <FiSun size={16} /> : <FiMoon size={16} />}
                      {dark ? "Light Mode" : "Dark Mode"}
                    </span>
                    <Switch size="sm" isSelected={dark} />
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
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
