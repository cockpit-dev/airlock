import { useTheme } from "@heroui/react";
import { createContext, useContext, type ReactNode } from "react";

interface ThemeState {
  isDark: boolean;
  setTheme: (theme: "light" | "dark") => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme("light");

  return (
    <ThemeContext.Provider
      value={{
        isDark: resolvedTheme === "dark",
        setTheme: (theme) => setTheme(theme)
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useConsoleTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("Console theme provider is not available");
  return value;
}
