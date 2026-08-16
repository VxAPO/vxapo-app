import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ThemeMode } from "../lib/model";

const THEME_TRANSITION_MS = 420;

function currentSystemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function readStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem("vxapo.theme");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(currentSystemDark);
  const prevAppliedRef = useRef<string | null>(null);
  const transitionTimerRef = useRef<number | undefined>(undefined);

  // 跟随系统时，系统深浅变化需要触发重渲染
  useLayoutEffect(() => {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // 旧 WebView2 可能只有 addListener
      (mql as unknown as { addListener: (fn: (e: MediaQueryListEvent) => void) => void }).addListener(onChange);
      return () =>
        (mql as unknown as { removeListener: (fn: (e: MediaQueryListEvent) => void) => void }).removeListener(onChange);
    }
  }, []);

  const themeApplied = theme === "system" ? (systemDark ? "dark" : "light") : theme;

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

  useEffect(() => {
    try {
      localStorage.setItem("vxapo.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return { theme, setTheme };
}
