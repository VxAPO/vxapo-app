import { zh } from "./zh";
import { en } from "./en";
import { LIBRARY } from "../../data/library";
import { PERCEPTUAL_LABELS } from "../blocks";

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
const BAND_NAME_ZH: Record<string, string> = {};
for (const p of LIBRARY) {
  for (const b of p.bands ?? []) {
    if (b.name && b.name_en && !(b.name in BAND_NAME_EN)) {
      BAND_NAME_EN[b.name] = b.name_en;
    }
    // 反向（英文→中文）：预设按当时的界面语言把段名固化进 config，
    // 之后切回中文时也要能翻回来，否则英文界面加的预设会一直显示英文段名。
    if (b.name && b.name_en && !(b.name_en in BAND_NAME_ZH)) {
      BAND_NAME_ZH[b.name_en] = b.name;
    }
  }
}

// 语义视图的「默认映射」标签：感知区间名（`PERCEPTUAL_LABELS`）中英成对。
// 词条本身就在 zh/en 里（键是中文字面量），这里按那份权威表展开成双向查表，
// **不手抄第二份标签**——清单只源自 PERCEPTUAL_LABELS，译名只源自 i18n 词条。
const PERCEPTUAL_EN: Record<string, string> = {};
const PERCEPTUAL_ZH: Record<string, string> = {};
for (const label of PERCEPTUAL_LABELS) {
  const enLabel = en[label];
  const zhLabel = zh[label] ?? label;
  // 两种写法都能查到（用户可能是中文界面上保存、再切到英文界面）
  PERCEPTUAL_EN[label] = enLabel ?? label;
  PERCEPTUAL_EN[enLabel ?? label] = enLabel ?? label;
  PERCEPTUAL_ZH[label] = zhLabel;
  PERCEPTUAL_ZH[enLabel ?? label] = zhLabel;
}

/** 语义段名本地化：config 存的是应用时语言，双向按库里的 name/name_en 反查，
 *  再回退到感知标签的双向查表（自定义预设里未被用户改写的默认映射走这条）。
 *  `未命名` 这类占位符另有 i18n 词条，由调用处的 `t(...)` 收口。 */
export function displayBandName(label: string): string {
  if (!label) return label;
  return currentLang === "en"
    ? (BAND_NAME_EN[label] ?? PERCEPTUAL_EN[label] ?? label)
    : (BAND_NAME_ZH[label] ?? PERCEPTUAL_ZH[label] ?? label);
}

/**
 * 感知标签的中英对照：认得出的返回 `{ zh, en }`，认不出（用户自己写的文字）返回 null。
 * 保存自定义预设时用它判断「这一行是没动过的默认映射，还是用户手写的」——
 * 前者成对入库供语言切换反查，后者原样保留。
 */
export function perceptualLabelPair(label: string): { zh: string; en: string } | null {
  const zhLabel = PERCEPTUAL_ZH[label];
  if (!zhLabel) return null;
  return { zh: zhLabel, en: PERCEPTUAL_EN[zhLabel] ?? zhLabel };
}

/**
 * 自定义预设一行的语义描述 → 入库字段。
 *
 * - 空串：不写 name（沿用原先「留空」语义）。
 * - 认得出是语义视图的默认映射（感知标签，中英任意写法）：**成对**写入
 *   `name` / `name_en`，语言切换时任意一侧都能反查出另一侧。
 * - 其余＝用户自己写的：原样保留，且**不**补 `name_en`——切语言不改用户文字。
 */
export function customBandNameFields(raw: string): { name?: string; name_en?: string } {
  const text = raw.trim();
  if (!text) return {};
  const pair = perceptualLabelPair(text);
  return pair ? { name: pair.zh, name_en: pair.en } : { name: text };
}

/** 默认预设名（可带序号）→ 指定语言文案；`seq` 为 0 时不拼序号。 */
export function defaultPresetName(lang: Lang, seq: number): string {
  const base = lang === "en" ? en["preset.name.placeholder"] : zh["preset.name.placeholder"];
  return seq > 0 ? `${base} ${seq}` : base;
}

/**
 * 默认预设名 → 序号；**不带序号**的默认名按 `0` 记（弹窗清空名称会回退到那条），
 * 空串同样按默认处理。不是默认名（用户自己写的）返回 null。
 */
function defaultPresetSeq(text: string): number | null {
  const s = text.trim();
  if (!s) return 0;
  if (s === zh["preset.name.placeholder"] || s === en["preset.name.placeholder"]) return 0;
  const m = /^(.*?)\s*(\d+)$/.exec(s);
  if (!m) return null;
  if (m[1] !== zh["preset.name.placeholder"] && m[1] !== en["preset.name.placeholder"]) {
    return null;
  }
  return Number(m[2]);
}

/** 自定义预设的默认名（未编辑时用）：中英成对，切语言可反查，序号保持在末尾。
 *  与 `t("preset.name.placeholder")` 同源，不另起一套文案。 */
export function customPresetDefaultName(seq: number): { zh: string; en: string } {
  return { zh: defaultPresetName("zh", seq), en: defaultPresetName("en", seq) };
}

/**
 * 文本是否仍是「未编辑的默认名」——`自定义预设` / `自定义预设 3` / `Custom preset` /
 * `Custom preset 3` / 空串都算。认得出才成对入库，用户自己写的名字一律原样保留。
 */
export function isDefaultPresetName(text: string): boolean {
  return defaultPresetSeq(text) != null;
}

/**
 * 自定义预设名的显示层本地化。
 *
 * 优先按当前语言取成对的字段（本次改动后保存的名都带 `name_en`）；对**旧数据**
 * （当时只按界面语言存了一份、且名字还是默认名）重新拼一份，否则切语言后仍会
 * 显示旧语言的「自定义预设 1」。用户自己写的名字一律原样显示。
 */
export function displayPresetName(p: { name: string; name_en?: string }): string {
  const source = currentLang === "en" ? (p.name_en ?? p.name) : p.name;
  const seq = defaultPresetSeq(source);
  return seq == null ? source : defaultPresetName(currentLang, seq);
}
