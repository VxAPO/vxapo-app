import { zh } from "./zh";
import { en } from "./en";

export type Lang = "zh" | "en";

// 语言统一以 C:\ProgramData\VxAPO\lang.txt 为准（安装器写入默认，设置切换写回），
// 不再使用 localStorage，避免历史残留导致安装器选择不生效。
let currentLang: Lang = "zh";
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
  listeners.forEach((l) => l());
}

/** 订阅语言切换，返回退订函数（供 React Provider 使用）。 */
export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
