import { useLayoutEffect, useRef, useState } from "react";
import type { ThemeMode } from "../lib/model";

const THEME_TRANSITION_MS = 420;

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>("system");
  const prevAppliedRef = useRef<string | null>(null);
  const transitionTimerRef = useRef<number | undefined>(undefined);

  const themeApplied = theme === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  useLayoutEffect(() => {
    const root = document.documentElement;

    // 首次挂载直接应用主题，不加过渡。
    if (prevAppliedRef.current === null) {
      root.dataset.theme = themeApplied;
      prevAppliedRef.current = themeApplied;
      return;
    }

    if (prevAppliedRef.current === themeApplied) return;

    // 先挂过渡类，再改 data-theme，让整页颜色同步渐变。
    root.classList.add("theme-transition");
    root.dataset.theme = themeApplied;
    prevAppliedRef.current = themeApplied;

    window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      root.classList.remove("theme-transition");
    }, THEME_TRANSITION_MS);
  }, [themeApplied]);

  return { theme, setTheme };
}
