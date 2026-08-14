import { useEffect, useState } from "react";
import type { ThemeMode } from "../lib/model";

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>("system");

  const themeApplied = theme === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = themeApplied;
  }, [themeApplied]);

  return { theme, setTheme };
}
