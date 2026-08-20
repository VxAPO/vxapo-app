import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";

const STORAGE_KEY = "vxapo.lang";

import { zh } from "./i18n/zh";
import { en } from "./i18n/en";

function readInitialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return "zh";
}

let currentLang: Lang = readInitialLang();
try {
  document.documentElement.dataset.lang = currentLang;
} catch {
  /* ignore */
}
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang) {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    document.documentElement.dataset.lang = lang;
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const map = currentLang === "en" ? en : zh;
  let text = map[key] ?? zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

const I18nContext = createContext<Lang>("zh");

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(currentLang);
  useEffect(() => {
    const listener = () => setLangState(currentLang);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return <I18nContext.Provider value={lang}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
