import { zh } from "./zh";
import { en } from "./en";
import { LIBRARY } from "../../data/library";

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

/** 组名显示层本地化：config 里存的是应用当时语言的组名，
 *  切换语言后用 LIBRARY 的 group/group_en 反查，或处理“自定义/Custom”。 */
export function displayGroupLabel(label: string): string {
  if (!label) return label;
  // 组名可能带“2/3…”序号（重复应用），先去尾缀再反查，最后拼回
  const m = /^(.*?)\s*(\d+)$/.exec(label);
  const base = m ? m[1] : label;
  const suffix = m ? m[2] : "";
  const baseLabel = translateGroup(base);
  return suffix ? `${baseLabel}${suffix ? ` ${suffix}` : ""}` : baseLabel;
}

function translateGroup(label: string): string {
  if (!label) return label;
  if (currentLang === "en") {
    const hit = LIBRARY.find((p) => p.group === label);
    if (hit?.group_en) return hit.group_en;
    if (label === "自定义") return t("custom");
  } else {
    const hit = LIBRARY.find((p) => p.group_en === label);
    if (hit?.group) return hit.group;
    if (label === "Custom") return t("custom");
  }
  return label;
}

const BAND_NAME_EN: Record<string, string> = {};
for (const p of LIBRARY) {
  for (const b of p.bands ?? []) {
    if (b.name && b.name_en && !(b.name in BAND_NAME_EN)) {
      BAND_NAME_EN[b.name] = b.name_en;
    }
  }
}

/** 语义段名本地化：config 存的是应用时语言，英文下按库里的 name/name_en 反查 */
export function displayBandName(label: string): string {
  if (currentLang === "en") {
    const en = BAND_NAME_EN[label];
    if (en) return en;
  }
  return label;
}
